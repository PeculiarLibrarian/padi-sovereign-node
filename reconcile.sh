#!/bin/bash
# reconcile.sh - Sovereign Node Recovery & Build Protocol

echo "🧹 STEP 1: Purging Corrupted State..."
# Remove root and package-level node_modules to break the cyclic link
rm -rf node_modules
find packages -name "node_modules" -type d -exec rm -rf {} +
# Clear failed build artifacts
find packages -name "dist" -type d -exec rm -rf {} +

echo "📦 STEP 2: Re-linking Workspaces..."
# Re-installing from root recreates the symlinks correctly
pnpm install

echo "🏗️ STEP 3: Building Foundation (Schemas)..."
# This MUST build first as it contains the shared 'Block' and 'hash' logic
cd packages/schemas && npx tsc && cd ../..

echo "🏗️ STEP 4: Building Infrastructure (Cluster)..."
# This builds second; it now points to schemas/dist instead of the node
cd packages/cluster && npx tsc && cd ../..

echo "🏗️ STEP 5: Building Authority (Sovereign Node)..."
# This builds last, consuming the compiled outputs of its siblings
cd packages/sovereign-node && npx tsc && cd ../..

echo "✅ RECONCILIATION COMPLETE: System is Sovereign."
