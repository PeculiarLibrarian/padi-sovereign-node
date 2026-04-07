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
        this.tips = ["GENESIS"];
        this.nonces = new Set();
    }

    async bootstrap() {
        this.validator = this.ajv.compile(JSON.parse(fs.readFileSync('./schema.json', 'utf8')));
        const parser = new Parser();
        this.store.addQuads(parser.parse(fs.readFileSync('./padi.ttl', 'utf8')));

        const keyQuads = this.store.getQuads(null, namedNode(`${PREFIX.padi}authorizedPublicKey`), null, null);
        this.publicKeys = keyQuads.map(q => q.object.value).filter(k => k.includes("PUBLIC KEY"));
        
        if (!this.publicKeys.length) throw new Error("BOOTSTRAP_ERR: Identity missing.");

        if (fs.existsSync(LEDGER_PATH)) {
            const lines = fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean);
            let lastHash = "GENESIS";
            for (const line of lines) {
                const block = JSON.parse(line);
                if (hash(canonicalize(block)) !== block.hash) throw new Error("INTEGRITY_BREACH");
                if (!Array.isArray(block.p) || !block.p.includes(lastHash)) throw new Error("CHAIN_BREACH");
                this.nonces.add(block.d.nonce);
                lastHash = block.hash;
            }
            this.tips = [lastHash];
        }
        console.log(`⚓ Bureau v1.6.2: Grounded. Tip: ${this.tips[0].slice(0,8)}`);
    }

    async ingest(payload, signature) {
        const now = Date.now();
        if (Math.abs(now - payload.timestamp) > 60000) throw new Error("CLOCK_DRIFT");
        if (this.nonces.has(payload.nonce)) throw new Error("REPLAY_DETECTED");
        if (!verifySignature(canonicalize(payload), signature, this.publicKeys)) throw new Error("AUTH_ERR");
        if (!this.validator(payload)) throw new Error("SCHEMA_ERR");

        const shape = namedNode(`${PREFIX.padi}${payload.context || "StructuralShape"}`);
        const propertyQuads = this.store.getQuads(shape, namedNode(`${PREFIX.sh}property`), null, null);
        
        for (const pq of propertyQuads) {
            const paths = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}path`), null, null);
            if (paths.length !== 1) throw new Error("SHACL_PATH_ERR");
            
            const field = paths[0].object.value.split(/[#\/]/).pop();
            const val = payload[field];

            // Enforce sh:minCount
            const minCount = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}minCount`), null, null)[0];
            if (minCount?.object.value === "1" && (val === undefined || val === null)) {
                throw new Error(`CARDINALITY_ERR: ${field} required`);
            }

            const maxQ = this.store.getQuads(pq.object, namedNode(`${PREFIX.sh}maxInclusive`), null, null)[0];
            if (maxQ && val > Number(maxQ.object.value)) throw new Error(`MAX_ERR: ${field}`);
        }

        const block = { t: now, p: this.tips, d: payload, s: signature };
        block.hash = hash(canonicalize(block));
        
        const tmp = `${LEDGER_PATH}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(block) + '\n');
        const fd = fs.openSync(tmp, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fs.renameSync(tmp, LEDGER_PATH);

        // Directory Fsync
        const dirFd = fs.openSync('.', 'r');
        fs.fsyncSync(dirFd);
        fs.closeSync(dirFd);

        this.nonces.add(payload.nonce);
        this.tips = [block.hash];
        return block;
    }
}
