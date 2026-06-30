import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "../errors.js";

interface GoogleErrorLike {
  response?: {
    status?: number;
    data?: {
      error?: {
        errors?: Array<{ reason?: string }>;
      };
    };
  };
  code?: number | string;
}

function statusOf(error: unknown): number | undefined {
  const candidate = error as GoogleErrorLike;
  return candidate.response?.status ?? (typeof candidate.code === "number" ? candidate.code : undefined);
}

function reasonsOf(error: unknown): string[] {
  return (
    (error as GoogleErrorLike).response?.data?.error?.errors
      ?.map((entry) => entry.reason)
      .filter((reason): reason is string => Boolean(reason)) ?? []
  );
}

export function normalizeGoogleError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status = statusOf(error);
  const reasons = reasonsOf(error);
  if (status === 401) return new AppError("AUTH_REQUIRED", "YouTube authorization is required.");
  if (status === 403 && reasons.some((reason) => /quota/i.test(reason))) {
    return new AppError("QUOTA_EXCEEDED", "The YouTube API quota is exhausted.");
  }
  if (status === 403) {
    return new AppError("INSUFFICIENT_SCOPE", "The selected profile lacks permission for this operation.");
  }
  if (status === 429) return new AppError("QUOTA_EXCEEDED", "The YouTube API rate limit was reached.", true);
  if (status !== undefined && status >= 500) {
    return new AppError("YOUTUBE_API_ERROR", "The YouTube API is temporarily unavailable.", true);
  }
  return new AppError("YOUTUBE_API_ERROR", "The YouTube API request failed.");
}

export async function withReadRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: AppError | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const normalized = normalizeGoogleError(error);
      lastError = normalized;
      if (!normalized.retriable || attempt === attempts - 1) throw normalized;
      const backoff = 200 * 2 ** attempt + Math.floor(Math.random() * 100);
      await delay(backoff);
    }
  }
  throw lastError ?? new AppError("YOUTUBE_API_ERROR", "The YouTube API request failed.");
}
