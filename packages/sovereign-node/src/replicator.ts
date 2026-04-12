import { fetch, Agent } from "undici";
import { hash, canonicalize, verifySignature, signablePayload } from "./lib.js";
import type { Block } from "./types.js";
import type { PadiEngine } from "./engine.js";

export class Replicator {
    private syncing = false;
    private syncTimer: NodeJS.Timeout | null = null;

    constructor(private readonly engine: PadiEngine, private readonly peers: string[], private readonly agent?: Agent) {}

    public start(): void {
        if (!this.peers.length) return;
        const runSync = async () => { await this.sync(); this.syncTimer = setTimeout(runSync, 3000); };
        runSync();
    }

    async sync(): Promise<void> {
        if (this.syncing || this.engine.isLeader) return;
        this.syncing = true;
        const peer = this.peers[Math.floor(Math.random() * this.peers.length)];
        try {
            const res = await fetch(`${peer}/ledger/tip`, { dispatcher: this.agent });
            const { tip, h } = await res.json() as { tip: string, h: number };
            if (this.engine.isBetter(h, tip)) await this.backfill(peer, tip);
        } catch (e) {
            this.engine.log("WARN", "SYNC_FAIL", { msg: (e as Error).message });
        } finally { this.syncing = false; }
    }

    private async backfill(peer: string, tipHash: string): Promise<void> {
        let currentNeed: string | null = tipHash;
        const stack: Block[] = [];
        while (currentNeed && !(await this.engine.blockIndex.has(currentNeed))) {
            const res = await fetch(`${peer}/ledger/block/${currentNeed}`, { dispatcher: this.agent });
            const block = await res.json() as Block;
            stack.push(block);
            currentNeed = block.p.length === 1 ? block.p[0] : null;
        }
        while (stack.length) {
            const block = stack.pop()!;
            await this.engine.persistBlock(block);
        }
        await this.engine._updateCanonical(tipHash);
    }
}
