import rateLimit from "express-rate-limit";

export function globalRateLimit(rpm: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: rpm,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "RATE_LIMIT_EXCEEDED" },
    skip: (req) => req.path === "/health",
  });
}

export function ingestRateLimit(rpm: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: Math.floor(rpm / 4),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "INGEST_RATE_LIMIT_EXCEEDED" },
  });
}
