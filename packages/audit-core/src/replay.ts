import {
  hash,
  canonicalize,
  verifySignature,
  signablePayload,
} from "@samuelmuriithi/sovereign-node";
import type { Block, ReplayResult } from "@samuelmuriithi/sovereign-node";

export interface ReplayOptions {
  publicKeys?: string[];
  strict?:     boolean;
}

export function replay(
  blocks: Block[],
  options: ReplayOptions = {}
): ReplayResult {
  const { publicKeys = [], strict = false } = options;
  const errors: string[] = [];
  const nonces = new Set<string>();
  let lastHash:   string | null = null;
  let lastHeight  = -1;
  let epochFloor  = 0;

  const fail = (msg: string): void => { errors.push(msg); };

  for (const block of blocks) {
    const ref = `[h=${block.h} hash=${block.hash?.slice(0, 12)}...]`;

    // 1. Hash integrity
    const recomputed = hash(canonicalize(block));
    if (recomputed !== block.hash) {
      const msg = `HASH_MISMATCH ${ref}`;
      if (strict) return { valid: false, height: lastHeight, hash: lastHash ?? "", epochFloor, errors: [msg] };
      fail(msg); continue;
    }

    // 2. Chain continuity
    if (lastHash !== null && !block.p.includes(lastHash)) {
      const msg = `BROKEN_CHAIN ${ref}: expected parent ${lastHash.slice(0, 12)}`;
      if (strict) return { valid: false, height: lastHeight, hash: lastHash, epochFloor, errors: [msg] };
      fail(msg); continue;
    }

    // 3. Height monotonicity
    if (block.h !== lastHeight + 1) {
      const msg = `HEIGHT_GAP ${ref}: expected h=${lastHeight + 1}`;
      if (strict) return { valid: false, height: lastHeight, hash: lastHash ?? "", epochFloor, errors: [msg] };
      fail(msg); continue;
    }

    // 4. Nonce uniqueness
    if (block.d.nonce) {
      if (nonces.has(block.d.nonce)) {
        const msg = `REPLAY_NONCE ${ref}: nonce already seen`;
        if (strict) return { valid: false, height: lastHeight, hash: lastHash ?? "", epochFloor, errors: [msg] };
        fail(msg); continue;
      }
      nonces.add(block.d.nonce);
    }

    // 5. Epoch monotonicity
    const blockEpoch = block.e ?? 0;
    if (blockEpoch < epochFloor) {
      const msg = `EPOCH_REGRESSION ${ref}: block.e=${blockEpoch} < floor=${epochFloor}`;
      if (strict) return { valid: false, height: lastHeight, hash: lastHash ?? "", epochFloor, errors: [msg] };
      fail(msg); continue;
    }
    epochFloor = Math.max(epochFloor, blockEpoch);

    // 6. Signature verification (only when keys provided)
    if (publicKeys.length > 0) {
      if (!verifySignature(signablePayload(block.d), block.s, publicKeys)) {
        const msg = `SIG_FAIL ${ref}`;
        if (strict) return { valid: false, height: lastHeight, hash: lastHash ?? "", epochFloor, errors: [msg] };
        fail(msg); continue;
      }
    }

    lastHash   = block.hash;
    lastHeight = block.h;
  }

  return {
    valid:      errors.length === 0,
    height:     lastHeight,
    hash:       lastHash ?? "",
    epochFloor,
    errors,
  };
}
