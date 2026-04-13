// packages/sovereign-node/src/errors.ts

export type ErrorCode =
  | "CANON_UNDEFINED"
  | "CANON_NON_FINITE"
  | "CANON_NON_PLAIN_OBJECT"
  | "AUTH_SIGNATURE_INVALID"
  | "AUTH_KEY_TYPE_VIOLATION"
  | "AUTH_REQUIRED"
  | "CHAIN_HASH_MISMATCH"
  | "CHAIN_BROKEN_PARENT"
  | "CHAIN_ORPHAN"
  | "EPOCH_MISMATCH"
  | "EPOCH_REGRESSION"
  | "EPOCH_STALE_BLOCK"
  | "SCHEMA_INVALID"
  | "SCHEMA_MISSING_CONTEXT"
  | "SCHEMA_UNKNOWN_SHAPE"
  | "SCHEMA_MISSING_FIELD"
  | "SCHEMA_MAX_VIOLATION"
  | "SCHEMA_MIN_VIOLATION"
  | "LEADER_INGEST_LOCK"
  | "LEADER_FENCED"
  | "LEADER_NOT_ELIGIBLE"
  | "REPLAY_NONCE_DUPLICATE"
  | "BACKFILL_LIMIT_EXCEEDED"
  | "BACKFILL_STRUCT_INVALID"
  | "SYSTEM_FUTURE_DRIFT"
  | "SYSTEM_CONFIG_ERROR";

export class PadiError extends Error {
  constructor(public code: ErrorCode, message?: string) {
    super(message || code);
    this.name = "PadiError";
  }
}

export function httpStatusForError(code: ErrorCode): number {
  switch (code) {
    case "AUTH_SIGNATURE_INVALID":
    case "AUTH_KEY_TYPE_VIOLATION":
    case "AUTH_REQUIRED":
      return 401;
    case "REPLAY_NONCE_DUPLICATE":
      return 403;
    case "SCHEMA_INVALID":
    case "SCHEMA_MISSING_CONTEXT":
    case "SCHEMA_UNKNOWN_SHAPE":
    case "SCHEMA_MISSING_FIELD":
    case "SCHEMA_MAX_VIOLATION":
    case "SCHEMA_MIN_VIOLATION":
      return 400;
    case "LEADER_INGEST_LOCK":
    case "LEADER_FENCED":
    case "LEADER_NOT_ELIGIBLE":
      return 409;
    case "CHAIN_HASH_MISMATCH":
    case "CHAIN_BROKEN_PARENT":
    case "EPOCH_MISMATCH":
    case "EPOCH_STALE_BLOCK":
    case "SYSTEM_FUTURE_DRIFT":
      return 422; // State/Time Conflicts
    default:
      return 500;
  }
}
