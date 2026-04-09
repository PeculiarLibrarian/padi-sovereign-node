import crypto from 'node:crypto';

// Anchor the domain to v1.8.1 to prevent cross-protocol collisions
const HASH_DOMAIN = "PADI_SOVEREIGN_V1.8.1";

/**
 * DETERMINISTIC CANONICALIZATION (Recursive)
 */
export function canonicalize(obj) {
    if (obj === undefined) throw new Error("CANON_ERR: Undefined values prohibited");
    if (obj === null) return 'null';
    if (typeof obj === 'number') {
        if (!Number.isFinite(obj)) throw new Error("NON_FINITE_NUMBER");
        return Number.isInteger(obj) ? obj.toString() : obj.toFixed(6);
    }
    if (typeof obj === 'string') return JSON.stringify(obj.normalize('NFC'));
    if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    
    const keys = Object.keys(obj).filter(k => k !== 'signature' && k !== 'hash').sort();
    const entries = keys.map(k => `"${k}":${canonicalize(obj[k])}`);
    return `{${entries.join(',')}}`;
}

/**
 * DOMAIN-SEPARATED HASHING
 */
export function hash(data) {
    return crypto.createHash('sha256')
        .update(Buffer.from(HASH_DOMAIN + data, 'utf8'))
        .digest('hex');
}

/**
 * SOVEREIGN SIGNATURE VERIFICATION
 */
export function verifySignature(data, signature, publicKeys) {
    const keys = Array.isArray(publicKeys) ? publicKeys : [publicKeys];
    for (const key of keys) {
        try {
            const ok = crypto.verify(
                undefined, 
                Buffer.from(data, 'utf8'), 
                { key, format: 'pem', type: 'spki' }, 
                Buffer.from(signature, 'base64')
            );
            if (ok) return true;
        } catch { continue; }
    }
    return false;
}

/**
 * UNICODE NORMALIZATION
 */
export const normalize = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim();
