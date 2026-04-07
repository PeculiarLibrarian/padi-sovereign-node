import crypto from 'node:crypto';

/**
 * Deep Deterministic JSON Canonicalization
 * - Sorts object keys recursively
 * - Handles arrays, primitives, and nested structures
 * - Excludes volatile fields like signature
 */
export function canonicalize(obj) {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalize).join(',') + ']';
    }

    const keys = Object.keys(obj)
        .filter(k => k !== 'signature')
        .sort();

    const entries = keys.map(k => {
        return `"${k}":${canonicalize(obj[k])}`;
    });

    return `{${entries.join(',')}}`;
}

/**
 * SHA-256 Hashing (UTF-8 safe)
 */
export function hash(data) {
    return crypto
        .createHash('sha256')
        .update(Buffer.from(data, 'utf8'))
        .digest('hex');
}

/**
 * Ed25519 Signature Verification
 * - Uses SPKI public key format (PEM)
 * - Expects base64-encoded signature
 */
export function verifySignature(data, signature, publicKey) {
    try {
        return crypto.verify(
            null,
            Buffer.from(data, 'utf8'),
            {
                key: publicKey,
                format: 'pem',
                type: 'spki'
            },
            Buffer.from(signature, 'base64')
        );
    } catch {
        return false;
    }
}

/**
 * Unicode Normalization + Sanitization
 * - Prevents visually similar character attacks
 * - Ensures consistent whitespace handling
 */
export const normalize = (s) =>
    String(s || '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
