import { AuthManager } from "./auth/auth-manager.js";
import { GoogleYouTubeGateway, type YouTubeGateway } from "./google/gateway.js";
import type { AccessMode, AuthStatus } from "./types.js";

export interface GatewayContext {
  gateway: YouTubeGateway;
  channelId: string;
}

export interface YoutubeRuntime {
  readonly profileName: string;
  readonly mode: AccessMode;
  getAuthStatus(): Promise<AuthStatus>;
  getGateway(): Promise<GatewayContext>;
}

export class LocalYoutubeRuntime implements YoutubeRuntime {
  constructor(
    public readonly profileName: string,
    public readonly mode: AccessMode,
    private readonly authManager = new AuthManager(),
  ) {}

  getAuthStatus(): Promise<AuthStatus> {
    return this.authManager.getStatus(this.profileName, this.mode);
  }

  async getGateway(): Promise<GatewayContext> {
    const context = await this.authManager.getContext(this.profileName, this.mode);
    return {
      gateway: new GoogleYouTubeGateway(context.auth, context.profile.channelId),
      channelId: context.profile.channelId,
    };
  }
}
