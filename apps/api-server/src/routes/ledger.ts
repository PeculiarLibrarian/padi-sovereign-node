import { Router } from "express";
import type { PadiEngine } from "@samuelmuriithi/sovereign-node";

export function ledgerRouter(engine: PadiEngine): Router {
  const router = Router();

  router.get("/tip", (_req, res) => {
    res.json({ tip: engine.tips[0] ?? null, h: engine.currentHeight });
  });

  router.get("/block/:hash", async (req, res) => {
    const block = await engine.blockIndex.get(req.params.hash);
    if (!block) { res.status(404).json({ error: "BLOCK_NOT_FOUND" }); return; }
    res.json(block);
  });

  router.get("/since/:hash", async (req, res) => {
    const startHash = req.params.hash;
    let startHeight = -1;
    if (startHash !== "genesis") {
      const startBlock = await engine.blockIndex.get(startHash);
      if (!startBlock) { res.json({ blocks: [] }); return; }
      startHeight = startBlock.h;
    }
    const LIMIT = 50;
    const blocks = [];
    const endHeight = Math.min(startHeight + LIMIT, engine.currentHeight);
    for (let i = startHeight + 1; i <= endHeight; i++) {
      const h = engine.heightIndex.get(i);
      if (h) { const b = await engine.blockIndex.get(h); if (b) blocks.push(b); }
    }
    res.json({ blocks, count: blocks.length, next: endHeight < engine.currentHeight ? endHeight : null });
  });

  return router;
}
