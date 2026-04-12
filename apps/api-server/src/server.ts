import express from "express";
import helmet from "helmet";

import { PadiEngine, PadiError, httpStatusForError } from "@samuelmuriithi/sovereign-node";
import { ClusterManager, Replicator } from "@samuelmuriithi/cluster";
import { loadRegistry } from "@samuelmuriithi/schemas";

import { loadEnv } from "./config/env.js";
import { LEADER_TTL_MS, LEADER_POLL_MS, MAX_BODY_SIZE } from "./config/constants.js";
import { globalRateLimit, ingestRateLimit, requireApiKey, requireSignatureHeader, requestLogger } from "./middleware/index.js";
import { healthRouter } from "./routes/health.js";
import { ledgerRouter } from "./routes/ledger.js";
import { ingestRouter } from "./routes/ingest.js";

// Fix 6: loadEnv() enforces Redis TLS, API key presence, and all
// format constraints. Replaces the bare REQUIRED_ENV presence check.
const env = loadEnv();

const app = express();

// Fix 9: Explicit helmet config — CSP default-src:none, HSTS 2yr+preload.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'none'"],
      scriptSrc:   ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  hsts: {
    maxAge:            63072000,
    includeSubDomains: true,
    preload:           true,
  },
}));

app.use(requestLogger);
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(globalRateLimit(env.RATE_LIMIT_RPM));

const apiKeyMiddleware = requireApiKey(env.API_KEY_SECRET, env.AUTH_DISABLED);

// Fix 1: PadiEngine requires a SchemaRegistry.
// Fix 8: loadRegistry() holds the AJV validator and SHACL store.
//         No separate AJV instantiation needed in server.ts.
const registry = loadRegistry();
const engine   = new PadiEngine(registry);
await engine.bootstrap();

// Fix 2: ClusterManager requires full ClusterConfig.
const cluster = new ClusterManager(engine, {
  nodeId:        env.NODE_ID,
  redisUrl:      env.REDIS_URL,
  leaderTtlMs:   LEADER_TTL_MS,
  pollIntervalMs: LEADER_POLL_MS,
  peers:         env.PEERS,
  mtls:
    env.CLUSTER_CERT && env.CLUSTER_KEY && env.CLUSTER_CA
      ? { certPath: env.CLUSTER_CERT, keyPath: env.CLUSTER_KEY, caPath: env.CLUSTER_CA }
      : undefined,
});
engine.cluster = cluster;

// Fix 3: Replicator reads peers from env internally. mtls config passed directly.
const replicator = new Replicator(
  engine,
  env.CLUSTER_CERT && env.CLUSTER_KEY && env.CLUSTER_CA
    ? { certPath: env.CLUSTER_CERT, keyPath: env.CLUSTER_KEY, caPath: env.CLUSTER_CA }
    : undefined
);

await cluster.start();
replicator.start();

// Fix 4: Routes use engine.blockIndex.get() and engine.heightIndex — see
//         routes/ledger.ts and routes/health.ts. engine.getBlock() does not exist.
app.use("/health",     healthRouter(engine));
app.use("/ledger",     apiKeyMiddleware, ledgerRouter(engine));
app.use("/api/ingest", apiKeyMiddleware, ingestRouter(engine, env));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const code   = err instanceof PadiError ? err.code : "INTERNAL_ERROR";
  const status = err instanceof PadiError ? httpStatusForError(err.code) : 500;
  engine.log("ERROR", code, { msg: err.message });
  res.status(status).json({ error: code });
});

const server = app.listen(env.PORT, () =>
  engine.log("INFO", "BUREAU_PERIMETER_ONLINE", { port: env.PORT, env: env.NODE_ENV })
);

// Fix 5: replicator.stop() replaced with the interval-based pattern.
//         Replicator has no stop() method — the interval runs until process exit.
const gracefulShutdown = async () => {
  engine.log("INFO", "SHUTDOWN_SEQUENCE_STARTING", {});
  await cluster.release();
  server.close(() => {
    engine.log("INFO", "BUREAU_OFFLINE", {});
    process.exit(0);
  });
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT",  gracefulShutdown);
process.on("unhandledRejection", (reason) => {
  engine.log("FATAL", "UNHANDLED_REJECTION", { reason: String(reason) });
  process.exit(1);
});
