import IoRedis from "ioredis";
import type { Redis as RedisClient } from "ioredis";
import type { ClusterConfig } from "./types.js";

// ioredis v5 ESM: constructor is on the default export
const Redis = IoRedis.default ?? IoRedis;

export interface EngineHandle {
  isLeader:     boolean;
  currentEpoch: number;
  log(lvl: string, evt: string, meta?: Record<string, unknown>): void;
}

export class ClusterManager {
  readonly redis:     RedisClient;
  readonly nodeId:    string;
  readonly leaderKey = "padi:leader";
  readonly epochKey  = "padi:epoch";
  private readonly ttlMs:  number;
  private readonly pollMs: number;

  constructor(
    private readonly engine: EngineHandle,
    private readonly config: ClusterConfig
  ) {
    this.nodeId = config.nodeId;
    this.ttlMs  = config.leaderTtlMs;
    this.pollMs = config.pollIntervalMs;

    const protocol = new URL(config.redisUrl).protocol;
    if (protocol !== "rediss:" && process.env.NODE_ENV === "production") {
      throw new Error(`REDIS_TLS_REQUIRED: use rediss:// in production (got ${protocol})`);
    }

    this.redis = new Redis(config.redisUrl, {
      tls: protocol === "rediss:" ? {} : undefined,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    }) as RedisClient;

    this.redis.on("error", (e: Error) =>
      engine.log("ERROR", "REDIS_ERROR", { msg: e.message })
    );
  }

  async start(): Promise<void> {
    const redisEpoch = parseInt((await this.redis.get(this.epochKey)) ?? "0", 10);
    if (this.engine.currentEpoch > redisEpoch) {
      await this.redis.set(this.epochKey, this.engine.currentEpoch);
      this.engine.log("INFO", "EPOCH_SEEDED_FROM_SNAPSHOT", { epoch: this.engine.currentEpoch });
    }
    await this.poll();
    setInterval(() => this.poll(), this.pollMs);
  }

  async poll(): Promise<void> {
    if (process.env.LEADER_ELIGIBLE !== "true") {
      this.engine.isLeader = false;
      return;
    }
    try {
      const acquired = await this.redis.set(
        this.leaderKey, this.nodeId, "PX", this.ttlMs, "NX"
      );
      if (acquired === "OK") {
        const newEpoch = await this.redis.incr(this.epochKey);
        this.engine.currentEpoch = Math.max(this.engine.currentEpoch, newEpoch);
        this.engine.isLeader = true;
        this.engine.log("INFO", "LEADER_ELECTED", { epoch: this.engine.currentEpoch });
      } else {
        const leader = await this.redis.get(this.leaderKey);
        if (leader === this.nodeId) {
          await this.redis.pexpire(this.leaderKey, this.ttlMs);
          this.engine.isLeader = true;
        } else {
          this.engine.isLeader = false;
          const epoch = parseInt((await this.redis.get(this.epochKey)) ?? "0", 10);
          this.engine.currentEpoch = Math.max(this.engine.currentEpoch, epoch);
        }
      }
    } catch (e) {
      this.engine.isLeader = false;
      this.engine.log("WARN", "REDIS_POLL_FAIL", { msg: (e as Error).message });
    }
  }

  async release(): Promise<void> {
    if ((await this.redis.get(this.leaderKey)) === this.nodeId) {
      await this.redis.del(this.leaderKey);
    }
  }
}
