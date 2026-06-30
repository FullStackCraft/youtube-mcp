import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthManager, authorizeWithBrowser, mergeCredentials } from "../src/auth/auth-manager.js";
import { MANAGE_SCOPES, READONLY_SCOPES } from "../src/auth/scopes.js";
import { ProfileStore } from "../src/storage/profile-store.js";

const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "youtube-mcp-auth-"));
  temporaryDirectories.push(directory);
  const clientPath = path.join(directory, "desktop.json");
  await writeFile(
    clientPath,
    JSON.stringify({ installed: { client_id: "client-id", client_secret: "client-secret-placeholder" } }),
  );
  return { directory, clientPath, store: new ProfileStore(path.join(directory, "config")) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("AuthManager", () => {
  it("stores a selected channel and exact mode scopes", async () => {
    const { clientPath, store } = await fixture();
    const authorize = vi.fn(async (_client, scopes: string[]) => ({
      refresh_token: "refresh-placeholder",
      access_token: "access-placeholder",
      scope: scopes.join(" "),
    }));
    const manager = new AuthManager(store, authorize, async () => [{ id: "channel-1", title: "Test" }]);
    const profile = await manager.login({
      profile: "test",
      mode: "manage",
      clientSecretsPath: clientPath,
    });
    expect(profile.channelId).toBe("channel-1");
    expect(authorize.mock.calls[0]?.[1]).toEqual([...MANAGE_SCOPES]);
    expect((await manager.getStatus("test", "manage")).authenticated).toBe(true);
    expect((await manager.getStatus("test", "readonly")).authenticated).toBe(false);
  });

  it("requires explicit selection when multiple channels are available", async () => {
    const { clientPath, store } = await fixture();
    const manager = new AuthManager(
      store,
      async (_client, scopes) => ({ refresh_token: "refresh-placeholder", scope: scopes.join(" ") }),
      async () => [
        { id: "one", title: "One" },
        { id: "two", title: "Two" },
      ],
    );
    await expect(
      manager.login({ profile: "test", mode: "readonly", clientSecretsPath: clientPath }),
    ).rejects.toMatchObject({ code: "CHANNEL_MISMATCH" });
    const selected = await manager.login({
      profile: "test",
      mode: "readonly",
      clientSecretsPath: clientPath,
      channelId: "two",
    });
    expect(selected.channelId).toBe("two");
  });

  it("requests only readonly scopes in readonly mode", async () => {
    const { clientPath, store } = await fixture();
    const authorize = vi.fn(async (_client, scopes: string[]) => ({
      refresh_token: "refresh-placeholder",
      scope: scopes.join(" "),
    }));
    const manager = new AuthManager(store, authorize, async () => [{ id: "one", title: "One" }]);
    await manager.login({ profile: "test", mode: "readonly", clientSecretsPath: clientPath });
    expect(authorize.mock.calls[0]?.[1]).toEqual([...READONLY_SCOPES]);
  });

  it("retains a refresh token when Google only rotates the access token", () => {
    expect(
      mergeCredentials(
        { refresh_token: "refresh-placeholder", access_token: "old-access-placeholder" },
        { access_token: "new-access-placeholder", expiry_date: 123 },
      ),
    ).toEqual({
      refresh_token: "refresh-placeholder",
      access_token: "new-access-placeholder",
      expiry_date: 123,
    });
  });

  it("revokes remotely and removes only the requested mode token", async () => {
    const { clientPath, store } = await fixture();
    const revoke = vi.fn(async () => undefined);
    const manager = new AuthManager(
      store,
      async (_client, scopes) => ({ refresh_token: "refresh-placeholder", scope: scopes.join(" ") }),
      async () => [{ id: "one", title: "One" }],
      revoke,
    );
    await manager.login({ profile: "test", mode: "readonly", clientSecretsPath: clientPath });
    await manager.login({ profile: "test", mode: "manage", clientSecretsPath: clientPath });
    expect(await manager.revoke("test", "readonly")).toEqual({ revokedRemotely: true });
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-id" }), "refresh-placeholder");
    expect(await store.loadToken("test", "readonly")).toBeUndefined();
    expect(await store.loadToken("test", "manage")).toBeDefined();
  });

  it("rejects changing OAuth clients while a token exists", async () => {
    const { directory, clientPath, store } = await fixture();
    const manager = new AuthManager(
      store,
      async (_client, scopes) => ({ refresh_token: "refresh-placeholder", scope: scopes.join(" ") }),
      async () => [{ id: "one", title: "One" }],
    );
    await manager.login({ profile: "test", mode: "readonly", clientSecretsPath: clientPath });
    const otherClient = path.join(directory, "other.json");
    await writeFile(
      otherClient,
      JSON.stringify({ installed: { client_id: "other-client", client_secret: "other-secret-placeholder" } }),
    );
    await expect(
      manager.login({ profile: "test", mode: "manage", clientSecretsPath: otherClient }),
    ).rejects.toMatchObject({ code: "PROFILE_CLIENT_MISMATCH" });
  });
});

describe("browser OAuth guardrails", () => {
  it("includes PKCE S256 and rejects a mismatched state", async () => {
    await expect(
      authorizeWithBrowser(
        { clientId: "client-id", clientSecret: "client-secret-placeholder" },
        [...READONLY_SCOPES],
        async (authorizationUrl) => {
          const url = new URL(authorizationUrl);
          expect(url.searchParams.get("code_challenge_method")).toBe("S256");
          expect(url.searchParams.get("code_challenge")).toBeTruthy();
          const redirect = url.searchParams.get("redirect_uri")!;
          await fetch(`${redirect}?state=wrong&code=not-used`);
        },
      ),
    ).rejects.toMatchObject({ code: "OAUTH_ERROR" });
  });

  it("reports authorization denial without exposing the returned value", async () => {
    await expect(
      authorizeWithBrowser(
        { clientId: "client-id", clientSecret: "client-secret-placeholder" },
        [...READONLY_SCOPES],
        async (authorizationUrl) => {
          const url = new URL(authorizationUrl);
          const redirect = url.searchParams.get("redirect_uri")!;
          const state = url.searchParams.get("state")!;
          await fetch(`${redirect}?state=${encodeURIComponent(state)}&error=access_denied`);
        },
      ),
    ).rejects.toMatchObject({ code: "OAUTH_ERROR", message: "Google authorization was denied or cancelled." });
  });
});
