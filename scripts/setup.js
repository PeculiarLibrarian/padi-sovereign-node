import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Ensure data directories exist for the node
const DATA_DIR = path.join(ROOT, 'data/index');

async function setup() {
    console.log("🏗️ Initializing Sovereign Node Environment...");

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`✅ Created local database path: ${DATA_DIR}`);
    }

    // Verify local package structure
    const packagesDir = path.join(ROOT, 'packages');
    const packages = fs.readdirSync(packagesDir);

    console.log(`📦 Found ${packages.length} workspaces. Validating links...`);
    
    // Logic to verify package.json exists in each workspace
    packages.forEach(pkg => {
        const pjsonPath = path.join(packagesDir, pkg, 'package.json');
        if (fs.existsSync(pjsonPath)) {
            console.log(`  - ${pkg}: Valid`);
        } else {
            console.error(`  - ${pkg}: MISSING package.json!`);
        }
    });

    console.log("\n🚀 Setup complete. Run 'pnpm install' to link workspaces.");
}

setup().catch(console.error);
