import crypto from 'node:crypto';
import fs from 'node:fs';
import { canonicalize, hash } from './lib.js';

// 1. Generate Sovereign Keypair
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync('padi_private.pem', privateKey);
fs.writeFileSync('padi_public.pem', publicKey);

// 2. Materialize Genesis Block (Block 0)
const genesisBlock = {
    t: 0,
    p: [],
    d: { system: "PADI_GENESIS", v: "1.7.0", note: "The Bureau is Open." },
    s: "SOVEREIGN_ROOT"
};

genesisBlock.hash = hash(canonicalize(genesisBlock));

// 3. Initialize Ledger
fs.writeFileSync('ledger.log', JSON.stringify(genesisBlock) + '\n');

console.log("\n--- BUREAU INITIALIZED (v1.7.0) ---");
console.log("1. Genesis Hash:", genesisBlock.hash);
console.log("2. Copy Public Key to 'padi.ttl':\n");
console.log(publicKey);
