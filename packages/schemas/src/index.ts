import { createHash } from 'node:crypto';

export interface SchemaRegistry {
    authorizedPublicKeys: string[];
    validate(payload: any): boolean;
    validateSHACL(data: Record<string, unknown>): void;
}

export interface Block {
    hash: string;
    s: string;    // signature
    h: number;    // height
    p: string[];  // parents
    d: any;       // data
    e?: number;   // epoch
    t?: number;   // timestamp
}

export const canonicalize = (obj: any): string => JSON.stringify(obj, Object.keys(obj).sort());
export const hash = (data: string): string => createHash('sha256').update(data).digest('hex');
export const signablePayload = (data: any): string => canonicalize(data);

export const verifySignature = (payload: string, sig: string, keys: string[]): boolean => {
    // Placeholder for cryptographic verification logic
    return sig.length > 0 && keys.length > 0;
};
