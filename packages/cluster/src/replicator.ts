import { fetch, Agent } from "undici";
import { hash, canonicalize, verifySignature, signablePayload } from "@samuelmuriithi/sovereign-node";
import type { Block } from "@samuelmuriithi/sovereign-node";
import type { ReplicatorHandle } from "./types.js";

/**
 * G-07: Bounded Backfill Limit
 * Prevents memory exhaustion during deep synchronization cycles.
 */
const BACKFILL_LIMIT = 100;

/**
 * Replicator
 * The "Nervous System" of the Nairobi Bureau, responsible for 
 * height-based ledger synchronization across the peer network.
 */
export class Replicator {
    private syncing = false;
    private syncTimer: NodeJS.Timeout | null = null;

    constructor(
        private readonly engine: ReplicatorHandle, 
        private readonly peers: string[],
        private readonly agent?: Agent // G-09: Injected mTLS agent for P2P trust
    ) {}

    /**
     * P5: Initiates the recursive synchronization loop.
     */
    public start(): void {
        if (!this.peers.length) return;
        
        const runSync = async () => {
            await this.sync();
            // G-Ops: Self-correcting timeout to prevent interval overlap
            this.syncTimer = setTimeout(runSync, 3000);
        };
        this.syncTimer = setTimeout(runSync, 3000);
    }

    /**
     * Primary Sync Logic
     * Performs a random-walk peer selection to observe the network tip.
     */
    async sync(): Promise<void> {
        // P3: Follower-only sync; Leaders provide the truth, they do not seek it.
        if (this.syncing || this.engine.isLeader) return;
        
        this.syncing = true;
        const peer = this.peers[Math.floor(Math.random() * this.peers.length)];

        try {
            // G-09: Secure transport via undici dispatcher
            const res = await fetch(`${peer}/ledger/tip`, { dispatcher: this.agent });
            if (!res.ok) throw new Error(`HTTP_${res.status}`);

            const { tip, h } = await res.json() as { tip: string, h: number };
            
            // P1: Height-based synchronization gate (O(1) Check)
            if (this.engine.isBetter(h, tip)) {
                this.engine.log("INFO", "SYNC_START", { peer, remoteH: h });
                await this.backfill(peer, tip);
            }
        } catch (e) {
            this.engine.log("WARN", "SYNC_FAIL", { peer, msg: (e as Error).message });
        } finally {
            this.syncing = false;
        }
    }

    /**
     * Backfill Logic
     * Deterministically reconstructs the lineage from the remote tip.
     */
    private async backfill(peer: string, tipHash: string): Promise<void> {
        let currentNeed: string | null = tipHash;
        const stack: Block[] = [];

        // P1: Lineage Reconstruction Phase
        while (currentNeed && !(await this.engine.blockIndex.has(currentNeed))) {
            if (stack.length >= BACKFILL_LIMIT) {
                throw new Error("BACKFILL_LIMIT_EXCEEDED");
            }
            
            const res = await fetch(`${peer}/ledger/block/${currentNeed}`, { 
                dispatcher: this.agent 
            });
            if (!res.ok) throw new Error(`BLOCK_FETCH_FAIL: ${currentNeed}`);
            
            const block = await res.json() as Block;

            // P2: Cryptographic Verification (Must match Core Determinism)
            const isSignatureValid = verifySignature(
                signablePayload(block.d), 
                block.s, 
                this.engine.publicKeys
            );

            if (!isSignatureValid || hash(canonicalize(block)) !== block.hash) {
                throw new Error("BLOCK_VERIFICATION_FAILED");
            }

            stack.push(block);
            
            // P1: Single-parent chain enforcement (No multi-parent DAG allowed)
            currentNeed = block.p.length === 1 ? block.p[0] : null;
        }

        // P2/P4: Commitment Phase
        // We pop from the LIFO stack to persist blocks in chronological order.
        while (stack.length) {
            const block = stack.pop()!;
            // Bypass ingest() logic to avoid leadership write-locks on verified data
            this.engine.persistBlock(block);
        }

        // Finalize the local tip to the new height
        await this.engine._updateCanonical(tipHash);
    }

    /**
     * Graceful Shutdown: Clears timers to prevent process hanging.
     */
    public stop(): void {
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
        }
    }
}
