import crypto from 'node:crypto';
const HASH_DOMAIN = "PADI_SOVEREIGN_V1.9.7";
const SIGN_DOMAIN = "PADI_PAYLOAD_V1";

export function canonicalize(obj) {
    if (obj === undefined) throw new Error("CANON_ERR: Undefined prohibited");
    if (obj === null) return 'null';
    const type = Object.prototype.toString.call(obj);
    if (type !== '[object Object]' && type !== '[object Array]' && typeof obj === 'object') throw new Error("CANON_ERR: Non-plain");
    if (typeof obj === 'number') {
        if (!Number.isFinite(obj)) throw new Error("NON_FINITE");
        return Number.isInteger(obj) ? obj.toString() : obj.toPrecision(15);
    }
    if (typeof obj === 'string') return JSON.stringify(obj.normalize('NFC'));
    if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    const keys = Object.keys(obj).filter(k => k !== 'signature' && k !== 'hash').sort();
    return `{${keys.map(k => `"${k}":${canonicalize(obj[k])}`).join(',')}}`;
}

export function signablePayload(payload) { return SIGN_DOMAIN + canonicalize(payload); }

export function hash(data) {
    return crypto.createHash('sha256').update(Buffer.from(HASH_DOMAIN + data, 'utf8')).digest('hex');
}

export function verifySignature(data, signature, publicKeys) {
    const keys = Array.isArray(publicKeys) ? publicKeys : [publicKeys];
    const dataBuf = Buffer.from(data, 'utf8');
    const sigBuf = Buffer.from(signature, 'base64');
    for (const pem of keys) {
        try {
            const keyObj = crypto.createPublicKey(pem);
            if (crypto.verify(null, dataBuf, keyObj, sigBuf)) return true;
        } catch { continue; }
    }
    return false;
}

export const normalize = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim();
