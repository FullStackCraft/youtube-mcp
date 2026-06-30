export type ErrorCode =
  | "AUTH_REQUIRED"
  | "INSUFFICIENT_SCOPE"
  | "CHANNEL_MISMATCH"
  | "VIDEO_NOT_OWNED"
  | "VALIDATION_ERROR"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_CLIENT_MISMATCH"
  | "PREVIEW_NOT_FOUND"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_HASH_MISMATCH"
  | "REMOTE_STATE_CHANGED"
  | "QUOTA_EXCEEDED"
  | "ANALYTICS_UNAVAILABLE"
  | "YOUTUBE_API_ERROR"
  | "OAUTH_ERROR"
  | "STORAGE_ERROR"
  | "CONFIGURATION_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retriable = false,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("YOUTUBE_API_ERROR", "The YouTube API request failed.");
}
