#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { printCliError, runCli } from "./cli.js";

export { createMcpServer, startStdioServer } from "./mcp/server.js";
export { LocalYoutubeRuntime } from "./runtime.js";
export { MetadataUpdateService, PreviewStore } from "./domain/metadata.js";
export type { YoutubeRuntime } from "./runtime.js";
export type { YouTubeGateway } from "./google/gateway.js";

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  runCli().catch((error) => {
    printCliError(error);
    process.exitCode = 1;
  });
}
