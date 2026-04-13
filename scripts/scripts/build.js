import { execSync } from "child_process";

const steps = [
  "@samuelmuriithi/schemas",
  "@samuelmuriithi/sovereign-node",
  "@samuelmuriithi/cluster",
  "@samuelmuriithi/audit-core",
  "@samuelmuriithi/audit-cli",
  "@samuelmuriithi/padi-sdk",
  "api-server",
];

for (const pkg of steps) {
  console.log(`\nBuilding ${pkg}...`);
  execSync(`pnpm --filter ${pkg} build`, { stdio: "inherit" });
}

console.log("\nAll packages built successfully.");
