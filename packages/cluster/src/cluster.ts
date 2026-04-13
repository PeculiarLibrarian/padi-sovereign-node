import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
// Ensure this path matches the name in packages/sovereign-node/package.json
import type { PadiEngine } from "@samuelmuriithi/sovereign-node"; 

export class ClusterManager {
    private redis: Redis;
    readonly nodeId: string;
    private leaderKey = "padi:leader";
    private epochKey = "padi:epoch";
    private fencingKey = "padi:fence";
    private pollTimer: NodeJS.Timeout | null = null;

    constructor(private engine: PadiEngine, config: { redisUrl?: string, nodeId?: string }) {
        // Use ioredis default constructor, passing TLS explicitly via options
        this.redis = new Redis(config.redisUrl || "redis://localhost:6379", {
            tls: config.redisUrl?.startsWith("rediss://") ? {} : undefined,
            maxRetriesPerRequest: 3
        });
        this.nodeId = config.nodeId || randomUUID();
    }

    async start(): Promise<void> {
        // G-Ops: Recursive timeout to prevent interval overlap
        const runPoll = async () => {
            await this.poll();
            this.pollTimer = setTimeout(runPoll, 1500);
        };
        await runPoll();
    }

    async poll(): Promise<void> {
        if (process.env.LEADER_ELIGIBLE !== "true") {
            this.engine.isLeader = false;
            return;
        }
        try {
            // NX = Only set if not exists | PX = Milliseconds
            const acquired = await this.redis.set(this.leaderKey, this.nodeId, "PX", 5000, "NX");
            
            if (acquired === "OK") {
                const newEpoch = await this.redis.incr(this.epochKey);
                await this.redis.set(this.fencingKey, newEpoch.toString());
                this.engine.currentEpoch = newEpoch;
                this.engine.isLeader = true;
                this.engine.log("INFO", "LEADER_ACQUIRED", { epoch: newEpoch });
            } else {
                const leader = await this.redis.get(this.leaderKey);
                this.engine.isLeader = (leader === this.nodeId);
                
                // Keep epoch in sync even if not leader
                const remoteEpoch = await this.redis.get(this.epochKey);
                if (remoteEpoch) {
                    this.engine.currentEpoch = Math.max(this.engine.currentEpoch, parseInt(remoteEpoch, 10));
                }
            }
        } catch (err) {
            this.engine.isLeader = false;
            this.engine.log("ERROR", "CLUSTER_POLL_FAILED", { msg: (err as Error).message });
        }
    }

    async release(): Promise<void> {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        // Only release if we own it
        const currentLeader = await this.redis.get(this.leaderKey);
        if (currentLeader === this.nodeId) {
            await this.redis.del(this.leaderKey);
        }
        await this.redis.quit();
    }
}
