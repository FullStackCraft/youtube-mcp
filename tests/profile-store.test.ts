import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileStore, validateProfileName } from "../src/storage/profile-store.js";
import type { StoredToken } from "../src/types.js";

const temporaryDirectories: string[] = [];

async function store(): Promise<ProfileStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "youtube-mcp-store-"));
  temporaryDirectories.push(directory);
  return new ProfileStore(directory);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("profile storage", () => {
  it("validates profile names", () => {
    expect(validateProfileName("vannacharm_1")).toBe("vannacharm_1");
    expect(() => validateProfileName("../escape")).toThrow(/Profile names/);
    expect(() => validateProfileName("Uppercase")).toThrow(/Profile names/);
  });

  it("stores client, metadata, and mode tokens separately with protected permissions", async () => {
    const profileStore = await store();
    const now = new Date().toISOString();
    await profileStore.saveClient("vannacharm", { clientId: "client-id", clientSecret: "client-secret-placeholder" });
    await profileStore.saveProfile({
      version: 1,
      name: "vannacharm",
      channelId: "channel-1",
      channelTitle: "VannaCharm",
      createdAt: now,
      updatedAt: now,
    });
    const token = (mode: "readonly" | "manage"): StoredToken => ({
      version: 1,
      mode,
      grantedScopes: [`scope:${mode}`],
      credentials: { refresh_token: `${mode}-refresh-placeholder` },
      updatedAt: now,
    });
    await profileStore.saveToken("vannacharm", "readonly", token("readonly"));
    await profileStore.saveToken("vannacharm", "manage", token("manage"));
    expect((await profileStore.loadToken("vannacharm", "readonly"))?.mode).toBe("readonly");
    expect((await profileStore.loadToken("vannacharm", "manage"))?.mode).toBe("manage");
    expect(await profileStore.listProfiles()).toHaveLength(1);
    if (process.platform !== "win32") {
      const profileDir = path.join(profileStore.configDir, "profiles", "vannacharm");
      expect((await lstat(profileDir)).mode & 0o777).toBe(0o700);
      expect((await lstat(path.join(profileDir, "client.json"))).mode & 0o777).toBe(0o600);
      expect((await lstat(path.join(profileDir, "readonly-token.json"))).mode & 0o777).toBe(0o600);
    }
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked credential destination", async () => {
    const profileStore = await store();
    const profileDir = path.join(profileStore.configDir, "profiles", "test");
    await mkdir(profileDir, { recursive: true });
    const outside = path.join(profileStore.configDir, "outside.json");
    await writeFile(outside, "untouched");
    await symlink(outside, path.join(profileDir, "client.json"));
    await expect(
      profileStore.saveClient("test", { clientId: "client-id", clientSecret: "client-secret-placeholder" }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
    expect(await readFile(outside, "utf8")).toBe("untouched");
  });
});
