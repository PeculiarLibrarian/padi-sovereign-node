import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import type { PadiEngine } from "./engine.js"; 

export class ClusterManager {
    private redis: Redis;
    readonly nodeId: string;
    private leaderKey = "padi:leader";
    private pollTimer: NodeJS.Timeout | null = null;

    constructor(private engine: PadiEngine, config: { redisUrl?: string, nodeId?: string }) {
        this.redis = new Redis(config.redisUrl || "redis://localhost:6379");
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
            this.engine.isLeader = (acquired === "OK");
        } catch (err) {
            this.engine.isLeader = false;
        }
    }
}
