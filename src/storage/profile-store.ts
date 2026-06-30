import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import envPaths from "env-paths";
import { AppError } from "../errors.js";
import type { AccessMode, OAuthClientConfig, ProfileMetadata, StoredToken } from "../types.js";

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function isPosix(): boolean {
  return process.platform !== "win32";
}

async function assertNotSymlink(filePath: string): Promise<void> {
  try {
    const stat = await lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new AppError("STORAGE_ERROR", `Refusing to use symlinked storage path: ${filePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export function validateProfileName(profile: string): string {
  if (!PROFILE_PATTERN.test(profile)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Profile names must match [a-z0-9][a-z0-9_-]{0,63}.",
    );
  }
  return profile;
}

export class ProfileStore {
  readonly configDir: string;

  constructor(configDir = process.env.YOUTUBE_MCP_CONFIG_DIR) {
    this.configDir = path.resolve(configDir ?? envPaths("youtube-mcp", { suffix: "" }).config);
  }

  private profileDir(profile: string): string {
    return path.join(this.configDir, "profiles", validateProfileName(profile));
  }

  private profileFile(profile: string): string {
    return path.join(this.profileDir(profile), "profile.json");
  }

  private clientFile(profile: string): string {
    return path.join(this.profileDir(profile), "client.json");
  }

  private tokenFile(profile: string, mode: AccessMode): string {
    return path.join(this.profileDir(profile), `${mode}-token.json`);
  }

  private async ensureDirectory(directory: string): Promise<void> {
    await assertNotSymlink(this.configDir);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await assertNotSymlink(directory);
    if (isPosix()) await chmod(directory, 0o700);
  }

  private async readJson<T>(filePath: string): Promise<T | undefined> {
    await assertNotSymlink(filePath);
    try {
      if (isPosix()) await chmod(filePath, 0o600);
      return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if (error instanceof SyntaxError) {
        throw new AppError("STORAGE_ERROR", `Invalid JSON in ${filePath}.`);
      }
      throw error;
    }
  }

  private async atomicWrite(filePath: string, value: unknown): Promise<void> {
    await this.ensureDirectory(path.dirname(filePath));
    await assertNotSymlink(filePath);
    const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      if (isPosix()) await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, filePath);
      if (isPosix()) await chmod(filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async loadProfile(profile: string): Promise<ProfileMetadata | undefined> {
    return this.readJson<ProfileMetadata>(this.profileFile(profile));
  }

  async saveProfile(profile: ProfileMetadata): Promise<void> {
    await this.atomicWrite(this.profileFile(profile.name), profile);
  }

  async loadClient(profile: string): Promise<OAuthClientConfig | undefined> {
    return this.readJson<OAuthClientConfig>(this.clientFile(profile));
  }

  async saveClient(profile: string, client: OAuthClientConfig): Promise<void> {
    await this.atomicWrite(this.clientFile(profile), client);
  }

  async loadToken(profile: string, mode: AccessMode): Promise<StoredToken | undefined> {
    return this.readJson<StoredToken>(this.tokenFile(profile, mode));
  }

  async saveToken(profile: string, mode: AccessMode, token: StoredToken): Promise<void> {
    await this.atomicWrite(this.tokenFile(profile, mode), token);
  }

  async deleteToken(profile: string, mode: AccessMode): Promise<void> {
    const filePath = this.tokenFile(profile, mode);
    await assertNotSymlink(filePath);
    await rm(filePath, { force: true });
  }

  async listProfiles(): Promise<ProfileMetadata[]> {
    const profilesDir = path.join(this.configDir, "profiles");
    await assertNotSymlink(profilesDir);
    let entries;
    try {
      entries = await readdir(profilesDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const profiles = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && PROFILE_PATTERN.test(entry.name))
        .map((entry) => this.loadProfile(entry.name)),
    );
    return profiles.filter((profile): profile is ProfileMetadata => profile !== undefined);
  }
}
