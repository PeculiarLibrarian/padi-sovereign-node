import express from 'express';
import { PadiEngine } from '../core/engine.js';
import { ClusterManager } from '../cluster/cluster.js';
import { Replicator } from '../cluster/replicator.js';

const REQUIRED_ENV = ['REDIS_URL', 'NODE_ID'];
REQUIRED_ENV.forEach(v => { if (!process.env[v]) throw new Error(`CONFIG_ERR: ${v}`); });

const app = express(); app.use(express.json({ limit: '1mb' }));
const engine = new PadiEngine(); await engine.bootstrap();
const cluster = new ClusterManager(engine); engine.cluster = cluster; 
const replicator = new Replicator(engine);
await cluster.start(); replicator.start();

app.get('/health', (req, res) => res.json({ status: "OK", leader: engine.isLeader, h: engine.currentHeight, tip: engine.tips[0] }));
app.get('/ledger/tip', (req, res) => res.json({ tip: engine.tips[0], h: engine.currentHeight }));
app.get('/ledger/block/:hash', (req, res) => {
    const b = engine.blockIndex.get(req.params.hash);
    b ? res.json(b) : res.status(404).end();
});
app.get('/ledger/since/:hash', (req, res) => {
    const start = engine.blockIndex.get(req.params.hash)?.h || (req.params.hash === 'genesis' ? -1 : null);
    if (start === null) return res.json({ blocks: [] });
    const blocks = [];
    for (let i = start + 1; i <= engine.currentHeight; i++) {
        const h = engine.heightIndex.get(i); if (h) blocks.push(engine.blockIndex.get(h));
    }
    res.json({ blocks });
});

app.post('/api/ingest', async (req, res) => {
    const sig = req.headers['x-padi-signature'];
    if (!sig) return res.status(401).json({ error: "AUTH_REQUIRED" });
    
    // Topology Hard-Lock
    if (process.env.LEADER_ELIGIBLE !== "true" || process.env.READ_ONLY === "true") {
        return res.status(403).json({ error: "NODE_NOT_INGRESS_CAPABLE" });
    }

    if (req.body.epoch !== engine.currentEpoch) return res.status(403).json({ error: "EPOCH_MISMATCH" });
    try {
        const block = await engine.ingest(req.body, sig);
        res.json({ status: "COMMITTED", hash: block.hash });
    } catch (err) {
        const code = (err.message === "INGEST_LOCK" || err.message === "FENCED" || err.message === "NODE_NOT_LEADER") ? 403 : 422;
        res.status(code).json({ error: err.message });
    }
});

const server = app.listen(process.env.PORT || 3000, () => engine.log("INFO", "ONLINE"));
const shutdown = async () => { await cluster.release(); server.close(() => process.exit(0)); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => { engine.log("FATAL", e.message); process.exit(1); });
