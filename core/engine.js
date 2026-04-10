import fs from 'fs';
import Ajv from 'ajv';
import { Parser, Store, DataFactory } from 'n3';
import { hash, canonicalize, verifySignature, signablePayload } from './lib.js';

const { namedNode } = DataFactory;
const PREFIX = { sh: "http://www.w3.org/ns/shacl#", padi: "http://padi.tech/schema#" };
const DATA_DIR = './data';
const LEDGER_PATH = `${DATA_DIR}/ledger.log`;

export class PadiEngine {
    constructor() {
        this.ajv = new Ajv({ allErrors: true, strict: true });
        this.store = new Store();
        this.nonces = new Set();
        this.blockIndex = new Map();
        this.heightIndex = new Map();
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
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        this.validator = this.ajv.compile(JSON.parse(fs.readFileSync('./schemas/schema.json', 'utf8')));
        const parser = new Parser();
        this.store.addQuads(parser.parse(fs.readFileSync('./schemas/padi.ttl', 'utf8')));
        this.publicKeys = this.store.getQuads(null, namedNode(`${PREFIX.padi}authorizedPublicKey`), null, null).map(q => q.object.value);
        
        if (fs.existsSync(LEDGER_PATH)) {
            const lines = fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
            for (const line of lines) {
                const b = JSON.parse(line);
                if (hash(canonicalize(b)) !== b.hash) throw new Error("Integrity Fail");
                this.blockIndex.set(b.hash, b);
                if (this.isBetter(b.h, b.hash)) this._updateCanonical(b.hash);
            }
        }

        if (this.currentHeight === 0 && fs.existsSync(`${DATA_DIR}/snapshot.json`)) {
            const snap = JSON.parse(fs.readFileSync(`${DATA_DIR}/snapshot.json`, 'utf8'));
            this.currentHeight = snap.h; this.tips = [snap.tip];
            this.log("INFO", "SNAPSHOT_RECOVERY", { h: snap.h });
        }
    }

    isBetter(h, hsh) {
        if (h > this.currentHeight) return true;
        if (h === this.currentHeight && hsh < (this.tips[0] || "z")) return true;
        return false;
    }

    _updateCanonical(tipHash) {
        const path = []; const nonces = new Set(); let curr = this.blockIndex.get(tipHash);
        this.heightIndex.clear();
        while (curr) {
            path.unshift(curr); this.heightIndex.set(curr.h, curr.hash);
            if (curr.d.nonce) { if (nonces.has(curr.d.nonce)) throw new Error("REPLAY"); nonces.add(curr.d.nonce); }
            curr = curr.p[0] ? this.blockIndex.get(curr.p[0]) : null;
        }
        this.canonicalPath = path; this.nonces = nonces;
        const tip = path[path.length - 1];
        this.tips = tip ? [tip.hash] : []; this.currentHeight = tip ? tip.h : 0;
        this.lastTimestamp = tip ? tip.t : 0; this.currentEpoch = tip ? Math.max(this.currentEpoch, tip.e || 0) : this.currentEpoch;
    }

    async ingest(payload, signature) {
        if (!this.isLeader || process.env.READ_ONLY === 'true') throw new Error("INGEST_LOCK");
        const leader = await this.cluster.redis.get(this.cluster.leaderKey);
        if (leader !== this.cluster.nodeId) { this.isLeader = false; throw new Error("FENCED"); }
        
        // Final Invariant: Strict Epoch Fencing
        if (payload.epoch !== this.currentEpoch) throw new Error("EPOCH_MISMATCH");

        return this.mutex = this.mutex.then(async () => {
            const now = Date.now();
            if (payload.timestamp && payload.timestamp > now + 5000) throw new Error("FUTURE_DRIFT");
            if (this.nonces.has(payload.nonce)) throw new Error("REPLAY");
            if (!this.validator(payload)) throw new Error("SCHEMA");
            Object.freeze(payload); 

            if (!verifySignature(signablePayload(payload), signature, this.publicKeys)) throw new Error("AUTH");
            
            this._validateSHACL(payload);
            const block = { t: Math.max(now, this.lastTimestamp + 1), h: this.currentHeight + 1, p: this.tips, d: payload, s: signature, e: this.currentEpoch };
            block.hash = hash(canonicalize(block));
            this.persistBlock(block); this.blockIndex.set(block.hash, block); this._updateCanonical(block.hash);
            return block;
        });
    }

    persistBlock(block) {
        const fd = fs.openSync(LEDGER_PATH, 'a'); fs.writeSync(fd, JSON.stringify(block) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd);
        const dirFd = fs.openSync(DATA_DIR, 'r'); fs.fsyncSync(dirFd); fs.closeSync(dirFd);
        if (block.h % 1000 === 0) fs.writeFileSync(`${DATA_DIR}/snapshot.json`, JSON.stringify({ tip: block.hash, h: block.h }));
    }

    _validateSHACL(p) {
        const shape = namedNode(`${PREFIX.padi}${p.context}`);
        const props = this.store.getQuads(shape, namedNode(`${PREFIX.sh}property`), null, null);
        for (const pq of props) {
            const pathNode = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}path`), null, null)[0]?.object;
            const path = pathNode?.value.split(/[#\/]/).pop();
            const val = p[path]; if (val === undefined) throw new Error(`MISSING_${path}`);
            const max = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}maxInclusive`), null, null)[0];
            const min = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}minInclusive`), null, null)[0];
            if (max && val > Number(max.object.value)) throw new Error(`SHACL_MAX_VIOLATION: ${path}`);
            if (min && val < Number(min.object.value)) throw new Error(`SHACL_MIN_VIOLATION: ${path}`);
        }
    }

    log(lvl, evt, meta = {}) { console.log(JSON.stringify({ t: new Date().toISOString(), lvl, evt, ...meta })); }
}
