import fs from 'fs';
import Ajv from 'ajv';
import { Parser, Store, DataFactory } from 'n3';
import { hash, canonicalize, verifySignature } from './lib.js';

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
        this.nodeRegistry = new Map(); // Indexed from Ledger
    }

    async bootstrap() {
        this.validator = this.ajv.compile(JSON.parse(fs.readFileSync('./schema.json', 'utf8')));
        const parser = new Parser();
        this.store.addQuads(parser.parse(fs.readFileSync('./padi.ttl', 'utf8')));

        if (!fs.existsSync(LEDGER_PATH)) throw new Error("LEDGER_MISSING: Run setup.js");

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
            
            // Corrected Nonce Extraction
            if (block.d?.nonce) this.nonces.add(block.d.nonce);
            
            // Indexing Node Declarations from Ledger
            if (block.d?.context === "NodeShape") {
                this.nodeRegistry.set(block.d.nodeId, block.d);
            }

            lastHash = block.hash;
            this.lastTimestamp = block.t;
        }
        this.tips = [lastHash];
        console.log(`⚓ v1.8.0 Online. Tip: ${this.tips[0].slice(0,8)} | Nodes: ${this.nodeRegistry.size}`);
    }

    /**
     * Runtime Discovery of Active (Non-Revoked) Keys
     */
    getActiveKeys() {
        return this.store.getQuads(null, namedNode(`${PREFIX.padi}authorizedPublicKey`), null, null)
            .filter(q => {
                const revoked = this.store.getQuads(q.subject, namedNode(`${PREFIX.padi}isRevoked`), null, null)[0]?.object.value === "true";
                return !revoked;
            })
            .map(q => q.object.value);
    }

    async ingest(payload, signature) {
        const now = Date.now();
        if (payload.timestamp < this.lastTimestamp) throw new Error("TIME_RETROGRESSION");
        if (Math.abs(now - payload.timestamp) > 60000) throw new Error("CLOCK_DRIFT");
        if (this.nonces.has(payload.nonce)) throw new Error("REPLAY_ATTACK");

        // Reactive Revocation Check
        const activeKeys = this.getActiveKeys();
        if (!verifySignature(canonicalize(payload), signature, activeKeys)) throw new Error("AUTH_ERR");

        if (!this.validator(payload)) throw new Error("SCHEMA_ERR");

        // SHACL Semantic Gate
        this._validateSHACL(payload);

        // DAG Commit
        const block = { t: now, p: this.tips, d: payload, s: signature };
        block.hash = hash(canonicalize(block));
        
        // O(1) Atomic Append
        const fd = fs.openSync(LEDGER_PATH, 'a');
        fs.writeSync(fd, JSON.stringify(block) + '\n');
        fs.fsyncSync(fd);
        fs.closeSync(fd);

        // Update Runtime State
        this.nonces.add(payload.nonce);
        if (payload.context === "NodeShape") this.nodeRegistry.set(payload.nodeId, payload);
        this.lastTimestamp = block.t;
        this.tips = [block.hash];

        return block;
    }

    _validateSHACL(payload) {
        const shape = namedNode(`${PREFIX.padi}${payload.context || "StructuralShape"}`);
        const propertyQuads = this.store.getQuads(shape, namedNode(`${PREFIX.sh}property`), null, null);
        if (propertyQuads.length === 0) throw new Error("UNKNOWN_CONTEXT");

        for (const pq of propertyQuads) {
            const path = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}path`), null, null)[0]?.object.value.split(/[#\/]/).pop();
            const val = payload[path];
            const maxQ = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}maxInclusive`), null, null)[0];
            if (maxQ && val > Number(maxQ.object.value)) throw new Error(`SHACL_VIOLATION: ${path}`);
        }
    }
}
