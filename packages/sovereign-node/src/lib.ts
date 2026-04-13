import crypto from "node:crypto";

const HASH_DOMAIN = "PADI_SOVEREIGN_V1.9.7";
const SIGN_DOMAIN = "PADI_PAYLOAD_V1";

export function canonicalize(obj: unknown): string {
  if (obj === undefined) throw new Error("CANON_ERR: Undefined prohibited");
  if (obj === null) return "null";
  if (typeof obj === "boolean") return JSON.stringify(obj);
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) throw new Error("NON_FINITE");
    if (Object.is(obj, -0)) return "0";
    return Number.isInteger(obj) ? obj.toString() : obj.toPrecision(15);
  }
  if (typeof obj === "string") return JSON.stringify(obj.normalize("NFC"));
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  if (
    typeof obj === "object" &&
    Object.getPrototypeOf(obj) !== Object.prototype
  ) throw new Error("CANON_ERR: Non-plain object");

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => k !== "signature" && k !== "hash")
    .sort();
  return `{${keys.map((k) => `"${k}":${canonicalize(record[k])}`).join(",")}}`;
}

export function signablePayload(payload: unknown): string {
  return SIGN_DOMAIN + canonicalize(payload);
}

export function hash(data: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(HASH_DOMAIN + data, "utf8"))
    .digest("hex");
}

export function verifySignature(
  data: string,
  signature: string,
  publicKeys: string | string[]
): boolean {
  const keys = Array.isArray(publicKeys) ? publicKeys : [publicKeys];
  const dataBuf = Buffer.from(data, "utf8");
  const sigBuf  = Buffer.from(signature, "base64");
  for (const pem of keys) {
    try {
      const keyObj = crypto.createPublicKey(pem);
      if (keyObj.asymmetricKeyType !== "ed25519") {
        throw new Error(
          `KEY_TYPE_VIOLATION: expected ed25519, got ${keyObj.asymmetricKeyType}`
        );
      }
      if (crypto.verify(null, dataBuf, keyObj, sigBuf)) return true;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("KEY_TYPE_VIOLATION")) throw e;
      continue;
    }
  }
  return false;
}

export const normalize = (s: string): string =>
  String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim();
