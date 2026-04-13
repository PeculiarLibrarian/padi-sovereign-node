import { Router } from "express";
import type { PadiEngine } from "@samuelmuriithi/sovereign-node";

export function healthRouter(engine: PadiEngine): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({
      status: "OK",
      version: "1.9.7",
      leader: engine.isLeader,
      height: engine.currentHeight,
      epoch: engine.currentEpoch,
      tip: engine.tips[0] ?? null,
    });
  });
  return router;
}
