import * as fs from "node:fs";
import { ClassicLevel } from "classic-level";

// REQUIRED: Explicit .js extensions for NodeNext resolution
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
    public mutex: Promise<unknown> = Promise.resolve();
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

    log(level: "INFO" | "WARN" | "ERROR", event: string, data?: object) {
        console.log(JSON.stringify({ t: Date.now(), level, event, ...data }));
    }

async ingest(payload: Payload, signature: string): Promise<Block> {
  if (!this.isLeader || process.env.READ_ONLY === "true") {
    throw new PadiError("LEADER_INGEST_LOCK");
  }

  const leader = await this.cluster!.redis.get(this.cluster!.leaderKey);
  if (leader !== this.cluster!.nodeId) {
    this.isLeader = false;
    throw new PadiError("LEADER_FENCED");
  }

  if (payload.epoch !== this.currentEpoch) {
    throw new PadiError("EPOCH_MISMATCH");
  }

  const result = new Promise<Block>((resolve, reject) => {
    this.mutex = this.mutex.then(async () => {
      try {
        const now = Date.now();
        if (payload.timestamp && payload.timestamp > now + 5000) {
          throw new PadiError("SYSTEM_FUTURE_DRIFT");
        }
        if (await this.hasNonce(payload.nonce)) {
          throw new PadiError("REPLAY_NONCE_DUPLICATE");
        }
        if (!this.registry.validate(payload)) {
          throw new PadiError("SCHEMA_INVALID");
        }

        Object.freeze(payload);

        if (!verifySignature(signablePayload(payload), signature, this.publicKeys)) {
          throw new PadiError("AUTH_SIGNATURE_INVALID");
        }

        this.registry.validateSHACL(payload as Record<string, unknown>);

        const block: Block = {
          t:    Math.max(now, this.lastTimestamp + 1),
          h:    this.currentHeight + 1,
          p:    this.tips,
          d:    payload,
          s:    signature,
          e:    this.currentEpoch,
          hash: "",
        };
        block.hash = hash(canonicalize(block));

        await this.persistBlock(block);
        resolve(block);
      } catch (e) {
        reject(e);
      }
    });
  });

  return result;
}

    async persistBlock(block: Block): Promise<void> {
        const batch = this.db.batch();
        batch.put(`b:${block.hash}`, JSON.stringify(block));
        batch.put(`h:${String(block.h).padStart(12, "0")}`, block.hash);
        await batch.write();
        this.tips = [block.hash];
        this.currentHeight = block.h;
    }

    isBetter(h: number, tip: string): boolean { return h > this.currentHeight; }

    get blockIndex() {
        return {
            has: async (h: string) => {
                try { await this.db.get(`b:${h}`); return true; } catch { return false; }
            }
        };
    }
    
    async _updateCanonical(t: string) { this.tips = [t]; }
}
