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
        this.nonces = new Set();
    }

    async bootstrap() {
        this.validator = this.ajv.compile(JSON.parse(fs.readFileSync('./schema.json', 'utf8')));
        const parser = new Parser();
        this.store.addQuads(parser.parse(fs.readFileSync('./padi.ttl', 'utf8')));

        const keyQuads = this.store.getQuads(null, namedNode(`${PREFIX.padi}authorizedPublicKey`), null, null);
        this.publicKeys = keyQuads.map(q => q.object.value).filter(k => k.includes("PUBLIC KEY"));
        
        if (!fs.existsSync(LEDGER_PATH)) throw new Error("LEDGER_MISSING: Run setup.js first.");

        // FULL BOOTSTRAP AUDIT
        const lines = fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
        let lastHash = null;

        for (const [i, line] of lines.entries()) {
            const block = JSON.parse(line);
            // 1. Hash Integrity
            if (hash(canonicalize(block)) !== block.hash) throw new Error(`INTEGRITY_BREACH: Block ${i}`);
            // 2. Continuity
            if (i === 0) {
                if (block.p.length !== 0) throw new Error("GENESIS_LINK_ERR");
            } else {
                if (!block.p.includes(lastHash)) throw new Error(`CHAIN_BREACH: Block ${i}`);
            }
            if (block.d.nonce) this.nonces.add(block.d.nonce);
            lastHash = block.hash;
        }
        this.tips = [lastHash];
        console.log(`⚓ Bureau v1.6.3 Operational. Tip: ${this.tips[0].slice(0,8)}`);
    }

    async ingest(payload, signature) {
        const now = Date.now();
        if (Math.abs(now - payload.timestamp) > 60000) throw new Error("CLOCK_DRIFT");
        if (this.nonces.has(payload.nonce)) throw new Error("REPLAY_DETECTED");
        if (!verifySignature(canonicalize(payload), signature, this.publicKeys)) throw new Error("AUTH_ERR");
        if (!this.validator(payload)) throw new Error("SCHEMA_ERR");

        // SHACL Semantic Gate (Iterative)
        const shape = namedNode(`${PREFIX.padi}${payload.context || "StructuralShape"}`);
        const propertyQuads = this.store.getQuads(shape, namedNode(`${PREFIX.sh}property`), null, null);
        for (const pq of propertyQuads) {
            const path = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}path`), null, null)[0]?.object.value.split(/[#\/]/).pop();
            const val = payload[path];
            const maxQ = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}maxInclusive`), null, null)[0];
            if (maxQ && val > Number(maxQ.object.value)) throw new Error(`MAX_ERR: ${path}`);
        }

        const block = { t: now, p: this.tips, d: payload, s: signature };
        block.hash = hash(canonicalize(block));
        
        // ATOMIC APPEND-ONLY SWAP
        const tmp = `${LEDGER_PATH}.tmp`;
        const currentContent = fs.readFileSync(LEDGER_PATH);
        const newContent = Buffer.concat([currentContent, Buffer.from(JSON.stringify(block) + '\n')]);

        fs.writeFileSync(tmp, newContent);
        const fd = fs.openSync(tmp, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fs.renameSync(tmp, LEDGER_PATH); // Atomic Replace

        // Directory Fsync
        const dirFd = fs.openSync('.', 'r');
        fs.fsyncSync(dirFd);
        fs.closeSync(dirFd);

        this.nonces.add(payload.nonce);
        this.tips = [block.hash];
        return block;
    }
}
