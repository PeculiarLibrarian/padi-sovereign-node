import express from 'express';
import { PadiEngine } from './engine.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const engine = new PadiEngine();
await engine.bootstrap();

const server = app.listen(3000, () => {
    engine.log("INFO", "SERVER_STARTED", { port: 3000 });
});

// --- GRACEFUL SHUTDOWN HANDLER ---
const shutdown = async (signal) => {
    engine.log("INFO", "SHUTDOWN_SIGNAL", { signal });
    
    server.close(() => {
        engine.log("INFO", "SERVER_CLOSED");
        // Ensure Tip is stable and temp files are cleared
        if (fs.existsSync('./ledger.log.tmp')) {
            fs.unlinkSync('./ledger.log.tmp');
            engine.log("WARN", "STALE_TMP_CLEARED");
        }
        process.exit(0);
    });

    // Force exit if server.close hangs
    setTimeout(() => {
        engine.log("ERROR", "SHUTDOWN_TIMEOUT");
        process.exit(1);
    }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ... (Existing Routes)
