import Redis from 'ioredis';
import crypto from 'node:crypto';

export class ClusterManager {
    constructor(engine) {
        this.engine = engine;
        this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        this.nodeId = process.env.NODE_ID || crypto.randomUUID();
        this.leaderKey = "padi:leader";
        this.epochKey = "padi:epoch";
    }

    async start() {
        await this.poll();
        setInterval(() => this.poll(), 1500); 
    }

    async poll() {
        // Role Hard-Lock
        if (process.env.LEADER_ELIGIBLE !== "true") { this.engine.isLeader = false; return; }
        
        try {
            const acquired = await this.redis.set(this.leaderKey, this.nodeId, "PX", 5000, "NX");
            if (acquired === "OK") {
                this.engine.currentEpoch = await this.redis.incr(this.epochKey);
                this.engine.isLeader = true;
            } else {
                const leader = await this.redis.get(this.leaderKey);
                if (leader === this.nodeId) {
                    await this.redis.pexpire(this.leaderKey, 5000);
                    this.engine.isLeader = true;
                } else {
                    this.engine.isLeader = false;
                    const epoch = await this.redis.get(this.epochKey);
                    // Invariant: Epoch Monotonicity
                    const nextEpoch = parseInt(epoch || "0", 10);
                    this.engine.currentEpoch = Math.max(this.engine.currentEpoch, nextEpoch);
                }
            }
        } catch (e) { this.engine.isLeader = false; }
    }

    async release() {
        if ((await this.redis.get(this.leaderKey)) === this.nodeId) await this.redis.del(this.leaderKey);
    }
}
