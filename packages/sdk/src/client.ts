import { SdkError } from "./errors.js";
import type { ReplayResult } from "./types.js";

export interface PadiClientOptions {
  baseUrl:    string;
  apiKey?:    string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class PadiClient {
  private readonly baseUrl:    string;
  private readonly apiKey?:    string;
  private readonly timeoutMs:  number;

  constructor(options: PadiClientOptions) {
    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl);
    } catch {
      throw new SdkError("INVALID_BASE_URL", `Not a valid URL: ${options.baseUrl}`);
    }

    if (parsed.protocol !== "https:") {
      throw new SdkError(
        "HTTPS_REQUIRED",
        `SDK requires HTTPS. Got: ${parsed.protocol}`
      );
    }

    this.baseUrl   = options.baseUrl.replace(/\/$/, "");
    this.apiKey    = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body:    body ? JSON.stringify(body) : undefined,
        signal:  controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new SdkError("API_ERROR", `HTTP ${res.status}: ${text}`);
      }
      return res.json() as Promise<T>;
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw new SdkError("TIMEOUT", `Request timed out after ${this.timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(events: unknown[]): Promise<ReplayResult> {
    return this.request<ReplayResult>("POST", "/verify", { events });
  }

  async health(): Promise<{ status: string; height: number; tip: string }> {
    return this.request("GET", "/health");
  }
}
