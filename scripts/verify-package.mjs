import { execFileSync } from "node:child_process";

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const report = JSON.parse(output)[0];
const files = report.files.map((entry) => entry.path);
const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "server.json",
  "docs/google-cloud-setup.md",
  "docs/privacy-and-data-deletion.md",
  "docs/threat-model.md",
  "docs/tools.md",
  "package.json",
];
for (const file of required) {
  if (!files.includes(file)) throw new Error(`Packed package is missing ${file}`);
}
const forbidden = files.filter((file) =>
  /(^|\/)(\.env|client[_-]?secrets?|credentials?|tokens?|oauth)(\.|\/|$)/i.test(file),
);
if (forbidden.length > 0) throw new Error(`Packed package contains forbidden files: ${forbidden.join(", ")}`);
if (report.name !== "@fullstackcraftllc/youtube-mcp" || report.version !== "0.1.0") {
  throw new Error("Unexpected packed package identity.");
}
process.stdout.write(`Verified ${files.length} packed files for ${report.name}@${report.version}.\n`);
