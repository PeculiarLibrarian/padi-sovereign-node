// packages/sovereign-node/src/engine.ts
import * as fs from "node:fs";
import { ClassicLevel } from "classic-level";
import { hash, canonicalize, verifySignature, signablePayload } from "./lib.js";
import { PadiError } from "./errors.js";
import type { Block, Payload } from "./types.js";
import type { SchemaRegistry } from "@samuelmuriithi/schemas";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const DB_PATH = `${DATA_DIR}/index`;

export class PadiEngine {
    private db!: ClassicLevel<string, string>;
    public tips: string[] = [];
    public currentHeight = 0;
    public currentEpoch = 0;
    public isLeader = false;
    private mutex = Promise.resolve();
    private readonly publicKeys: string[];

    constructor(private readonly registry: SchemaRegistry) {
        this.publicKeys = registry.authorizedPublicKeys;
    }

    async bootstrap(): Promise<void> {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        this.db = new ClassicLevel(DB_PATH);
        for await (const [key, value] of this.db.iterator({ gte: "h:", lte: "h:~", reverse: true, limit: 1 })) {
            this.currentHeight = parseInt(key.slice(2), 10);
            this.tips = [value];
        }
    }

    // Helper for logging used by Cluster and Replicator
    log(level: "INFO" | "WARN" | "ERROR", event: string, data?: object) {
        console.log(JSON.stringify({ t: Date.now(), level, event, ...data }));
    }

    async ingest(payload: Payload, signature: string): Promise<Block> {
        if (!this.isLeader) throw new PadiError("LEADER_INGEST_LOCK");
        return (this.mutex = this.mutex.then(async () => {
            const block: Block = {
                t: Date.now(),
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

    async persistBlock(block: Block): Promise<void> {
        const batch = this.db.batch();
        batch.put(`b:${block.hash}`, JSON.stringify(block));
        batch.put(`h:${String(block.h).padStart(12, "0")}`, block.hash);
        await batch.write();
        this.tips = [block.hash];
        this.currentHeight = block.h;
    }

    async _updateCanonical(tipHash: string): Promise<void> {
        this.tips = [tipHash];
    }

    // Needed for Replicator's "isBetter" check
    isBetter(h: number, tip: string): boolean {
        return h > this.currentHeight;
    }

    get blockIndex() {
        return {
            has: async (h: string) => {
                try { await this.db.get(`b:${h}`); return true; } catch { return false; }
            }
        };
    }
}
