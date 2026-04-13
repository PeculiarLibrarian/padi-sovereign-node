import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      lvl: res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO",
      evt: "HTTP_REQUEST",
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      latencyMs: Date.now() - start,
    }));
  });
  next();
}
