export type SdkErrorCode =
  | "INVALID_BASE_URL"
  | "HTTPS_REQUIRED"
  | "API_ERROR"
  | "TIMEOUT"
  | "PARSE_ERROR";

export class SdkError extends Error {
  constructor(
    public readonly code: SdkErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "SdkError";
  }
}
