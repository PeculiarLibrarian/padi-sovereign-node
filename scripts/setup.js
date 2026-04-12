import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
// Fix 1: Use the workspace-linked package
import { canonicalize, hash } from '@samuelmuriithi/sovereign-node';

const KEYS_DIR = './keys';
const DATA_DIR = './data';

// Fix 2: Create secure directories
[KEYS_DIR, DATA_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log("🏛️  Initializing Nairobi Bureau Identity...");

// Generate Ed25519 Pair
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Save Keys
fs.writeFileSync(path.join(KEYS_DIR, 'padi_private.pem'), privateKey);
fs.writeFileSync(path.join(KEYS_DIR, 'padi_public.pem'), publicKey);

// Fix 4: Reconcile Genesis with PDIM-1 Standard
const genesis = { 
    h: 0, 
    p: [], 
    e: 0, 
    d: { system: "PADI_GENESIS", version: "1.9.7c" },
    n: crypto.randomBytes(8).toString('hex') // Nonce for uniqueness
};

// Calculate initial hash
genesis.hash = hash(canonicalize(genesis));

// Fix 3: Initialize the Ledger Log in the Bureau's data path
fs.writeFileSync(path.join(DATA_DIR, 'ledger.log'), JSON.stringify(genesis) + '\n');

console.log(chalk.green("\n✅ BUREAU IDENTITY FINALIZED"));
console.log(`   Node Identity: :SamuelNode`);
console.log(`   Genesis Hash:  ${genesis.hash}`);
console.log(`   Public Key:    ${path.join(KEYS_DIR, 'padi_public.pem')}`);
console.log(chalk.yellow("\n⚠️  ACTION REQUIRED: Add '/keys' to your .gitignore immediately.\n"));
