import { PadiError } from "@samuelmuriithi/sovereign-node";

export interface Env {
  PORT: number;
  NODE_ENV: "development" | "staging" | "production";
  READ_ONLY: boolean;
  LEADER_ELIGIBLE: boolean;
  NODE_ID: string;
  REDIS_URL: string;
  API_KEY_SECRET: string | undefined;
  AUTH_DISABLED: boolean;
  PEERS: string[];
  CLUSTER_CERT: string | undefined;
  CLUSTER_KEY: string | undefined;
  CLUSTER_CA: string | undefined;
  SNAPSHOT_INTERVAL: number;
  BLOCK_CACHE_SIZE: number;
  REPL_TIMEOUT_MS: number;
  BACKFILL_LIMIT: number;
  RATE_LIMIT_RPM: number;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new PadiError("SYSTEM_CONFIG_ERROR", `CONFIG_MISSING: ${key}`);
  return v;
}

function optionalEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

function intEnv(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new PadiError("SYSTEM_CONFIG_ERROR", `CONFIG_INVALID: ${key} must be integer`);
  return n;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v === "true";
}

export function loadEnv(): Env {
  const NODE_ENV = (process.env.NODE_ENV ?? "development") as Env["NODE_ENV"];
  const REDIS_URL = requireEnv("REDIS_URL");

  // G-01: Enforce TLS in non-development
  if (NODE_ENV !== "development") {
    const protocol = new URL(REDIS_URL).protocol;
    if (protocol !== "rediss:") {
      throw new PadiError(
        "SYSTEM_CONFIG_ERROR",
        `REDIS_TLS_REQUIRED: use rediss:// in ${NODE_ENV} (got ${protocol})`
      );
    }
  }

  const AUTH_DISABLED = boolEnv("AUTH_DISABLED", false);
  const API_KEY_SECRET = optionalEnv("API_KEY_SECRET");

  if (NODE_ENV === "production" && !AUTH_DISABLED && !API_KEY_SECRET) {
    throw new PadiError("SYSTEM_CONFIG_ERROR", "CONFIG_MISSING: API_KEY_SECRET required in production");
  }

  let PEERS: string[] = [];
  try {
    PEERS = JSON.parse(process.env.PEERS ?? "[]") as string[];
  } catch {
    throw new PadiError("SYSTEM_CONFIG_ERROR", "CONFIG_INVALID: PEERS must be a JSON array");
  }

  return {
    PORT:              intEnv("PORT", 3000),
    NODE_ENV,
    READ_ONLY:         boolEnv("READ_ONLY", false),
    LEADER_ELIGIBLE:   boolEnv("LEADER_ELIGIBLE", false),
    NODE_ID:           requireEnv("NODE_ID"),
    REDIS_URL,
    API_KEY_SECRET,
    AUTH_DISABLED,
    PEERS,
    CLUSTER_CERT:      optionalEnv("CLUSTER_CERT"),
    CLUSTER_KEY:       optionalEnv("CLUSTER_KEY"),
    CLUSTER_CA:        optionalEnv("CLUSTER_CA"),
    SNAPSHOT_INTERVAL: intEnv("SNAPSHOT_INTERVAL", 1000),
    BLOCK_CACHE_SIZE:  intEnv("BLOCK_CACHE_SIZE", 10000),
    REPL_TIMEOUT_MS:   intEnv("REPL_TIMEOUT_MS", 3000),
    BACKFILL_LIMIT:    intEnv("BACKFILL_LIMIT", 500),
    RATE_LIMIT_RPM:    intEnv("RATE_LIMIT_RPM", 60),
  };
}
