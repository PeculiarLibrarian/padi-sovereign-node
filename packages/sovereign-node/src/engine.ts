import fs from "node:fs";
import { ClassicLevel } from "classic-level";
import { hash, canonicalize, verifySignature, signablePayload } from "./lib.js";
import { PadiError } from "./errors.js";
import type { Block, Payload } from "./types.js";
import type { SchemaRegistry } from "@samuelmuriithi/schemas";

const DATA_DIR         = process.env.DATA_DIR ?? "./data";
const DB_PATH          = `${DATA_DIR}/index`;
const LEDGER_PATH      = `${DATA_DIR}/ledger.log`;
const SNAPSHOT_PATH    = `${DATA_DIR}/snapshot.json`;
const SNAPSHOT_INTERVAL = parseInt(process.env.SNAPSHOT_INTERVAL ?? "1000", 10);

const K = {
  block:  (h: string) => `b:${h}`,
  nonce:  (n: string) => `n:${n}`,
  height: (h: number) => `h:${String(h).padStart(12, "0")}`,
};

class LRUCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) { this.map.delete(key); this.map.set(key, v); }
    return v;
  }
  set(key: string, v: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, v);
  }
  has(key: string): boolean { return this.map.has(key); }
}

export class PadiEngine {
  private db!: ClassicLevel<string, string>;
  private cache = new LRUCache<Block>(
    parseInt(process.env.BLOCK_CACHE_SIZE ?? "10000", 10)
  );

  public heightIndex  = new Map<number, string>();
  public tips:         string[]  = [];
  public currentHeight = 0;
  public lastTimestamp = 0;
  public currentEpoch  = 0;
  public isLeader      = false;
  public publicKeys:   string[]  = [];
  public cluster:      { redis: { get(k: string): Promise<string | null>; set(k: string, v: string | number): Promise<unknown> }; leaderKey: string; nodeId: string; epochKey: string } | null = null;
  public mutex:        Promise<unknown> = Promise.resolve();

  public readonly blockIndex = {
    has: async (h: string): Promise<boolean> => {
      if (this.cache.has(h)) return true;
      try { await this.db.get(K.block(h)); return true; } catch { return false; }
    },
    get: async (h: string): Promise<Block | undefined> => {
      const cached = this.cache.get(h);
      if (cached) return cached;
      try {
        const raw = await this.db.get(K.block(h));
        const block = JSON.parse(raw) as Block;
        this.cache.set(h, block);
        return block;
      } catch { return undefined; }
    },
  };

  constructor(private readonly registry: SchemaRegistry) {
    this.publicKeys = registry.authorizedPublicKeys;
  }

  async bootstrap(): Promise<void> {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    this.db = new ClassicLevel<string, string>(DB_PATH);

    if (fs.existsSync(SNAPSHOT_PATH)) {
      const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as { h: number; tip: string; epoch: number };
      this.currentHeight = snap.h;
      this.tips          = [snap.tip];
      this.currentEpoch  = Math.max(0, snap.epoch ?? 0);
      this.log("INFO", "SNAPSHOT_RECOVERED", { h: snap.h, epoch: this.currentEpoch });
    }

    const dbEmpty = await this.isDbEmpty();
    if (dbEmpty && fs.existsSync(LEDGER_PATH)) {
      await this.seedFromLedger();
    } else {
      await this.rebuildHeightIndex();
    }
  }

  private async isDbEmpty(): Promise<boolean> {
    for await (const _ of this.db.keys({ limit: 1 })) return false;
    return true;
  }

  private async seedFromLedger(): Promise<void> {
    this.log("INFO", "DB_SEED_START", {});
    const lines = fs.readFileSync(LEDGER_PATH, "utf8").split("\n").filter(Boolean);
    const batch = this.db.batch();
    for (const line of lines) {
      const block = JSON.parse(line) as Block;
      if (hash(canonicalize(block)) !== block.hash)
        throw new PadiError("CHAIN_HASH_MISMATCH", `h=${block.h}`);
      batch.put(K.block(block.hash), JSON.stringify(block));
      batch.put(K.height(block.h), block.hash);
      if (block.d.nonce) batch.put(K.nonce(block.d.nonce), "1");
      this.heightIndex.set(block.h, block.hash);
      this.cache.set(block.hash, block);
      if (this.isBetter(block.h, block.hash)) {
        this.tips          = [block.hash];
        this.currentHeight = block.h;
        this.lastTimestamp = block.t;
        this.currentEpoch  = Math.max(this.currentEpoch, block.e ?? 0);
      }
    }
    await batch.write();
    this.log("INFO", "DB_SEED_COMPLETE", { blocks: lines.length });
  }

