import crypto from 'node:crypto';
import fs from 'node:fs';

const HASH_DOMAIN = "PADI_LEDGER_V1.6.2";

// 1. Generate Sovereign Keypair
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync('padi_private.pem', privateKey);
fs.writeFileSync('padi_public.pem', publicKey);

// 2. Materialize Genesis Block
const genesisBlock = {
    t: 0,
    p: [],
    d: { system: "PADI_GENESIS", v: "1.6.2" },
    s: "SOVEREIGN_ROOT"
};

// Deterministic Canonicalizer & Hash
const canonicalize = (obj) => {
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `"${k}":${JSON.stringify(obj[k])}`).join(',')}}`;
};

const genesisHash = crypto.createHash('sha256')
    .update(Buffer.from(HASH_DOMAIN + canonicalize(genesisBlock), 'utf8'))
    .digest('hex');

genesisBlock.hash = genesisHash;

// 3. Initialize Ledger
fs.writeFileSync('ledger.log', JSON.stringify(genesisBlock) + '\n');

console.log("\n--- BUREAU INITIALIZED ---");
console.log("1. Private Key: padi_private.pem (KEEP SECRET)");
console.log("2. Genesis Block Hash:", genesisHash);
console.log("3. Copy Public Key into 'padi.ttl':\n");
console.log(publicKey);
