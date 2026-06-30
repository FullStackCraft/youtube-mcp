import type { AccessMode } from "../types.js";

export const READONLY_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

export const MANAGE_SCOPES = [
  ...READONLY_SCOPES,
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const;

export function scopesForMode(mode: AccessMode): string[] {
  return [...(mode === "manage" ? MANAGE_SCOPES : READONLY_SCOPES)];
}
