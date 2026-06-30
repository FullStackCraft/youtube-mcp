import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const temporary = await mkdtemp(path.join(os.tmpdir(), "youtube-mcp-packed-"));
try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], { encoding: "utf8" }),
  )[0];
  const tarball = path.join(temporary, packed.filename);
  const installDirectory = path.join(temporary, "install");
  execFileSync("npm", ["install", "--prefix", installDirectory, "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
    stdio: "pipe",
  });
  const packageJson = JSON.parse(
    await readFile(path.join(installDirectory, "node_modules", "@fullstackcraftllc", "youtube-mcp", "package.json"), "utf8"),
  );
  if (packageJson.version !== "0.1.0") throw new Error("Packed install has the wrong version.");
  const binary = path.join(
    installDirectory,
    "node_modules",
    "@fullstackcraftllc",
    "youtube-mcp",
    "dist",
    "index.js",
  );
  const executable = path.join(
    installDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "youtube-mcp.cmd" : "youtube-mcp",
  );
  const version = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
  if (version !== "0.1.0") throw new Error(`Packed binary reported ${version}.`);

  const configDirectory = path.join(temporary, "config");
  const client = new Client({ name: "packed-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binary, "serve", "--profile", "default", "--mode", "readonly"],
    env: { ...process.env, YOUTUBE_MCP_CONFIG_DIR: configDirectory },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    if (tools.tools.length !== 10) throw new Error(`Packed server exposed ${tools.tools.length} tools, expected 10.`);
    const auth = await client.callTool({ name: "youtube_get_auth_status", arguments: {} });
    if (auth.isError || auth.structuredContent?.ok !== true) throw new Error("Packed auth status tool failed.");
  } finally {
    await client.close();
  }
  process.stdout.write("Packed package install and stdio smoke test passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
