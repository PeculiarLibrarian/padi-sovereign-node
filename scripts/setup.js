import crypto from 'node:crypto';
import fs from 'fs';
import { canonicalize, hash } from '../core/lib.js';

const DATA_DIR = './data';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync('padi_private.pem', privateKey);
fs.writeFileSync('padi_public.pem', publicKey);

const genesis = { t: 0, h: 0, p: [], d: { system: "PADI_GENESIS", v: "1.9.7" }, s: "ROOT", e: 0 };
genesis.hash = hash(canonicalize(genesis));
fs.writeFileSync(`${DATA_DIR}/ledger.log`, JSON.stringify(genesis) + '\n');

console.log("BUREAU v1.9.7 FINALIZED\nGenesis Hash: " + genesis.hash);
