// packages/sovereign-node/src/cluster.ts
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import type { PadiEngine } from "./engine.js"; // Fixed Import

export class ClusterManager {
    private redis: Redis;
    readonly nodeId: string;
    private leaderKey = "padi:leader";
    private epochKey = "padi:epoch";
    private fencingKey = "padi:fence";
    private pollTimer: NodeJS.Timeout | null = null;

    constructor(private engine: PadiEngine, config: { redisUrl?: string, nodeId?: string }) {
        this.redis = new Redis(config.redisUrl || "redis://localhost:6379", {
            maxRetriesPerRequest: 3
        });
        this.nodeId = config.nodeId || randomUUID();
    }

    async start(): Promise<void> {
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
            const acquired = await this.redis.set(this.leaderKey, this.nodeId, "PX", 5000, "NX");
            if (acquired === "OK") {
                const newEpoch = await this.redis.incr(this.epochKey);
                await this.redis.set(this.fencingKey, newEpoch);
                this.engine.currentEpoch = newEpoch;
                this.engine.isLeader = true;
                this.engine.log("INFO", "LEADER_ACQUIRED", { epoch: newEpoch });
            } else {
                const leader = await this.redis.get(this.leaderKey);
                this.engine.isLeader = (leader === this.nodeId);
            }
        } catch (err) {
            this.engine.isLeader = false;
            this.engine.log("ERROR", "CLUSTER_POLL_FAILED", { msg: (err as Error).message });
        }
    }

    async release(): Promise<void> {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        await this.redis.quit();
    }
}
