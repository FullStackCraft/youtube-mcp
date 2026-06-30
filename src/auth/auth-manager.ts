import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import open from "open";
import { OAuth2Client, CodeChallengeMethod, type Credentials } from "google-auth-library";
import { youtube } from "@googleapis/youtube";
import { AppError } from "../errors.js";
import { ProfileStore } from "../storage/profile-store.js";
import type {
  AccessMode,
  AuthStatus,
  OAuthClientConfig,
  ProfileMetadata,
  StoredToken,
} from "../types.js";
import { scopesForMode } from "./scopes.js";

const CALLBACK_PATH = "/";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface DesktopClientFile {
  installed?: {
    client_id?: string;
    client_secret?: string;
  };
}

export type BrowserAuthorizer = (
  client: OAuthClientConfig,
  scopes: string[],
  browserOpener: (url: string) => Promise<unknown>,
) => Promise<Credentials>;

export type AuthorizedChannelLister = (
  client: OAuthClientConfig,
  credentials: Credentials,
) => Promise<Array<{ id: string; title: string }>>;

export type TokenRevoker = (client: OAuthClientConfig, credential: string) => Promise<void>;

export interface LoginOptions {
  profile: string;
  mode: AccessMode;
  clientSecretsPath: string;
  channelId?: string;
  openBrowser?: (url: string) => Promise<unknown>;
}

export interface AuthContext {
  auth: OAuth2Client;
  profile: ProfileMetadata;
  mode: AccessMode;
}

export function mergeCredentials(current: Credentials, update: Credentials): Credentials {
  return {
    ...current,
    ...update,
    refresh_token: update.refresh_token ?? current.refresh_token,
  };
}

async function readDesktopClient(pathname: string): Promise<OAuthClientConfig> {
  try {
    const stat = await lstat(pathname);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new AppError("CONFIGURATION_ERROR", "The OAuth client secrets path must be a regular file.");
    }
    const parsed = JSON.parse(await readFile(pathname, "utf8")) as DesktopClientFile;
    const clientId = parsed.installed?.client_id;
    const clientSecret = parsed.installed?.client_secret;
    if (!clientId || !clientSecret) {
      throw new AppError(
        "CONFIGURATION_ERROR",
        "Expected a Google Desktop OAuth client JSON file with an installed client.",
      );
    }
    return { clientId, clientSecret };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof SyntaxError) {
      throw new AppError("CONFIGURATION_ERROR", "The OAuth client secrets file is not valid JSON.");
    }
    throw new AppError("CONFIGURATION_ERROR", "Unable to read the OAuth client secrets file.");
  }
}

