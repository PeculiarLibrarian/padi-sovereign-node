// packages/sovereign-node/src/engine.ts
import * as fs from "node:fs"; // Fix for TS1192: Use namespace import
import { ClassicLevel } from "classic-level";
// Fix for TS2307: Remove .js extensions for local TS files
import { hash, canonicalize, verifySignature, signablePayload } from "./lib";
import { PadiError } from "./errors";
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const DB_PATH = `${DATA_DIR}/index`;
const SNAPSHOT_PATH = `${DATA_DIR}/snapshot.json`;
const K = {
    block: (h) => `b:${h}`,
    nonce: (n) => `n:${n}`,
    height: (h) => `h:${String(h).padStart(12, "0")}`
};
/**
 * G-08: LRU Cache implementation to ensure O(1) access to hot blocks.
 */
class LRUCache {
    max;
    map = new Map();
    constructor(max) {
        this.max = max;
    }
    get(key) {
        const v = this.map.get(key);
        if (v) {
            this.map.delete(key);
            this.map.set(key, v);
        }
        return v;
    }
    set(key, v) {
        if (this.map.size >= this.max)
            this.map.delete(this.map.keys().next().value);
        this.map.set(key, v);
    }
}
export class PadiEngine {
    registry;
    db;
    cache = new LRUCache(10000);
    heightIndex = new Map();
    tips = [];
    currentHeight = 0;
    lastTimestamp = 0;
    currentEpoch = 0;
    isLeader = false;
    mutex = Promise.resolve();
    cluster = null;
    publicKeys;
    constructor(registry) {
        this.registry = registry;
        this.publicKeys = registry.authorizedPublicKeys;
    }
    async bootstrap() {
        if (!fs.existsSync(DATA_DIR))
            fs.mkdirSync(DATA_DIR, { recursive: true });
        this.db = new ClassicLevel(DB_PATH);
        for await (const [key, value] of this.db.iterator({ gte: "h:", lte: "h:~", reverse: true, limit: 1 })) {
            const h = parseInt(key.slice(2), 10);
            this.currentHeight = h;
            this.tips = [value];
        }
    }
    async ingest(payload, signature) {
        if (!this.isLeader || process.env.READ_ONLY === "true")
            throw new PadiError("LEADER_INGEST_LOCK");
        if (payload.epoch !== this.currentEpoch)
            throw new PadiError("EPOCH_MISMATCH");
        return (this.mutex = this.mutex.then(async () => {
            if (await this.hasNonce(payload.nonce))
                throw new PadiError("REPLAY_NONCE_DUPLICATE");
            if (!this.registry.validate(payload))
                throw new PadiError("SCHEMA_INVALID");
            if (!verifySignature(signablePayload(payload), signature, this.publicKeys))
                throw new PadiError("AUTH_SIGNATURE_INVALID");
            this.registry.validateSHACL(payload);
            const block = {
                t: Math.max(Date.now(), this.lastTimestamp + 1),
                h: this.currentHeight + 1,
                p: this.tips,
                d: payload,
                s: signature,
                e: this.currentEpoch,
                hash: ""
            };
            block.hash = hash(canonicalize(block));
            await this.persistBlock(block);
            return block;
        }));
    }
    async persistBlock(block) {
        const batch = this.db.batch();
        batch.put(K.block(block.hash), JSON.stringify(block));
        batch.put(K.height(block.h), block.hash);
        if (block.d.nonce)
            batch.put(K.nonce(block.d.nonce), "1");
        await batch.write();
        this.cache.set(block.hash, block);
        this.heightIndex.set(block.h, block.hash);
        this.tips = [block.hash];
        this.currentHeight = block.h;
        this.lastTimestamp = block.t;
    }
    async hasNonce(nonce) {
        try {
            await this.db.get(K.nonce(nonce));
            return true;
        }
        catch {
            return false;
        }
    }
    async close() {
        await this.db.close();
    }
}
//# sourceMappingURL=engine.js.map