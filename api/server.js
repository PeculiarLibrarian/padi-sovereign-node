import express from 'express';
import { PadiEngine } from '../core/engine.js';
import { ClusterManager } from '../cluster/cluster.js';
import { Replicator } from '../cluster/replicator.js';

if (!process.env.REDIS_URL) throw new Error("CONFIG_ERR: REDIS_URL required");
const app = express();
app.use(express.json({ limit: '1mb' }));
const engine = new PadiEngine();
await engine.bootstrap();
const cluster = new ClusterManager(engine);
engine.cluster = cluster; 
const replicator = new Replicator(engine);
await cluster.start();
replicator.start();

app.get('/health', (req, res) => res.json({ 
    status: "OK", leader: engine.isLeader, epoch: engine.currentEpoch, 
    tip: engine.tips[0], height: engine.currentHeight 
}));

app.get('/ledger/tip', (req, res) => res.json({ tip: engine.tips[0], height: engine.currentHeight }));
app.get('/ledger/block/:hash', (req, res) => {
    const b = engine.blockIndex.get(req.params.hash);
    b ? res.json(b) : res.status(404).json({ error: "NOT_FOUND" });
});

app.get('/ledger/since/:hash', (req, res) => {
    const path = engine.canonicalPath;
    if (req.params.hash === 'genesis') return res.json({ blocks: path });
    const idx = path.findIndex(b => b.hash === req.params.hash);
    res.json({ blocks: idx === -1 ? [] : path.slice(idx + 1) });
});

app.post('/api/ingest', async (req, res) => {
    const sig = req.headers['x-padi-signature'];
    if (!sig) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (req.body.epoch !== engine.currentEpoch) return res.status(403).json({ error: "EPOCH_MISMATCH" });
    try {
        const block = await engine.ingest(req.body, sig);
        res.json({ status: "COMMITTED", hash: block.hash });
    } catch (err) {
        const code = (err.message === "NODE_NOT_LEADER" || err.message === "LEADER_FENCED") ? 403 : 422;
        res.status(code).json({ error: err.message });
    }
});

const server = app.listen(process.env.PORT || 3000, () => console.log("⚓ PADI v1.9.6 Final"));
const shutdown = async () => { await cluster.release(); server.close(() => process.exit(0)); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => { console.error("FATAL", e); process.exit(1); });
