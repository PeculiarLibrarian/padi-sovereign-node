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
        this.nonces = new Set();
        this.nodeRegistry = new Map();
        this.lastTimestamp = 0;
        this.publicKeys = [];
    }

    async bootstrap() {
        this.log("INFO", "BOOTSTRAP_START");
        try {
            // 1. Load Syntactic Schema
            this.validator = this.ajv.compile(JSON.parse(fs.readFileSync('./schema.json', 'utf8')));

            // 2. Load Semantic Ontology
            const parser = new Parser();
            this.store.addQuads(parser.parse(fs.readFileSync('./padi.ttl', 'utf8')));

            // 3. Extract Authorized Keys
            const keyQuads = this.store.getQuads(null, namedNode(`${PREFIX.padi}authorizedPublicKey`), null, null);
            this.publicKeys = keyQuads.map(q => q.object.value).filter(k => k.includes("PUBLIC KEY"));
            if (!this.publicKeys.length) throw new Error("No valid keys in padi.ttl");

            // 4. Ledger Integrity Audit
            if (fs.existsSync(LEDGER_PATH)) {
                const lines = fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
                let lastHash = null;

                for (const [i, line] of lines.entries()) {
                    const block = JSON.parse(line);
                    if (hash(canonicalize(block)) !== block.hash) throw new Error(`Hash mismatch at block ${i}`);
                    
                    if (i === 0) {
                        if (block.p.length !== 0) throw new Error("Genesis parent error");
                    } else {
                        if (!block.p.includes(lastHash)) throw new Error(`Continuity breach at block ${i}`);
                        if (block.t < this.lastTimestamp) throw new Error(`Time retrogression at block ${i}`);
                    }
                    
                    if (block.d?.nonce) this.nonces.add(block.d.nonce);
                    if (block.d?.context === "NodeShape") this.nodeRegistry.set(block.d.nodeId, block.d);
                    
                    lastHash = block.hash;
                    this.lastTimestamp = block.t;
                }
                this.tips = [lastHash];
            }
            this.log("SUCCESS", "ENGINE_ONLINE", { tip: this.tips[0]?.slice(0,8), nodes: this.nodeRegistry.size });
        } catch (err) {
            this.log("ERROR", "BOOTSTRAP_FAILED", { error: err.message });
            process.exit(1);
        }
    }

    async ingest(payload, signature) {
        this.log("INFO", "INGEST_START", { nonce: payload.nonce });
        const now = Date.now();

        // Gate 0: Replay & Auth
        if (this.nonces.has(payload.nonce)) throw new Error("REPLAY_DETECTED");
        if (payload.timestamp < this.lastTimestamp) throw new Error("TIME_RETROGRESSION");
        if (!verifySignature(canonicalize(payload), signature, this.publicKeys)) throw new Error("AUTH_ERR");

        // Gate 1: Syntax
        if (!this.validator(payload)) throw new Error("SCHEMA_ERR");

        // Gate 2: Semantics (SHACL)
        this._validateSHACL(payload);

        // DAG Commit
        const block = { t: now, p: this.tips, d: payload, s: signature };
        block.hash = hash(canonicalize(block));
        
        // Atomic Commit Staging
        const tmpPath = `${LEDGER_PATH}.tmp`;
        const currentLedger = fs.existsSync(LEDGER_PATH) ? fs.readFileSync(LEDGER_PATH) : Buffer.alloc(0);
        const updatedLedger = Buffer.concat([currentLedger, Buffer.from(JSON.stringify(block) + '\n')]);
        
        fs.writeFileSync(tmpPath, updatedLedger);
        const fd = fs.openSync(tmpPath, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fs.renameSync(tmpPath, LEDGER_PATH);

        // Update State
        this.nonces.add(payload.nonce);
        if (payload.context === "NodeShape") this.nodeRegistry.set(payload.nodeId, payload);
        this.lastTimestamp = block.t;
        this.tips = [block.hash];

        this.log("SUCCESS", "BLOCK_COMMITTED", { hash: block.hash });
        return block;
    }

    _validateSHACL(payload) {
        const shape = namedNode(`${PREFIX.padi}${payload.context || "StructuralShape"}`);
        const propertyQuads = this.store.getQuads(shape, namedNode(`${PREFIX.sh}property`), null, null);
        if (!propertyQuads.length) throw new Error("UNKNOWN_CONTEXT");

        for (const pq of propertyQuads) {
            const path = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}path`), null, null)[0]?.object.value.split(/[#\/]/).pop();
            const val = payload[path];
            const maxQ = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}maxInclusive`), null, null)[0];
            if (maxQ && val > Number(maxQ.object.value)) throw new Error(`SHACL_VIOLATION: ${path} exceeds limit`);
        }
    }

    log(level, event, metadata = {}) {
        console.log(JSON.stringify({ t: new Date().toISOString(), lvl: level, evt: event, ...metadata }));
    }
}
