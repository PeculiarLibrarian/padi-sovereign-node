// packages/sovereign-node/src/errors.ts

/**
 * PADI Structured Error Taxonomy (PDIM-1.2)
 * 
 * This taxonomy is exhaustive. Any state transition violation must map to a 
 * code defined here. This allows for:
 * 1. Deterministic audit log analysis.
 * 2. SOC 2 CC7.2 incident response classification.
 * 3. Consistent SDK-side error discrimination.
 */

export type ErrorCode =
  // Canonicalization
  | "CANON_UNDEFINED"
  | "CANON_NON_FINITE"
  | "CANON_NON_PLAIN_OBJECT"
  // Authentication
  | "AUTH_SIGNATURE_INVALID"
  | "AUTH_KEY_TYPE_VIOLATION"
  | "AUTH_REQUIRED"
  // Chain integrity
  | "CHAIN_HASH_MISMATCH"
  | "CHAIN_BROKEN_PARENT"
  | "CHAIN_ORPHAN"
  // Epoch
  | "EPOCH_MISMATCH"
  | "EPOCH_REGRESSION"
  | "EPOCH_STALE_BLOCK"
  // Schema
  | "SCHEMA_INVALID"
  | "SCHEMA_MISSING_CONTEXT"
  | "SCHEMA_UNKNOWN_SHAPE"
  | "SCHEMA_MISSING_FIELD"
  | "SCHEMA_MAX_VIOLATION"
  | "SCHEMA_MIN_VIOLATION"
  // Leader
  | "LEADER_INGEST_LOCK"
  | "LEADER_FENCED"
  | "LEADER_NOT_ELIGIBLE"
  // Replay
  | "REPLAY_NONCE_DUPLICATE"
  // Backfill
  | "BACKFILL_LIMIT_EXCEEDED"
  | "BACKFILL_STRUCT_INVALID"
  // System
  | "SYSTEM_FUTURE_DRIFT"
  | "SYSTEM_CONFIG_ERROR";

export class PadiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "PadiError";
  }

  /**
   * Serializes the error for secure API transport.
   * Prevents stack trace leakage (G-06).
   */
  toJSON(): { code: ErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

/** 
 * Map protocol error codes to HTTP status codes for the API Gateway.
 * Adheres to G-12 (Structured Error Taxonomy).
 */
export function httpStatusForError(code: ErrorCode): number {
  switch (code) {
    case "AUTH_SIGNATURE_INVALID":
    case "AUTH_KEY_TYPE_VIOLATION":
    case "AUTH_REQUIRED":
      return 401;
      
    case "LEADER_INGEST_LOCK":
    case "LEADER_FENCED":
    case "LEADER_NOT_ELIGIBLE":
    case "EPOCH_MISMATCH":
      return 403;
      
    case "SCHEMA_INVALID":
    case "SCHEMA_MISSING_CONTEXT":
    case "SCHEMA_UNKNOWN_SHAPE":
    case "SCHEMA_MISSING_FIELD":
    case "SCHEMA_MAX_VIOLATION":
    case "SCHEMA_MIN_VIOLATION":
    case "REPLAY_NONCE_DUPLICATE":
    case "SYSTEM_FUTURE_DRIFT":
    case "EPOCH_REGRESSION":
      return 422;
      
    case "CHAIN_HASH_MISMATCH":
    case "CHAIN_BROKEN_PARENT":
    case "CHAIN_ORPHAN":
    case "BACKFILL_LIMIT_EXCEEDED":
    case "BACKFILL_STRUCT_INVALID":
    case "CANON_UNDEFINED":
    case "CANON_NON_FINITE":
    case "CANON_NON_PLAIN_OBJECT":
      return 500;
      
    default:
      return 500;
  }
}
