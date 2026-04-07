import crypto from 'node:crypto';
import fs from 'node:fs';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync('padi_private.pem', privateKey);
fs.writeFileSync('padi_public.pem', publicKey);

console.log("\n--- SOVEREIGN IDENTITY GENERATED ---");
console.log("1. PRIVATE KEY: padi_private.pem (KEEP OFFLINE)");
console.log("2. PUBLIC KEY: Paste this into 'padi.ttl'\n");
console.log(publicKey);
