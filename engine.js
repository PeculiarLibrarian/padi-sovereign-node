import fs from 'fs';
import Ajv from 'ajv';
import { Parser, Store, DataFactory } from 'n3';
import { hash, canonicalize, verifySignature, normalize } from './lib.js';

const { namedNode } = DataFactory;
const PREFIX = { sh: "http://www.w3.org/ns/shacl#", padi: "http://padi.tech/schema#" };
const LEDGER_PATH = './ledger.log';

export class PadiEngine {
    constructor() {
        this.ajv = new Ajv({ allErrors: true, strict: true });
        this.store = new Store();
        this.tips = [];
        this.lastTimestamp = 0;
        this.nonces = new Set();
        this.revokedKeys = new Set();
    }

    async bootstrap() {
        this.validator = this.ajv.compile(JSON.parse(fs.readFileSync('./schema.json', 'utf8')));
        const parser = new Parser();
        this.store.addQuads(parser.parse(fs.readFileSync('./padi.ttl', 'utf8')));

        // Identity & Revocation Discovery
        const keyQuads = this.store.getQuads(null, namedNode(`${PREFIX.padi}authorizedPublicKey`), null, null);
        this.publicKeys = keyQuads.map(q => {
            const key = q.object.value;
            const isRevoked = this.store.getQuads(q.subject, namedNode(`${PREFIX.padi}isRevoked`), null, null)[0]?.object.value === "true";
            if (isRevoked) this.revokedKeys.add(key);
            return key;
        }).filter(k => k.includes("PUBLIC KEY") && !this.revokedKeys.has(k));

        if (!fs.existsSync(LEDGER_PATH)) throw new Error("LEDGER_MISSING");

        // BOOTSTRAP AUDIT (O(n) at startup is acceptable)
        const lines = fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
        let lastHash = null;

        for (const [i, line] of lines.entries()) {
            const block = JSON.parse(line);
            if (hash(canonicalize(block)) !== block.hash) throw new Error(`INTEGRITY_BREACH: ${i}`);
            
            if (i === 0) {
                if (block.p.length !== 0) throw new Error("GENESIS_ERR");
            } else {
                if (!block.p.includes(lastHash)) throw new Error(`CONTINUITY_ERR: ${i}`);
                if (block.t < this.lastTimestamp) throw new Error(`TIME_ERR: ${i}`);
            }
            
            this.nonces.add(block.d.nonce);
            lastHash = block.hash;
            this.lastTimestamp = block.t;
        }
        this.tips = [lastHash];
        console.log(`⚓ v1.7.0 Online. Tip: ${this.tips[0].slice(0,8)}`);
    }

    async ingest(payload, signature) {
        const now = Date.now();
        // Monotonic Time Invariant
        if (payload.timestamp < this.lastTimestamp) throw new Error("TIME_RETROGRESSION");
        if (Math.abs(now - payload.timestamp) > 60000) throw new Error("CLOCK_DRIFT");
        
        // Nonce Persistence Check
        if (this.nonces.has(payload.nonce)) throw new Error("REPLAY_ATTACK");

        // Identity & Revocation Check
        if (!verifySignature(canonicalize(payload), signature, this.publicKeys)) throw new Error("AUTH_ERR");

        // Syntactic Gate
        if (!this.validator(payload)) throw new Error("SCHEMA_ERR");

        // Semantic Gate (SHACL)
        this._validateSHACL(payload);

        // DAG Commit
        const block = { t: now, p: this.tips, d: payload, s: signature };
        block.hash = hash(canonicalize(block));
        
        // O(1) DURABLE APPEND
        const fd = fs.openSync(LEDGER_PATH, 'a');
        fs.writeSync(fd, JSON.stringify(block) + '\n');
        fs.fsyncSync(fd);
        fs.closeSync(fd);

        this.nonces.add(payload.nonce);
        this.lastTimestamp = block.t;
        this.tips = [block.hash];
        return block;
    }

    _validateSHACL(payload) {
        const shape = namedNode(`${PREFIX.padi}${payload.context || "StructuralShape"}`);
        const propertyQuads = this.store.getQuads(shape, namedNode(`${PREFIX.sh}property`), null, null);
        for (const pq of propertyQuads) {
            const path = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}path`), null, null)[0]?.object.value.split(/[#\/]/).pop();
            const val = payload[path];
            const maxQ = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}maxInclusive`), null, null)[0];
            if (maxQ && val > Number(maxQ.object.value)) throw new Error(`SHACL_VIOLATION: ${path}`);
        }
    }
}
