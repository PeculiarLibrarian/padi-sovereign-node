import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

export function requireApiKey(secret: string | undefined, disabled: boolean) {
  return function auth(req: Request, res: Response, next: NextFunction): void {
    if (disabled) { next(); return; }
    if (!secret) { res.status(500).json({ error: "AUTH_MISCONFIGURED" }); return; }
    const raw = req.headers["x-api-key"] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!raw || typeof raw !== "string") { res.status(401).json({ error: "AUTH_REQUIRED" }); return; }
    let valid = false;
    try {
      valid = crypto.timingSafeEqual(Buffer.from(raw.trim()), Buffer.from(secret.trim()));
    } catch { valid = false; }
    if (!valid) { res.status(401).json({ error: "AUTH_INVALID" }); return; }
    next();
  };
}

export function requireSignatureHeader(req: Request, res: Response, next: NextFunction): void {
  const sig = req.headers["x-padi-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(401).json({ error: "AUTH_REQUIRED", hint: "x-padi-signature header missing" });
    return;
  }
  next();
}
