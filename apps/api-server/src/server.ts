// apps/api-server/src/server.ts

import express from "express";
import helmet from "helmet";
import { PadiEngine } from "@samuelmuriithi/sovereign-node";
import { ClusterManager, Replicator } from "@samuelmuriithi/cluster";
import { loadRegistry } from "@samuelmuriithi/schemas";
import { loadEnv } from "./config/env.js";
import { LEADER_TTL_MS, LEADER_POLL_MS, MAX_BODY_SIZE } from "./config/constants.js";
import { globalRateLimit, requireApiKey, requestLogger } from "./middleware/index.js";
import { ingestRouter } from "./routes/ingest.js";
import { healthRouter } from "./routes/health.js";
import { ledgerRouter } from "./routes/ledger.js";

const env = loadEnv();
const app = express();

// G-10: Security headers — CSP locked to 'none', HSTS preloaded
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 63072000, 
    includeSubDomains: true,
    preload: true,
  },
}));

app.use(requestLogger);
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(globalRateLimit(env.RATE_LIMIT_RPM));

const apiKeyMiddleware = requireApiKey(env.API_KEY_SECRET, env.AUTH_DISABLED);

// Bootstrap Engine
const registry = loadRegistry();
const engine = new PadiEngine(registry);
await engine.bootstrap();

// Bootstrap Cluster
const cluster = new ClusterManager(engine, {
  nodeId: env.NODE_ID,
  redisUrl: env.REDIS_URL,
  leaderTtlMs: LEADER_TTL_MS,
  pollIntervalMs: LEADER_POLL_MS,
  peers: env.PEERS,
});
engine.cluster = cluster;
await cluster.start();

const replicator = new Replicator(engine as any);
replicator.start();

// Routes
app.use("/health", healthRouter(engine));
app.use("/ledger", apiKeyMiddleware, ledgerRouter(engine));
app.use("/api/ingest", apiKeyMiddleware, ingestRouter(engine, env));

// Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  engine.log("ERROR", "UNHANDLED_EXCEPTION", { msg: err.message });
  res.status(500).json({ error: "INTERNAL_ERROR" });
});

const server = app.listen(env.PORT, () =>
  engine.log("INFO", "ONLINE", { port: env.PORT, env: env.NODE_ENV })
);

// Graceful Shutdown Enforcement
const shutdown = async () => {
  engine.log("INFO", "SHUTDOWN_INITIATED", {});
  await cluster.release();
  await engine.close(); // Cleanly close LevelDB
  server.close(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (e: any) => {
  engine.log("FATAL", "UNHANDLED_REJECTION", { msg: e.message });
  process.exit(1);
});
