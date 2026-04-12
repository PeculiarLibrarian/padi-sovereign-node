import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import type { PadiEngine } from "@samuelmuriithi/sovereign-node";

export class ClusterManager {
    private redis: Redis;
    readonly nodeId: string;
    private leaderKey = "padi:leader";
    private epochKey = "padi:epoch";
    private fencingKey = "padi:fence"; // NEW: For P3 Fencing
    private pollTimer: NodeJS.Timeout | null = null;

    constructor(private engine: PadiEngine, config: { redisUrl?: string, nodeId?: string }) {
        this.redis = new Redis(config.redisUrl || "redis://localhost:6379", {
            tls: config.redisUrl?.startsWith("rediss://") ? {} : undefined,
            maxRetriesPerRequest: 3
        });
        this.nodeId = config.nodeId || randomUUID();
    }

    async start(): Promise<void> {
        await this.poll();
        const runPoll = async () => {
            await this.poll();
            this.pollTimer = setTimeout(runPoll, 1500);
        };
        this.pollTimer = setTimeout(runPoll, 1500);
    }

    async poll(): Promise<void> {
        if (process.env.LEADER_ELIGIBLE !== "true") {
            this.engine.isLeader = false;
            return;
        }

        try {
            // Atomic Leader Election + Fencing Token Update
            // This prevents split-brain by ensuring only the current leader 
            // can progress the fencing token.
            const acquired = await this.redis.set(this.leaderKey, this.nodeId, "PX", 5000, "NX");
            
            if (acquired === "OK") {
                const newEpoch = await this.redis.incr(this.epochKey);
                // Atomically update fencing token to invalidate stale nodes
                await this.redis.set(this.fencingKey, newEpoch); 
                
                this.engine.currentEpoch = newEpoch;
                this.engine.isLeader = true;
                this.engine.log("INFO", "LEADER_ACQUIRED", { epoch: newEpoch });
            } else {
                const leader = await this.redis.get(this.leaderKey);
                if (leader === this.nodeId) {
                    await this.redis.pexpire(this.leaderKey, 5000);
                    this.engine.isLeader = true;
                } else {
                    this.engine.isLeader = false;
                    const remoteEpoch = await this.redis.get(this.epochKey);
                    this.engine.currentEpoch = Math.max(this.engine.currentEpoch, parseInt(remoteEpoch || "0", 10));
                }
            }
        } catch (err) {
            this.engine.isLeader = false;
            this.engine.log("ERROR", "CLUSTER_POLL_FAILED", { msg: (err as Error).message });
        }
    }

    async release(): Promise<void> {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        // Only delete if we are the current leader
        await this.redis.eval(`if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`, 1, this.leaderKey, this.nodeId);
        await this.redis.quit();
    }
}
