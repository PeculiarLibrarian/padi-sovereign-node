import { Router } from "express";
import type { PadiEngine } from "@samuelmuriithi/sovereign-node";
import { PadiError, httpStatusForError } from "@samuelmuriithi/sovereign-node";
import { requireSignatureHeader, ingestRateLimit } from "../middleware/index.js";
import type { Env } from "../config/env.js";

export function ingestRouter(engine: PadiEngine, env: Env): Router {
  const router = Router();
  router.use(ingestRateLimit(env.RATE_LIMIT_RPM));

  router.post("/", requireSignatureHeader, async (req, res) => {
    if (env.READ_ONLY || !env.LEADER_ELIGIBLE) {
      res.status(403).json({ error: "NODE_NOT_INGRESS_CAPABLE" }); return;
    }
    if (req.body.epoch !== engine.currentEpoch) {
      res.status(403).json({ error: "EPOCH_MISMATCH", expected: engine.currentEpoch, got: req.body.epoch }); return;
    }
    try {
      const sig = req.headers["x-padi-signature"] as string;
      const block = await engine.ingest(req.body, sig);
      res.status(201).json({ status: "COMMITTED", hash: block.hash, h: block.h });
    } catch (err) {
      if (err instanceof PadiError) {
        res.status(httpStatusForError(err.code)).json(err.toJSON());
      } else {
        res.status(500).json({ error: "INTERNAL_ERROR" });
      }
    }
  });

  return router;
}