function callbackHtml(success: boolean): string {
  const heading = success ? "YouTube MCP authorization complete" : "YouTube MCP authorization failed";
  const detail = success ? "You can close this window and return to your terminal." : "Return to your terminal for details.";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title></head><body><h1>${heading}</h1><p>${detail}</p></body></html>`;
}

export async function authorizeWithBrowser(
  client: OAuthClientConfig,
  scopes: string[],
  browserOpener: (url: string) => Promise<unknown>,
): Promise<Credentials> {
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const state = randomUUID();
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const returnedState = requestUrl.searchParams.get("state");
    const oauthError = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    if (returnedState !== state) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackHtml(false));
      rejectCode(new AppError("OAUTH_ERROR", "OAuth state validation failed."));
      return;
    }
    if (oauthError || !code) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end(callbackHtml(false));
      rejectCode(new AppError("OAUTH_ERROR", "Google authorization was denied or cancelled."));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(callbackHtml(true));
    resolveCode(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
    const oauth = new OAuth2Client(client.clientId, client.clientSecret, redirectUri);
    const verifier = await oauth.generateCodeVerifierAsync();
    const authorizationUrl = oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account",
      scope: scopes,
      state,
      code_challenge: verifier.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new AppError("OAUTH_ERROR", "Google authorization timed out.")),
        OAUTH_TIMEOUT_MS,
      );
      timer.unref();
    });
    void browserOpener(authorizationUrl).catch(() => {
      rejectCode(new AppError("OAUTH_ERROR", "The system browser could not be opened."));
    });
    const code = await Promise.race([codePromise, timeout]);
    const { tokens } = await oauth.getToken({ code, codeVerifier: verifier.codeVerifier, redirect_uri: redirectUri });
    if (!tokens.refresh_token) {
      throw new AppError("OAUTH_ERROR", "Google did not return a refresh token. Revoke prior access and retry.");
    }
    return tokens;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("OAUTH_ERROR", "Google authorization could not be completed.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function listAuthorizedChannels(
  client: OAuthClientConfig,
  credentials: Credentials,
): Promise<Array<{ id: string; title: string }>> {
  const oauth = new OAuth2Client(client.clientId, client.clientSecret);
  oauth.setCredentials(credentials);
  const api = youtube({ version: "v3", auth: oauth });
  const response = await api.channels.list({ part: ["snippet"], mine: true, maxResults: 50 });
  return (response.data.items ?? [])
    .filter((item) => item.id && item.snippet?.title)
    .map((item) => ({ id: item.id!, title: item.snippet!.title! }));
}

async function revokeRemoteToken(client: OAuthClientConfig, credential: string): Promise<void> {
  const oauth = new OAuth2Client(client.clientId, client.clientSecret);
  await oauth.revokeToken(credential);
}

export class AuthManager {
  constructor(
    public readonly store = new ProfileStore(),
    private readonly authorize: BrowserAuthorizer = authorizeWithBrowser,
    private readonly listChannels: AuthorizedChannelLister = listAuthorizedChannels,
    private readonly revokeRemote: TokenRevoker = revokeRemoteToken,
  ) {}

  async login(options: LoginOptions): Promise<ProfileMetadata> {
    const client = await readDesktopClient(options.clientSecretsPath);
    const existingClient = await this.store.loadClient(options.profile);
    if (existingClient && existingClient.clientId !== client.clientId) {
      const [readonlyToken, manageToken] = await Promise.all([
        this.store.loadToken(options.profile, "readonly"),
        this.store.loadToken(options.profile, "manage"),
      ]);
      if (readonlyToken || manageToken) {
        throw new AppError(
          "PROFILE_CLIENT_MISMATCH",
          "This profile already uses a different OAuth client. Use another profile name or revoke both modes first.",
        );
      }
    }

    const scopes = scopesForMode(options.mode);
    const credentials = await this.authorize(client, scopes, options.openBrowser ?? open);
    const channels = await this.listChannels(client, credentials);
    if (channels.length === 0) {
      throw new AppError("CHANNEL_MISMATCH", "The authorized account does not expose a YouTube channel.");
    }
    let selected = options.channelId ? channels.find((channel) => channel.id === options.channelId) : undefined;
    if (options.channelId && !selected) {
      throw new AppError("CHANNEL_MISMATCH", "The requested channel is not available to this authorization.");
    }
    if (!selected && channels.length > 1) {
      const choices = channels.map((channel) => `${channel.id} (${channel.title})`).join(", ");
      throw new AppError(
        "CHANNEL_MISMATCH",
        `Multiple channels are available. Repeat login with --channel-id. Choices: ${choices}`,
      );
    }
    selected ??= channels[0];
    if (!selected) throw new AppError("CHANNEL_MISMATCH", "No YouTube channel could be selected.");

    const existingProfile = await this.store.loadProfile(options.profile);
    if (existingProfile && existingProfile.channelId !== selected.id) {
      throw new AppError(
        "CHANNEL_MISMATCH",
        "This profile is already bound to another channel. Use a new profile name.",
      );
    }
    const now = new Date().toISOString();
    const profile: ProfileMetadata = {
      version: 1,
      name: options.profile,
      channelId: selected.id,
      channelTitle: selected.title,
      createdAt: existingProfile?.createdAt ?? now,
      updatedAt: now,
    };
    const grantedScopes = credentials.scope?.split(/\s+/).filter(Boolean) ?? scopes;
    const token: StoredToken = {
      version: 1,
      mode: options.mode,
      grantedScopes,
      credentials,
      updatedAt: now,
    };
    await this.store.saveClient(options.profile, client);
    await this.store.saveProfile(profile);
    await this.store.saveToken(options.profile, options.mode, token);
    return profile;
  }

  async getStatus(profileName: string, mode: AccessMode): Promise<AuthStatus> {
    const [profile, client, token] = await Promise.all([
      this.store.loadProfile(profileName),
      this.store.loadClient(profileName),
      this.store.loadToken(profileName, mode),
    ]);
    const requiredScopes = scopesForMode(mode);
    const grantedScopes = token?.grantedScopes ?? [];
    const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
    const hasRefreshPath = Boolean(token?.credentials.refresh_token || token?.credentials.access_token);
    const authenticated = Boolean(profile && client && token && hasRefreshPath && missingScopes.length === 0);
    return {
      profile: profileName,
      mode,
      authenticated,
      channelId: profile?.channelId,
      channelTitle: profile?.channelTitle,
      grantedScopes,
      missingScopes,
      expiresAt: token?.credentials.expiry_date
        ? new Date(token.credentials.expiry_date).toISOString()
        : undefined,
      needsLogin: !authenticated,
      message: authenticated
        ? `Profile ${profileName} is configured for ${mode} access.`
        : `Run youtube-mcp auth login --profile ${profileName} --mode ${mode} --client-secrets <path>.`,
    };
  }

  async getContext(profileName: string, mode: AccessMode): Promise<AuthContext> {
    const [profile, client, stored] = await Promise.all([
      this.store.loadProfile(profileName),
      this.store.loadClient(profileName),
      this.store.loadToken(profileName, mode),
    ]);
    if (!profile || !client || !stored) {
      throw new AppError(
        "AUTH_REQUIRED",
        `Run youtube-mcp auth login --profile ${profileName} --mode ${mode} --client-secrets <path>.`,
      );
    }
    const missing = scopesForMode(mode).filter((scope) => !stored.grantedScopes.includes(scope));
    if (missing.length > 0) {
      throw new AppError("INSUFFICIENT_SCOPE", `Reauthorize the ${profileName} profile in ${mode} mode.`);
    }
    const oauth = new OAuth2Client(client.clientId, client.clientSecret);
    oauth.setCredentials(stored.credentials);
    oauth.on("tokens", (update) => {
      const refreshed: StoredToken = {
        ...stored,
        credentials: mergeCredentials(oauth.credentials, update),
        updatedAt: new Date().toISOString(),
      };
      void this.store.saveToken(profileName, mode, refreshed).catch(() => {
        process.stderr.write("youtube-mcp: unable to persist refreshed OAuth credentials\n");
      });
    });
    try {
      await oauth.getAccessToken();
    } catch {
      throw new AppError("AUTH_REQUIRED", `The ${profileName} ${mode} authorization is no longer valid.`);
    }
    return { auth: oauth, profile, mode };
  }

  async revoke(profileName: string, mode: AccessMode): Promise<{ revokedRemotely: boolean }> {
    const [client, token] = await Promise.all([
      this.store.loadClient(profileName),
      this.store.loadToken(profileName, mode),
    ]);
    if (!client || !token) {
      await this.store.deleteToken(profileName, mode);
      return { revokedRemotely: false };
    }
    let revokedRemotely = false;
    const credential = token.credentials.refresh_token ?? token.credentials.access_token;
    if (credential) {
      try {
        await this.revokeRemote(client, credential);
        revokedRemotely = true;
      } catch {
        revokedRemotely = false;
      }
    }
    await this.store.deleteToken(profileName, mode);
    return { revokedRemotely };
  }
}
