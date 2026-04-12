import { Router } from "express";
import type { PadiEngine } from "@samuelmuriithi/sovereign-node";

// G-07: Bounded response size to prevent OOM
const MAX_BLOCKS_PER_QUERY = 100;

export function ledgerRouter(engine: PadiEngine): Router {
  const router = Router();

  // P5: Traceable tip observation
  router.get("/tip", (_req, res) => {
    res.json({ 
      tip: engine.tips[0] ?? null, 
      h: engine.currentHeight,
      epoch: engine.currentEpoch 
    });
  });

  // P1: Immutable Block Retrieval (LRU-Cache Optimized)
  router.get("/block/:hash", async (req, res) => {
    const hash = req.params.hash;
    
    // G-06: Sanitization
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      res.status(400).json({ error: "INVALID_HASH_FORMAT" });
      return;
    }

    // O(1) retrieval: Engine checks LRU cache before hitting LevelDB
    const block = await engine.blockIndex.get(hash);
    if (!block) {
      res.status(404).json({ error: "BLOCK_NOT_FOUND" });
      return;
    }
    res.json(block);
  });

  // P5: Audit Lineage Reconstruction (Bounded)
  router.get("/since/:hash", async (req, res) => {
    const startHash = req.params.hash;
    
    if (startHash !== "genesis" && !/^[a-f0-9]{64}$/.test(startHash)) {
      res.status(400).json({ error: "INVALID_HASH_FORMAT" });
      return;
    }

    let startHeight = -1;
    if (startHash !== "genesis") {
      const startBlock = await engine.blockIndex.get(startHash);
      if (!startBlock) {
        res.status(404).json({ error: "START_BLOCK_NOT_FOUND" });
        return;
      }
      startHeight = startBlock.h;
    }

    // G-07: Memory exhaustion prevention
    const endHeight = Math.min(startHeight + MAX_BLOCKS_PER_QUERY, engine.currentHeight);
    const blocks = [];
    
    for (let i = startHeight + 1; i <= endHeight; i++) {
      const h = engine.heightIndex.get(i);
      if (h) {
        const block = await engine.blockIndex.get(h);
        if (block) blocks.push(block);
      }
    }
    
    res.json({ 
      blocks,
      limitReached: endHeight < engine.currentHeight,
      nextHash: endHeight < engine.currentHeight ? engine.heightIndex.get(endHeight + 1) : null 
    });
  });

  return router;
}
