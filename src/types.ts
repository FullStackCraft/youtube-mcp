import type { Credentials } from "google-auth-library";

export type AccessMode = "readonly" | "manage";

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface ProfileMetadata {
  version: 1;
  name: string;
  channelId: string;
  channelTitle: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredToken {
  version: 1;
  mode: AccessMode;
  grantedScopes: string[];
  credentials: Credentials;
  updatedAt: string;
}

export interface AuthStatus {
  profile: string;
  mode: AccessMode;
  authenticated: boolean;
  channelId?: string;
  channelTitle?: string;
  grantedScopes: string[];
  missingScopes: string[];
  expiresAt?: string;
  needsLogin: boolean;
  message: string;
}

export interface ChannelSummary {
  id: string;
  title: string;
}

export interface ChannelDetails extends ChannelSummary {
  description: string;
  customUrl?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  uploadsPlaylistId: string;
  statistics: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
}

export interface WritableSnippet {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  defaultLanguage?: string;
}

export interface VideoDetails {
  id: string;
  channelId: string;
  channelTitle: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  duration?: string;
  liveBroadcastContent?: string;
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  snippet: WritableSnippet;
}

export interface VideoCategory {
  id: string;
  title: string;
  assignable: boolean;
}

export interface Page<T> {
  items: T[];
  nextPageToken?: string;
}

export interface AnalyticsResult {
  available: boolean;
  message?: string;
  startDate: string;
  endDate: string;
  rows: Array<Record<string, string | number | null>>;
}

export interface UpdatePatch {
  videoId: string;
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
}

export interface FieldDiff {
  field: keyof WritableSnippet;
  before: string | string[] | undefined;
  after: string | string[] | undefined;
}

export interface UpdatePreview {
  previewId: string;
  previewHash: string;
  profile: string;
  channelId: string;
  videoId: string;
  original: WritableSnippet;
  proposed: WritableSnippet;
  diff: FieldDiff[];
  createdAt: string;
  expiresAt: string;
}

export interface ApplyUpdateResult {
  videoId: string;
  channelId: string;
  before: WritableSnippet;
  after: WritableSnippet;
  reconciled: boolean;
  verified: boolean;
}
