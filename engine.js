import fs from 'fs';
import { hash, canonicalize, verifySignature } from './lib.js';

// ... (Existing Class Setup)

    async ingest(payload, signature) {
        this.log("INFO", "INGEST_START", { nonce: payload.nonce });
        
        // ... (Existing Gates 0, 1, 2)

        const block = { t: Date.now(), p: this.tips, d: payload, s: signature };
        block.hash = hash(canonicalize(block));
        
        // --- ATOMIC COMMIT STAGING ---
        const tmpPath = `${LEDGER_PATH}.tmp`;
        try {
            // 1. Write to temporary staging
            const currentLedger = fs.readFileSync(LEDGER_PATH);
            const updatedLedger = Buffer.concat([currentLedger, Buffer.from(JSON.stringify(block) + '\n')]);
            fs.writeFileSync(tmpPath, updatedLedger);
            
            // 2. Force physical disk sync
            const fd = fs.openSync(tmpPath, 'r');
            fs.fsyncSync(fd);
            fs.closeSync(fd);

            // 3. Atomic Rename (The Moment of Truth)
            fs.renameSync(tmpPath, LEDGER_PATH);
        } catch (err) {
            this.log("ERROR", "COMMIT_FAILURE", { error: err.message });
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            throw new Error("PERSISTENCE_FAILURE");
        }

        this.log("SUCCESS", "BLOCK_COMMITTED", { hash: block.hash });
        
        this.nonces.add(payload.nonce);
        if (payload.context === "NodeShape") this.nodeRegistry.set(payload.nodeId, payload);
        this.lastTimestamp = block.t;
        this.tips = [block.hash];

        return block;
    }

    /**
     * Structured Logging for Agent Observability
     */
    log(level, event, metadata = {}) {
        const entry = JSON.stringify({
            t: new Date().toISOString(),
            lvl: level,
            evt: event,
            ...metadata
        });
        console.log(entry); // Standard out for log aggregators
    }
