export type ErrorCode = 
  | "AUTH_SIGNATURE_INVALID" 
  | "AUTH_KEY_TYPE_VIOLATION" 
  | "AUTH_REQUIRED" 
  | "LEADER_INGEST_LOCK" 
  | "NONCE_REPLAY" 
  | "SCHEMA_VIOLATION";

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
    case "NONCE_REPLAY":
      return 403;
    case "SCHEMA_VIOLATION":
      return 400;
    case "LEADER_INGEST_LOCK":
      return 409;
    default:
      return 500;
  }
}
