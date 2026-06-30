import packageJson from "../package.json" with { type: "json" };
import { AppError, asAppError } from "./errors.js";
import { AuthManager } from "./auth/auth-manager.js";
import { validateProfileName } from "./storage/profile-store.js";
import { LocalYoutubeRuntime } from "./runtime.js";
import { startStdioServer } from "./mcp/server.js";
import type { AccessMode } from "./types.js";

interface ParsedFlags {
  [key: string]: string | undefined;
}

function assertAllowedFlags(flags: ParsedFlags, allowed: string[]): void {
  const unknown = Object.keys(flags).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new AppError("VALIDATION_ERROR", `Unknown option: --${unknown[0]}.`);
  }
}

function parseFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith("--")) {
      throw new AppError("VALIDATION_ERROR", `Unexpected argument: ${argument ?? ""}`);
    }
    const key = argument.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new AppError("VALIDATION_ERROR", `Missing value for --${key}.`);
    }
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function accessMode(value: string | undefined): AccessMode {
  const mode = value ?? "readonly";
  if (mode !== "readonly" && mode !== "manage") {
    throw new AppError("VALIDATION_ERROR", "--mode must be readonly or manage.");
  }
  return mode;
}

function profileName(value: string | undefined): string {
  return validateProfileName(value ?? "default");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): string {
  return `youtube-mcp ${packageJson.version}

Usage:
  youtube-mcp [serve] [--profile <name>] [--mode readonly|manage]
  youtube-mcp auth login --profile <name> --mode readonly|manage --client-secrets <file> [--channel-id <id>]
  youtube-mcp auth status --profile <name> [--mode readonly|manage]
  youtube-mcp auth revoke --profile <name> [--mode readonly|manage]
  youtube-mcp profiles list
  youtube-mcp doctor --profile <name> --mode readonly|manage
  youtube-mcp --help
  youtube-mcp --version
`;
}

function recentDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export async function runCli(args = process.argv.slice(2), authManager = new AuthManager()): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(help());
    return;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  const command = args[0] && !args[0].startsWith("--") ? args[0] : "serve";
  if (command === "serve") {
    const flagArgs = args[0] === "serve" ? args.slice(1) : args;
    const flags = parseFlags(flagArgs);
    assertAllowedFlags(flags, ["profile", "mode"]);
    const runtime = new LocalYoutubeRuntime(profileName(flags.profile), accessMode(flags.mode), authManager);
    await startStdioServer(runtime);
    return;
  }

  if (command === "auth") {
    const subcommand = args[1];
    const flags = parseFlags(args.slice(2));
    assertAllowedFlags(
      flags,
      subcommand === "login" ? ["profile", "mode", "client-secrets", "channel-id"] : ["profile", "mode"],
    );
    const profile = profileName(flags.profile);
    const mode = accessMode(flags.mode);
    if (subcommand === "login") {
      if (!flags["client-secrets"]) {
        throw new AppError("VALIDATION_ERROR", "auth login requires --client-secrets <file>.");
      }
      const result = await authManager.login({
        profile,
        mode,
        clientSecretsPath: flags["client-secrets"],
        channelId: flags["channel-id"],
      });
      printJson({ ok: true, profile: result.name, mode, channelId: result.channelId, channelTitle: result.channelTitle });
      return;
    }
    if (subcommand === "status") {
      printJson(await authManager.getStatus(profile, mode));
      return;
    }
    if (subcommand === "revoke") {
      printJson({ ok: true, profile, mode, ...(await authManager.revoke(profile, mode)) });
      return;
    }
    throw new AppError("VALIDATION_ERROR", "Unknown auth command. Use login, status, or revoke.");
  }

  if (command === "profiles") {
    if (args[1] !== "list" || args.length !== 2) {
      throw new AppError("VALIDATION_ERROR", "Use youtube-mcp profiles list.");
    }
    printJson({ profiles: await authManager.store.listProfiles() });
    return;
  }

  if (command === "doctor") {
    const flags = parseFlags(args.slice(1));
    assertAllowedFlags(flags, ["profile", "mode"]);
    const profile = profileName(flags.profile);
    const mode = accessMode(flags.mode);
    const runtime = new LocalYoutubeRuntime(profile, mode, authManager);
    const { gateway } = await runtime.getGateway();
    const channel = await gateway.getMyChannel();
    const range = recentDateRange();
    const analytics = await gateway.getChannelAnalytics(range);
    printJson({ ok: true, profile, mode, channel: { id: channel.id, title: channel.title }, analyticsApi: { ok: true, ...range, returnedRows: analytics.rows.length } });
    return;
  }

  throw new AppError("VALIDATION_ERROR", `Unknown command: ${command}.`);
}

export function printCliError(error: unknown): void {
  const appError = asAppError(error);
  process.stderr.write(`youtube-mcp: ${appError.code}: ${appError.message}\n`);
}
