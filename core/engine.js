import fs from 'fs';
import Ajv from 'ajv';
import { Parser, Store, DataFactory } from 'n3';
import { hash, canonicalize, verifySignature, signablePayload } from './lib.js';

const { namedNode } = DataFactory;
const PREFIX = { sh: "http://www.w3.org/ns/shacl#", padi: "http://padi.tech/schema#" };
const LEDGER_PATH = './data/ledger.log';

export class PadiEngine {
    constructor() {
        this.ajv = new Ajv({ allErrors: true, strict: true });
        this.store = new Store();
        this.nonces = new Set();
        this.blockIndex = new Map(); 
        this.canonicalPath = [];    
        this.tips = [];
        this.currentHeight = 0;
        this.lastTimestamp = 0;
        this.currentEpoch = 0;
        this.isLeader = false;
        this.mutex = Promise.resolve();
        this.cluster = null; 
    }

    async bootstrap() {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
        this.validator = this.ajv.compile(JSON.parse(fs.readFileSync('./schemas/schema.json', 'utf8')));
        const parser = new Parser();
        this.store.addQuads(parser.parse(fs.readFileSync('./schemas/padi.ttl', 'utf8')));
        this.publicKeys = this.store.getQuads(null, namedNode(`${PREFIX.padi}authorizedPublicKey`), null, null).map(q => q.object.value);
        
        if (fs.existsSync(LEDGER_PATH)) {
            const lines = fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
            for (const line of lines) {
                const block = JSON.parse(line);
                if (hash(canonicalize(block)) !== block.hash) throw new Error("Integrity Failure");
                this.blockIndex.set(block.hash, block);
                if (this.isBetter(block.h, block.hash)) this._updateCanonical(block.hash);
            }
        }
    }

    isBetter(h, hsh) {
        if (h > this.currentHeight) return true;
        if (h === this.currentHeight && hsh < (this.tips[0] || "z")) return true;
        return false;
    }

    _updateCanonical(tipHash) {
        const newPath = [];
        const newNonces = new Set();
        let curr = this.blockIndex.get(tipHash);
        while (curr) {
            newPath.unshift(curr);
            if (curr.d.nonce) {
                if (newNonces.has(curr.d.nonce)) throw new Error("CANONICAL_REPLAY_DETECTED");
                newNonces.add(curr.d.nonce);
            }
            curr = curr.p[0] ? this.blockIndex.get(curr.p[0]) : null; 
        }
        this.canonicalPath = newPath;
        this.nonces = newNonces;
        const tip = newPath[newPath.length - 1];
        this.tips = tip ? [tip.hash] : [];
        this.currentHeight = tip ? tip.h : 0;
        this.lastTimestamp = tip ? tip.t : 0;
        this.currentEpoch = tip ? Math.max(this.currentEpoch, tip.e || 0) : this.currentEpoch;
    }

    async ingest(payload, signature) {
        if (!this.isLeader) throw new Error("NODE_NOT_LEADER");
        const redisLeader = await this.cluster.redis.get(this.cluster.leaderKey);
        if (redisLeader !== this.cluster.nodeId) {
            this.isLeader = false;
            throw new Error("LEADER_FENCED");
        }
        if (payload.epoch !== this.currentEpoch) throw new Error("EPOCH_STALE");

        return this.mutex = this.mutex.then(async () => {
            if (this.nonces.has(payload.nonce)) throw new Error("REPLAY_DETECTED");
            if (!verifySignature(signablePayload(payload), signature, this.publicKeys)) throw new Error("AUTH_ERR");
            if (!this.validator(payload)) throw new Error("SCHEMA_ERR");
            this._validateSHACL(payload);

            const block = { 
                t: Math.max(Date.now(), this.lastTimestamp + 1), 
                h: this.currentHeight + 1, 
                p: this.tips, d: payload, s: signature, e: this.currentEpoch 
            };
            block.hash = hash(canonicalize(block));
            this.persistBlock(block);
            this.blockIndex.set(block.hash, block);
            this._updateCanonical(block.hash);
            return block;
        });
    }

    persistBlock(block) {
        const fd = fs.openSync(LEDGER_PATH, 'a');
        fs.writeSync(fd, JSON.stringify(block) + '\n');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        const dirFd = fs.openSync('./data', 'r');
        fs.fsyncSync(dirFd);
        fs.closeSync(dirFd);
        if (block.h % 1000 === 0) {
            fs.writeFileSync('./data/snapshot.json', JSON.stringify({ tip: block.hash, h: block.h }));
        }
    }

    _validateSHACL(payload) {
        const shape = namedNode(`${PREFIX.padi}${payload.context}`);
        const propertyQuads = this.store.getQuads(shape, namedNode(`${PREFIX.sh}property`), null, null);
        for (const pq of propertyQuads) {
            const pathNode = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}path`), null, null)[0]?.object;
            const path = pathNode?.value.split(/[#\/]/).pop();
            const val = payload[path];
            if (val === undefined) throw new Error(`SHACL_MISSING: ${path}`);
            const maxQ = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}maxInclusive`), null, null)[0];
            const minQ = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}minInclusive`), null, null)[0];
            if (maxQ && val > Number(maxQ.object.value)) throw new Error(`SHACL_MAX_VIOLATION: ${path}`);
            if (minQ && val < Number(minQ.object.value)) throw new Error(`SHACL_MIN_VIOLATION: ${path}`);
        }
    }
}
