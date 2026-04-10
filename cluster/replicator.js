import { canonicalize, hash, signablePayload, verifySignature } from '../core/lib.js';

export class Replicator {
    constructor(engine) {
        this.engine = engine;
        this.peers = JSON.parse(process.env.PEERS || "[]");
        this.syncing = false; 
    }

    start() { if (this.peers.length) setInterval(() => this.sync(), 3000); }

    async sync() {
        if (this.syncing || this.engine.isLeader || !this.engine.tips.length) return;
        this.syncing = true;
        const peer = this.peers[Math.floor(Math.random() * this.peers.length)];
        try {
            const res = await fetch(`${peer}/ledger/tip`);
            if (!res.ok) throw new Error("FETCH_FAIL");
            const { tip, h } = await res.json();
            if (this.engine.isBetter(h, tip)) {
                await this.backfill(peer, tip);
                this.engine._updateCanonical(tip);
            }
        } catch (e) { this.engine.log("WARN", "SYNC_FAIL", { msg: e.message }); } 
        finally { this.syncing = false; }
    }

    async backfill(peer, tipHash) {
        let currentNeed = tipHash; const stack = [];
        while (currentNeed && !this.engine.blockIndex.has(currentNeed)) {
            const res = await fetch(`${peer}/ledger/block/${currentNeed}`);
            if (!res.ok) throw new Error("BLOCK_FAIL");
            const block = await res.json();
            
            if (hash(canonicalize(block)) !== block.hash || !verifySignature(signablePayload(block.d), block.s, this.engine.publicKeys)) throw new Error("V_FAIL");
            if (!Array.isArray(block.p)) throw new Error("STRUCT_P");
            if (block.h <= 0) throw new Error("STRUCT_H");

            stack.push(block);
            if (block.p.length === 1 && typeof block.p[0] === 'string') {
                currentNeed = block.p[0];
            } else if (block.p.length === 0) {
                currentNeed = null;
            } else { throw new Error("MULTI_PARENT_PROHIBITED"); }
            if (stack.length > 500) break; 
        }
        while (stack.length) {
            const b = stack.pop();
            if (b.p[0] && !this.engine.blockIndex.has(b.p[0])) throw new Error("ORPHAN");
            this.engine.persistBlock(b); this.engine.blockIndex.set(b.hash, b);
        }
    }
}
