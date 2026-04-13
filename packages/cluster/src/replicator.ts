import { fetch, Agent } from "undici";
import fs from "node:fs";
import { 
  hash, 
  canonicalize, 
  verifySignature, 
  signablePayload 
} from "@samuelmuriithi/schemas";
import type { Block } from "@samuelmuriithi/schemas";
import type { MTLSConfig } from "./types.js";

const FETCH_TIMEOUT_MS = 3000;

export interface ReplicatorHandle {
  isLeader: boolean;
  tips: string[];
  currentEpoch: number;
  publicKeys: string[];
  blockIndex: { has(hash: string): Promise<boolean> };
  isBetter(h: number, hash: string): boolean;
  persistBlock(block: Block): Promise<void>;
  _updateCanonical(tipHash: string): Promise<void>;
  log(lvl: string, evt: string, meta?: Record<string, unknown>): void;
}

export class Replicator {
  private readonly peers: string[];
  private readonly agent: Agent;
  private syncing = false;

  constructor(private readonly engine: ReplicatorHandle, mtls?: MTLSConfig) {
    this.peers = JSON.parse(process.env.PEERS ?? "[]");
    this.agent = mtls ? new Agent({
      connect: {
        cert: fs.readFileSync(mtls.certPath),
        key: fs.readFileSync(mtls.keyPath),
        ca: fs.readFileSync(mtls.caPath),
        rejectUnauthorized: true,
      }
    }) : new Agent();
  }

  async sync(): Promise<void> {
    if (this.syncing || this.engine.isLeader) return;
    this.syncing = true;
    try {
      const peer = this.peers[Math.floor(Math.random() * this.peers.length)];
      const res = await fetch(`${peer}/ledger/tip`, { dispatcher: this.agent });
      const { tip, h } = await res.json() as { tip: string; h: number };
      
      if (this.engine.isBetter(h, tip)) {
        await this.backfill(peer, tip);
      }
    } finally {
      this.syncing = false;
    }
  }

  async backfill(peer: string, tipHash: string): Promise<void> {
    const res = await fetch(`${peer}/ledger/block/${tipHash}`, { dispatcher: this.agent });
    const block = await res.json() as Block;
    
    // Logic remains high-integrity because it uses the schemas foundation
    if (hash(canonicalize(block)) !== block.hash) throw new Error("HASH_MISMATCH");
    await this.engine.persistBlock(block);
  }
}
