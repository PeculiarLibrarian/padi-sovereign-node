import fs from "fs";

const target = "./dist/cli.js";
const content = fs.readFileSync(target, "utf8");

if (!content.startsWith("#!/usr/bin/env node")) {
  fs.writeFileSync(target, "#!/usr/bin/env node\n" + content);
}

fs.chmodSync(target, 0o755);
console.log("postbuild: shebang and chmod applied to dist/cli.js");
