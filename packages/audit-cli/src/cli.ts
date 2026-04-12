import { Command } from "commander";
import chalk from "chalk";
import {
  hash,
  canonicalize,
  verifySignature,
  signablePayload,
} from "@samuelmuriithi/sovereign-node";
import type { Block } from "@samuelmuriithi/sovereign-node";
import { replay } from "@samuelmuriithi/audit-core";

const program = new Command();

program
  .name("padi-audit")
  .description("Sovereign Verification Tool — Nairobi Bureau")
  .version("1.0.0");

// ── Shared fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(
  url: string,
  apiKey: string | undefined
): Promise<T> {
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body || url}`);
    }
    return res.json() as Promise<T>;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`TIMEOUT: no response from ${url} within 8s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Command: verify ──────────────────────────────────────────────────────────
// Fetches the canonical chain from a target node and runs full replay()
// verification: hash integrity, chain continuity, height monotonicity,
// nonce uniqueness, epoch monotonicity, and optional signature verification.

program
  .command("verify")
  .description("Deep-chain audit of a target PADI node")
  .option("-t, --target <url>",   "Target node base URL",   "https://localhost:3000")
  .option("-k, --api-key <key>",  "API key for authenticated endpoints")
  .option("-p, --pub-key <path>", "Path to Ed25519 public key PEM for signature verification")
  .option("--strict",             "Abort on first violation instead of collecting all errors")
  .action(async (options) => {
    console.log(chalk.bold(`\nInitiating Bureau Audit: ${options.target}\n`));

    const apiKey: string | undefined = options.apiKey;

    try {
      // 1. Perimeter check
      const health = await apiFetch<{
        status: string;
        version: string;
        leader: boolean;
        height: number;
        epoch: number;
        tip: string | null;
      }>(`${options.target}/health`, undefined); // health is unauthenticated

      console.log(chalk.green(`  [✓] Perimeter online`));
      console.log(`      Version: ${health.version}`);
      console.log(`      Role:    ${health.leader ? chalk.yellow("LEADER") : "FOLLOWER"}`);
      console.log(`      Height:  ${health.height}`);
      console.log(`      Epoch:   ${health.epoch}`);

      if (!health.tip) {
        console.log(chalk.yellow("\n  [!] Chain is empty — nothing to verify."));
        process.exit(0);
      }

      // 2. Fetch canonical chain since genesis
      console.log(chalk.bold("\nFetching canonical chain...\n"));

      const { blocks } = await apiFetch<{ blocks: Block[] }>(
        `${options.target}/ledger/since/genesis`,
        apiKey
      );

      if (!blocks.length) {
        console.log(chalk.yellow("  [!] No blocks returned."));
        process.exit(0);
      }

      console.log(`  Blocks received: ${blocks.length}`);

      // 3. Load public key for signature verification if provided
      let publicKeys: string[] = [];
      if (options.pubKey) {
        const { readFileSync } = await import("node:fs");
        const pem = readFileSync(options.pubKey, "utf-8");
        publicKeys = [pem];
        console.log(`  Signature verification: enabled`);
      } else {
        console.log(chalk.gray(`  Signature verification: skipped (no --pub-key provided)`));
      }

      // 4. Deep chain replay — all six PDIM-1 invariants
      console.log(chalk.bold("\nRunning deep-chain verification...\n"));

      const result = replay(blocks, { publicKeys, strict: options.strict ?? false });

      if (result.valid) {
        console.log(chalk.green(`  [✓] Hash integrity:       PASS`));
        console.log(chalk.green(`  [✓] Chain continuity:     PASS`));
        console.log(chalk.green(`  [✓] Height monotonicity:  PASS`));
        console.log(chalk.green(`  [✓] Nonce uniqueness:     PASS`));
        console.log(chalk.green(`  [✓] Epoch monotonicity:   PASS`));
        console.log(
          publicKeys.length
            ? chalk.green(`  [✓] Signature validity:   PASS`)
            : chalk.gray(`  [-] Signature validity:   SKIPPED`)
        );
        console.log(`\n  Verified height: ${result.height}`);
        console.log(`  Canonical tip:   ${result.hash}`);
        console.log(`  Epoch floor:     ${result.epochFloor}`);
        console.log(chalk.bold.green(`\n  VERDICT: BUREAU IS SECURE\n`));
      } else {
        console.log(chalk.red(`\n  [!] VERIFICATION FAILED — ${result.errors.length} violation(s):\n`));
        result.errors.forEach((e) => console.log(chalk.red(`      ✗ ${e}`)));
        console.log(chalk.bold.red(`\n  VERDICT: CHAIN INTEGRITY COMPROMISED\n`));
        process.exit(1);
      }

    } catch (error) {
      console.error(chalk.red(`\n  [!] AUDIT_FAILED: ${(error as Error).message}\n`));
      process.exit(1);
    }
  });

// ── Command: block ───────────────────────────────────────────────────────────
// Fetches and spot-checks a single block by hash.

program
  .command("block <hash>")
  .description("Fetch and verify a single block by hash")
  .option("-t, --target <url>",  "Target node base URL", "https://localhost:3000")
  .option("-k, --api-key <key>", "API key")
  .action(async (blockHash, options) => {
    try {
      const block = await apiFetch<Block>(
        `${options.target}/ledger/block/${blockHash}`,
        options.apiKey
      );

      const recomputed = hash(canonicalize(block));
      const hashMatch = recomputed === block.hash;

      console.log(`\nBlock h=${block.h}`);
      console.log(`  Hash match:  ${hashMatch ? chalk.green("PASS") : chalk.red("FAIL")}`);
      console.log(`  Epoch:       ${block.e}`);
      console.log(`  Parents:     ${block.p.join(", ") || "genesis"}`);
      console.log(`  Tip hash:    ${block.hash}\n`);

      if (!hashMatch) process.exit(1);

    } catch (error) {
      console.error(chalk.red(`\n  [!] ${(error as Error).message}\n`));
      process.exit(1);
    }
  });

program.parse();
