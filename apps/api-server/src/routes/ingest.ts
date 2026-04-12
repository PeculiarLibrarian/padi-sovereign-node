import { Router } from "express";
import type { PadiEngine } from "@samuelmuriithi/sovereign-node";
import { PadiError, httpStatusForError } from "@samuelmuriithi/sovereign-node";
import { requireSignatureHeader, ingestRateLimit } from "../middleware/index.js";
import type { Env } from "../config/env.js";

/**
 * Strict Payload Filter: G-14 (Semantic Perimeter Defense)
 * Prevents complex object trees from hitting the core logic.
 */
function isFlatObject(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  return Object.values(obj).every(v => typeof v !== "object" || v === null);
}

export function ingestRouter(engine: PadiEngine, env: Env): Router {
  const router = Router();
  router.use(ingestRateLimit(env.RATE_LIMIT_RPM));

  router.post("/", requireSignatureHeader, async (req, res) => {
    // 1. Perimeter Check: Structural Flatness (G-14)
    if (!isFlatObject(req.body.payload)) {
      engine.log("WARN", "MALFORMED_INGEST", { reason: "NON_FLAT_PAYLOAD" });
      res.status(422).json({ error: "SCHEMA_INVALID", message: "Payload must be a flat object" });
      return;
    }

    // 2. Authority Gate (P3)
    if (env.READ_ONLY || !engine.isLeader) {
      res.status(403).json({ error: "NODE_NOT_INGRESS_CAPABLE" });
      return;
    }

    // 3. Epoch Integrity Gate (P1)
    if (req.body.epoch !== engine.currentEpoch) {
      res.status(403).json({
        error: "EPOCH_MISMATCH",
        expected: engine.currentEpoch,
        got: req.body.epoch,
      });
      return;
    }

    try {
      const sig = req.headers["x-padi-signature"] as string;
      const block = await engine.ingest(req.body, sig);
      
      res.json({ status: "COMMITTED", hash: block.hash, h: block.h });
    } catch (err) {
      if (err instanceof PadiError) {
        engine.log("WARN", "INGEST_REJECTED", { code: err.code });
        res.status(httpStatusForError(err.code)).json(err.toJSON());
      } else {
        engine.log("ERROR", "INGEST_INTERNAL_ERROR", { msg: (err as Error).message });
        res.status(500).json({ error: "INTERNAL_ERROR" });
      }
    }
  });

  return router;
}
