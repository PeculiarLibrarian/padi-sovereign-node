import { canonicalize, hash, signablePayload, verifySignature } from '../core/lib.js';

export class Replicator {
    constructor(engine) {
        this.engine = engine;
        this.peers = JSON.parse(process.env.PEERS || "[]");
        this.syncing = false; 
    }

    start() {
        if (this.peers.length) setInterval(() => this.sync(), 3000);
    }

    async sync() {
        if (this.syncing || this.engine.isLeader || !this.engine.tips.length) return;
        this.syncing = true;
        const peer = this.peers[Math.floor(Math.random() * this.peers.length)];
        try {
            const res = await fetch(`${peer}/ledger/tip`, { signal: AbortSignal.timeout(2000) });
            const { tip, height } = await res.json();
            if (this.engine.isBetter(height, tip)) {
                await this.backfill(peer, tip);
                this.engine._updateCanonical(tip);
            }
        } catch (e) { console.error("REPLICATION_ERROR", e.message); } 
        finally { this.syncing = false; }
    }

    async backfill(peer, tipHash) {
        let currentNeed = tipHash;
        const stack = [];
        while (currentNeed && !this.engine.blockIndex.has(currentNeed)) {
            const res = await fetch(`${peer}/ledger/block/${currentNeed}`, { signal: AbortSignal.timeout(3000) });
            const block = await res.json();
            if (hash(canonicalize(block)) !== block.hash) throw new Error("Integrity Fail");
            if (!this.engine.validator(block.d)) throw new Error("Peer Schema Violation");
            if (!verifySignature(signablePayload(block.d), block.s, this.engine.publicKeys)) throw new Error("Peer Auth Violation");
            stack.push(block);
            if (!Array.isArray(block.p) || block.p.length === 0) { currentNeed = null; } 
            else if (block.p.length === 1) { currentNeed = block.p[0]; } 
            else { throw new Error("MULTI_PARENT_NOT_SUPPORTED"); }
        }
        while (stack.length) {
            const b = stack.pop();
            this.engine.persistBlock(b);
            this.engine.blockIndex.set(b.hash, b);
        }
    }
}
