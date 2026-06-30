import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const forbiddenNames = files.filter((file) =>
  /(^|\/)(\.env($|\.)|client[_-]?secret.*\.json$|credentials.*\.json$|tokens?.*\.json$)/i.test(file),
);
if (forbiddenNames.length > 0) throw new Error(`Credential-like filenames are present: ${forbiddenNames.join(", ")}`);

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{35}/,
  /ya29\.[0-9A-Za-z_-]{20,}/,
  /1\/\/[0-9A-Za-z_-]{20,}/,
];
for (const file of files) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 2_000_000) continue;
  const content = await readFile(file, "utf8").catch(() => "");
  if (patterns.some((pattern) => pattern.test(content))) throw new Error(`Possible secret detected in ${file}`);
}
process.stdout.write(`Secret scan passed across ${files.length} source files.\n`);
