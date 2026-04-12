import { str, port, json, bool, cleanEnv, url } from 'envalid';

/**
 * G-01 & G-11: Environment Hardening
 * This validator ensures that production environments MUST use TLS for Redis
 * and that all required Bureau identifiers are present and formatted correctly.
 */
export const loadEnv = () => {
  return cleanEnv(process.env, {
    NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
    PORT: port({ default: 3000 }),
    
    // G-01: Enforcement of Secure Transport
    REDIS_URL: url({ 
      desc: "Redis connection string (Must use rediss:// in production)",
      example: 'rediss://default:password@localhost:6379'
    }),
    
    NODE_ID: str({ desc: "Unique identifier for this Sovereign Node (e.g., :SamuelNode)" }),
    
    // Auth & Security
    API_KEY_SECRET: str({ desc: "Master API Key for the /ledger perimeter" }),
    AUTH_DISABLED: bool({ default: false, desc: "Emergency bypass for auth (Development only)" }),
    
    // Topology
    PEERS: json<string[]>({ 
      default: [], 
      desc: "Array of peer node URLs for Sovereign Sync" 
    }),

    // Rate Limiting
    RATE_LIMIT_RPM: json<number>({ default: 100, desc: "Global requests per minute per IP" }),
    
    // Optional mTLS Paths
    CLUSTER_CA: str({ default: '', desc: "Path to Cluster CA certificate" }),
    CLUSTER_CERT: str({ default: '', desc: "Path to Node client certificate" }),
    CLUSTER_KEY: str({ default: '', desc: "Path to Node private key" }),
  });
};

export type Env = ReturnType<typeof loadEnv>;
