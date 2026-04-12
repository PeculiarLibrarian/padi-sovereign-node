/**
 * 🏛️ Nairobi Bureau Operational Constants
 * Hard-coded safety limits and cluster timing values.
 * 
 * Note: These are defaults. Production overrides via env vars 
 * are handled in config/env.ts.
 */

// G-Ops: Cluster Manager Timing
// TTL is 30s; Poll is 3s. This provides a 10x safety factor for leader heartbeats.
export const LEADER_TTL_MS = 30000;    
export const LEADER_POLL_MS = 3000;    

// G-Sec: Perimeter Safety
// Explicitly linked to the express.json({ limit: MAX_BODY_SIZE }) middleware
export const MAX_BODY_SIZE = "1mb";    

// G-07: Pagination Scaling
// Explicitly linked to the ledgerRouter logic
export const LEDGER_PAGE_SIZE = 50;
