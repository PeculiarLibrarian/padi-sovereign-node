import { fetch, Agent } from "undici";
import fs from "node:fs";
import {
  hash,
  canonicalize,
  verifySignature,
  signablePayload,
} from "@samuelmuriithi/sovereign-node";
import type { Block } from "@samuelmuriithi/sovereign-node";
import type { MTLSConfig } from "./types.js";

const FETCH_TIMEOUT_MS = parseInt(process.env.REPL_TIMEOUT_MS ?? "3000", 10);
const BACKFILL_LIMIT   = parseInt(process.env.BACKFILL_LIMIT   ?? "500",  10);

export interface ReplicatorHandle {
  isLeader:     boolean;
  tips:         string[];
  currentEpoch: number;
  publicKeys:   string[];
  blockIndex: {
    has(hash: string): Promise<boolean>;
  };
  isBetter(h: number, hash: string): boolean;
  persistBlock(block: Block): Promise<void>;
  _updateCanonical(tipHash: string): Promise<void>;
  log(lvl: string, evt: string, meta?: Record<string, unknown>): void;
}

export class Replicator {
  private readonly peers:   string[];
  private readonly agent:   Agent;
  private syncing = false;

  constructor(
    private readonly engine: ReplicatorHandle,
    mtls?: MTLSConfig
  ) {
    this.peers = JSON.parse(process.env.PEERS ?? "[]") as string[];

    if (mtls) {
      this.agent = new Agent({
        connect: {
          cert: fs.readFileSync(mtls.certPath),
          key:  fs.readFileSync(mtls.keyPath),
          ca:   fs.readFileSync(mtls.caPath),
          rejectUnauthorized: true,
        },
      });
      engine.log("INFO", "MTLS_AGENT_ACTIVE", { certPath: mtls.certPath });
    } else {
      this.agent = new Agent();
      if (process.env.NODE_ENV === "production") {
        engine.log("WARN", "MTLS_NOT_CONFIGURED", {});
      }
    }
  }

  start(): void {
    if (this.peers.length) setInterval(() => this.sync(), 3000);
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal:     controller.signal,
        dispatcher: this.agent,
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}: ${url}`);
      return res as unknown as Response;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new Error(`TIMEOUT: ${url}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async sync(): Promise<void> {
    if (this.syncing || this.engine.isLeader || !this.engine.tips.length) return;
    this.syncing = true;
    const peer = this.peers[Math.floor(Math.random() * this.peers.length)];
    try {
      const res = await this.fetchWithTimeout(`${peer}/ledger/tip`);
      const { tip, h } = await res.json() as { tip: string; h: number };
      if (this.engine.isBetter(h, tip)) {
        await this.backfill(peer, tip);
        await this.engine._updateCanonical(tip);
      }
    } catch (e) {
      this.engine.log("WARN", "SYNC_FAIL", { msg: (e as Error).message });
    } finally {
      this.syncing = false;
    }
  }

  async backfill(peer: string, tipHash: string): Promise<void> {
    let currentNeed: string | null = tipHash;
    const stack: Block[] = [];

    while (currentNeed && !(await this.engine.blockIndex.has(currentNeed))) {
      if (stack.length >= BACKFILL_LIMIT) {
        throw new Error(`BACKFILL_LIMIT_EXCEEDED: chain depth > ${BACKFILL_LIMIT}`);
      }
      const res   = await this.fetchWithTimeout(`${peer}/ledger/block/${currentNeed}`);
      const block = await res.json() as Block;

      if (hash(canonicalize(block)) !== block.hash) throw new Error("HASH_MISMATCH");
      if (!verifySignature(signablePayload(block.d), block.s, this.engine.publicKeys)) throw new Error("SIG_FAIL");
      if (!Array.isArray(block.p)) throw new Error("STRUCT_P");
      if (block.h <= 0) throw new Error("STRUCT_H");

      const blockEpoch = block.e ?? 0;
      if (blockEpoch < this.engine.currentEpoch - 1) {
        throw new Error(`STALE_EPOCH_BLOCK: block.e=${blockEpoch} floor=${this.engine.currentEpoch}`);
      }

      stack.push(block);
      if (block.p.length === 1 && typeof block.p[0] === "string") {
        currentNeed = block.p[0];
      } else if (block.p.length === 0) {
        currentNeed = null;
      } else {
        throw new Error("MULTI_PARENT_PROHIBITED");
      }
    }

    while (stack.length) {
      const b = stack.pop()!;
      if (b.p[0] && !(await this.engine.blockIndex.has(b.p[0]))) throw new Error("ORPHAN");
      await this.engine.persistBlock(b);
    }
  }
}
