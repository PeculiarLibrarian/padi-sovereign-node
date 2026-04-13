import crypto from "node:crypto";

const HASH_DOMAIN = "PADI_SOVEREIGN_V1.9.7";
const SIGN_DOMAIN = "PADI_PAYLOAD_V1";

export function canonicalize(obj: unknown): string {
  if (obj === undefined) throw new Error("CANON_ERR: Undefined prohibited");
  if (obj === null) return "null";
  if (typeof obj === "boolean") return JSON.stringify(obj);
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) throw new Error("NON_FINITE");
    return Number.isInteger(obj) ? obj.toString() : obj.toPrecision(15);
  }
  if (typeof obj === "string") return JSON.stringify(obj.normalize("NFC"));
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).filter(k => k !== "signature" && k !== "hash").sort();
  return `{${keys.map(k => `"${k}":${canonicalize(record[k])}`).join(",")}}`;
}

export function signablePayload(payload: unknown): string { return SIGN_DOMAIN + canonicalize(payload); }

export function hash(data: string): string {
  return crypto.createHash("sha256").update(Buffer.from(HASH_DOMAIN + data, "utf8")).digest("hex");
}