  private async rebuildHeightIndex(): Promise<void> {
    for await (const [key, value] of this.db.iterator({ gte: "h:", lte: "h:~" })) {
      const h = parseInt(key.slice(2), 10);
      this.heightIndex.set(h, value);
      if (h > this.currentHeight) { this.currentHeight = h; this.tips = [value]; }
    }
    if (this.tips[0]) {
      const tip = await this.blockIndex.get(this.tips[0]);
      if (tip) { this.lastTimestamp = tip.t; this.currentEpoch = Math.max(this.currentEpoch, tip.e ?? 0); }
    }
  }

  isBetter(h: number, tipHash: string): boolean {
    if (h > this.currentHeight) return true;
    if (h === this.currentHeight && tipHash < (this.tips[0] ?? "z")) return true;
    return false;
  }

  async _updateCanonical(tipHash: string): Promise<void> {
    let curr = await this.blockIndex.get(tipHash);
    const idx = new Map<number, string>();
    while (curr) { idx.set(curr.h, curr.hash); curr = curr.p[0] ? await this.blockIndex.get(curr.p[0]) : undefined; }
    this.heightIndex = idx;
    this.tips        = [tipHash];
    this.currentHeight = Math.max(...idx.keys(), 0);
    const tip = await this.blockIndex.get(tipHash);
    if (tip) { this.lastTimestamp = tip.t; this.currentEpoch = Math.max(this.currentEpoch, tip.e ?? 0); }
  }

  private async hasNonce(nonce: string): Promise<boolean> {
    try { await this.db.get(K.nonce(nonce)); return true; } catch { return false; }
  }

  async ingest(payload: Payload, signature: string): Promise<Block> {
    if (!this.isLeader || process.env.READ_ONLY === "true")
      throw new PadiError("LEADER_INGEST_LOCK");

    const leader = await this.cluster!.redis.get(this.cluster!.leaderKey);
    if (leader !== this.cluster!.nodeId) { this.isLeader = false; throw new PadiError("LEADER_FENCED"); }

    if (payload.epoch !== this.currentEpoch)
      throw new PadiError("EPOCH_MISMATCH", `expected ${this.currentEpoch}, got ${payload.epoch}`);

    return new Promise<Block>((resolve, reject) => {
      this.mutex = this.mutex.then(async () => {
        try {
          const now = Date.now();
          if (payload.timestamp && payload.timestamp > now + 5000) throw new PadiError("SYSTEM_FUTURE_DRIFT");
          if (await this.hasNonce(payload.nonce)) throw new PadiError("REPLAY_NONCE_DUPLICATE");
          if (!this.registry.validate(payload)) throw new PadiError("SCHEMA_INVALID");
          Object.freeze(payload);
          if (!verifySignature(signablePayload(payload), signature, this.publicKeys))
            throw new PadiError("AUTH_SIGNATURE_INVALID");
          this.registry.validateSHACL(payload as unknown as Record<string, unknown>);
          const block: Block = {
            t: Math.max(now, this.lastTimestamp + 1),
            h: this.currentHeight + 1,
            p: this.tips,
            d: payload,
            s: signature,
            e: this.currentEpoch,
            hash: "",
          };
          block.hash = hash(canonicalize(block));
          await this.persistBlock(block);
          resolve(block);
        } catch (e) { reject(e); }
      });
    });
  }

  async persistBlock(block: Block): Promise<void> {
    const fd = fs.openSync(LEDGER_PATH, "a");
    fs.writeSync(fd, JSON.stringify(block) + "\n");
    fs.fsyncSync(fd); fs.closeSync(fd);
    const dirFd = fs.openSync(DATA_DIR, "r");
    fs.fsyncSync(dirFd); fs.closeSync(dirFd);

    const batch = this.db.batch();
    batch.put(K.block(block.hash), JSON.stringify(block));
    batch.put(K.height(block.h), block.hash);
    if (block.d.nonce) batch.put(K.nonce(block.d.nonce), "1");
    await batch.write();

    this.cache.set(block.hash, block);
    this.heightIndex.set(block.h, block.hash);
    this.tips          = [block.hash];
    this.currentHeight = block.h;
    this.lastTimestamp = block.t;
    this.currentEpoch  = Math.max(this.currentEpoch, block.e ?? 0);

    if (block.h % SNAPSHOT_INTERVAL === 0)
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ tip: block.hash, h: block.h, epoch: block.e }));
  }

  log(lvl: string, evt: string, meta: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ t: new Date().toISOString(), lvl, evt, ...meta }));
  }
}
