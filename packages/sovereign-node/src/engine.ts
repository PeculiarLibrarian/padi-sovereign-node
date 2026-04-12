// packages/sovereign-node/src/engine.ts

import fs from "node:fs";
import { ClassicLevel } from "classic-level";
import { hash, canonicalize, verifySignature, signablePayload } from "./lib.js";
import { PadiError } from "./errors.js";
import type { Block, Payload } from "./types.js";
import type { SchemaRegistry } from "@samuelmuriithi/schemas";
import type { ClusterManager } from "@samuelmuriithi/cluster";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const DB_PATH = `${DATA_DIR}/index`;
const SNAPSHOT_PATH = `${DATA_DIR}/snapshot.json`;

const K = { 
  block: (h: string) => `b:${h}`, 
  nonce: (n: string) => `n:${n}`, 
  height: (h: number) => `h:${String(h).padStart(12, "0")}` 
};

/**
 * G-08: LRU Cache implementation to ensure O(1) access to hot blocks.
 */
class LRUCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v) { this.map.delete(key); this.map.set(key, v); }
    return v;
  }
  set(key: string, v: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, v);
  }
}

export class PadiEngine {
  private db!: ClassicLevel<string, string>;
  private cache = new LRUCache<Block>(10000);
  
  public heightIndex = new Map<number, string>();
  public tips: string[] = [];
  public currentHeight = 0;
  public lastTimestamp = 0;
  public currentEpoch = 0;
  public isLeader = false;
  private mutex = Promise.resolve();
  public cluster: ClusterManager | null = null;
  private readonly publicKeys: string[];

  constructor(private readonly registry: SchemaRegistry) {
    this.publicKeys = registry.authorizedPublicKeys;
  }

  async bootstrap(): Promise<void> {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    this.db = new ClassicLevel(DB_PATH);

    // Bootstrap Efficiency: Use reverse iterator to find current tip instantly
    for await (const [key, value] of this.db.iterator({ gte: "h:", lte: "h:~", reverse: true, limit: 1 })) {
      const h = parseInt(key.slice(2), 10);
      this.currentHeight = h;
      this.tips = [value];
    }
  }

  async ingest(payload: Payload, signature: string): Promise<Block> {
    if (!this.isLeader || process.env.READ_ONLY === "true") throw new PadiError("LEADER_INGEST_LOCK");
    if (payload.epoch !== this.currentEpoch) throw new PadiError("EPOCH_MISMATCH");
    
    return (this.mutex = this.mutex.then(async () => {
      if (await this.hasNonce(payload.nonce)) throw new PadiError("REPLAY_NONCE_DUPLICATE");
      if (!this.registry.validate(payload)) throw new PadiError("SCHEMA_INVALID");
      if (!verifySignature(signablePayload(payload), signature, this.publicKeys)) throw new PadiError("AUTH_SIGNATURE_INVALID");
      
      this.registry.validateSHACL(payload as Record<string, unknown>);

      const block: Block = { 
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

  private async persistBlock(block: Block): Promise<void> {
    const batch = this.db.batch();
    batch.put(K.block(block.hash), JSON.stringify(block));
    batch.put(K.height(block.h), block.hash);
    if (block.d.nonce) batch.put(K.nonce(block.d.nonce), "1");
    await batch.write();

    this.cache.set(block.hash, block);
    this.heightIndex.set(block.h, block.hash);
    this.tips = [block.hash];
    this.currentHeight = block.h;
    this.lastTimestamp = block.t;
  }

  private async hasNonce(nonce: string): Promise<boolean> {
    try { await this.db.get(K.nonce(nonce)); return true; } catch { return false; }
  }

  // Graceful Shutdown
  async close(): Promise<void> {
    await this.db.close();
  }
}
