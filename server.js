import express from 'express';
import rateLimit from 'express-rate-limit';
import { PadiEngine } from './engine.js';

const app = express();
app.use(rateLimit({ windowMs: 60000, max: 100 }));
app.use(express.json({ limit: '1mb' }));

const engine = new PadiEngine();
await engine.bootstrap();

app.post('/api/ingest', async (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ status: "REJECTED", code: "JSON_ONLY" });
    const sig = req.headers['x-padi-signature'];
    if (!sig || !/^[A-Za-z0-9+/=]+$/.test(sig)) return res.status(401).json({ status: "REJECTED", code: "AUTH_REQUIRED" });

    try {
        const block = await engine.ingest(req.body, sig);
        res.json({ status: "COMMITTED", hash: block.hash });
    } catch (err) {
        res.status(422).json({ status: "REJECTED", code: err.message });
    }
});

app.listen(3000, () => console.log('⚓ PADI v1.6.2 Operational'));
