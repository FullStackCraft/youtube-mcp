import { createHash, randomUUID } from "node:crypto";
import { AppError, asAppError } from "../errors.js";
import type { YouTubeGateway } from "../google/gateway.js";
import type {
  ApplyUpdateResult,
  FieldDiff,
  UpdatePatch,
  UpdatePreview,
  WritableSnippet,
} from "../types.js";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 100;

function characterCount(value: string): number {
  return Array.from(value).length;
}

function encodedTagsLength(tags: string[]): number {
  return tags.reduce((total, tag, index) => {
    const tagLength = characterCount(tag) + (tag.includes(" ") ? 2 : 0);
    return total + tagLength + (index > 0 ? 1 : 0);
  }, 0);
}

export function normalizeTags(tags: string[]): string[] {
  const normalized = tags.map((tag) => tag.trim());
  if (normalized.some((tag) => tag.length === 0)) {
    throw new AppError("VALIDATION_ERROR", "Tags must not be blank.");
  }
  const seen = new Set<string>();
  for (const tag of normalized) {
    const key = tag.toLocaleLowerCase("en-US");
    if (seen.has(key)) throw new AppError("VALIDATION_ERROR", `Duplicate tag: ${tag}`);
    seen.add(key);
  }
  if (encodedTagsLength(normalized) > 500) {
    throw new AppError("VALIDATION_ERROR", "The encoded YouTube tag list exceeds 500 characters.");
  }
  return normalized;
}

export function validateWritableSnippet(snippet: WritableSnippet): void {
  if (characterCount(snippet.title) < 1 || characterCount(snippet.title) > 100) {
    throw new AppError("VALIDATION_ERROR", "The title must contain 1 to 100 characters.");
  }
  if (/[<>]/.test(snippet.title)) {
    throw new AppError("VALIDATION_ERROR", "The title must not contain < or >.");
  }
  if (Buffer.byteLength(snippet.description, "utf8") > 5_000) {
    throw new AppError("VALIDATION_ERROR", "The description must not exceed 5,000 UTF-8 bytes.");
  }
  if (/[<>]/.test(snippet.description)) {
    throw new AppError("VALIDATION_ERROR", "The description must not contain < or >.");
  }
  if (!snippet.categoryId) throw new AppError("VALIDATION_ERROR", "A category ID is required.");
  normalizeTags(snippet.tags);
}

function orderedSnippet(snippet: WritableSnippet): WritableSnippet {
  return {
    title: snippet.title,
    description: snippet.description,
    tags: [...snippet.tags],
    categoryId: snippet.categoryId,
    ...(snippet.defaultLanguage ? { defaultLanguage: snippet.defaultLanguage } : {}),
  };
}

function snippetsEqual(left: WritableSnippet, right: WritableSnippet): boolean {
  return JSON.stringify(orderedSnippet(left)) === JSON.stringify(orderedSnippet(right));
}

function snippetHash(snippet: WritableSnippet): string {
  return createHash("sha256").update(JSON.stringify(orderedSnippet(snippet))).digest("hex");
}

function previewHash(preview: Omit<UpdatePreview, "previewHash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        profile: preview.profile,
        channelId: preview.channelId,
        videoId: preview.videoId,
        original: orderedSnippet(preview.original),
        proposed: orderedSnippet(preview.proposed),
      }),
    )
    .digest("hex");
}

function buildDiff(original: WritableSnippet, proposed: WritableSnippet): FieldDiff[] {
  const fields: Array<keyof WritableSnippet> = [
    "title",
    "description",
    "tags",
    "categoryId",
    "defaultLanguage",
  ];
  return fields
    .filter((field) => JSON.stringify(original[field]) !== JSON.stringify(proposed[field]))
    .map((field) => ({ field, before: original[field], after: proposed[field] }));
}

export class PreviewStore {
  private readonly previews = new Map<string, UpdatePreview>();

  constructor(private readonly now: () => number = Date.now) {}

  put(preview: UpdatePreview): void {
    this.removeExpired();
    if (this.previews.size >= MAX_PREVIEWS) {
      const oldest = this.previews.keys().next().value as string | undefined;
      if (oldest) this.previews.delete(oldest);
    }
    this.previews.set(preview.previewId, preview);
  }

  get(previewId: string): UpdatePreview {
    const preview = this.previews.get(previewId);
    if (!preview) throw new AppError("PREVIEW_NOT_FOUND", "The update preview was not found or was consumed.");
    if (new Date(preview.expiresAt).getTime() <= this.now()) {
      this.previews.delete(previewId);
      throw new AppError("PREVIEW_EXPIRED", "The update preview has expired. Create a new preview.");
    }
    return preview;
  }

  consume(previewId: string): void {
    this.previews.delete(previewId);
  }

  private removeExpired(): void {
    for (const [id, preview] of this.previews) {
      if (new Date(preview.expiresAt).getTime() <= this.now()) this.previews.delete(id);
    }
  }
}

export class MetadataUpdateService {
  constructor(
    private readonly gateway: YouTubeGateway,
    private readonly previews: PreviewStore,
    private readonly profile: string,
    private readonly channelId: string,
    private readonly now: () => number = Date.now,
  ) {}

  async preview(patch: UpdatePatch): Promise<UpdatePreview> {
    if (
      patch.title === undefined &&
      patch.description === undefined &&
      patch.tags === undefined &&
      patch.categoryId === undefined
    ) {
      throw new AppError("VALIDATION_ERROR", "At least one metadata field must be supplied.");
    }
    const video = await this.gateway.getOwnedVideo(patch.videoId);
    if (video.channelId !== this.channelId) {
      throw new AppError("VIDEO_NOT_OWNED", "The requested video is not owned by the selected channel.");
    }
    const original = orderedSnippet(video.snippet);
    const proposed = orderedSnippet({
      ...original,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
    });
    validateWritableSnippet(proposed);
    if (patch.categoryId !== undefined && patch.categoryId !== original.categoryId) {
      const categories = await this.gateway.listVideoCategories("US");
      if (!categories.some((category) => category.id === patch.categoryId && category.assignable)) {
        throw new AppError("VALIDATION_ERROR", "The requested category is not assignable in region US.");
      }
    }
    const diff = buildDiff(original, proposed);
    if (diff.length === 0) throw new AppError("VALIDATION_ERROR", "The proposal does not change any metadata.");
    const createdAtMs = this.now();
    const base: Omit<UpdatePreview, "previewHash"> = {
      previewId: randomUUID(),
      profile: this.profile,
      channelId: this.channelId,
      videoId: patch.videoId,
      original,
      proposed,
      diff,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + PREVIEW_TTL_MS).toISOString(),
    };
    const preview: UpdatePreview = { ...base, previewHash: previewHash(base) };
    this.previews.put(preview);
    return preview;
  }

  async apply(previewId: string, suppliedHash: string, confirmVideoId: string): Promise<ApplyUpdateResult> {
    const preview = this.previews.get(previewId);
    if (preview.previewHash !== suppliedHash) {
      throw new AppError("PREVIEW_HASH_MISMATCH", "The supplied preview hash does not match.");
    }
    if (preview.videoId !== confirmVideoId) {
      throw new AppError("VALIDATION_ERROR", "confirmVideoId must exactly match the previewed video ID.");
    }
    if (preview.profile !== this.profile || preview.channelId !== this.channelId) {
      throw new AppError("CHANNEL_MISMATCH", "The preview belongs to another profile or channel.");
    }
    const current = await this.gateway.getOwnedVideo(preview.videoId);
    if (snippetHash(current.snippet) !== snippetHash(preview.original)) {
      this.previews.consume(previewId);
      throw new AppError("REMOTE_STATE_CHANGED", "The video's metadata changed after preview. Create a new preview.");
    }

    this.previews.consume(previewId);
    try {
      await this.gateway.updateVideoSnippet(preview.videoId, preview.proposed);
    } catch (error) {
      const writeError = asAppError(error);
      try {
        const reconciled = await this.gateway.getOwnedVideo(preview.videoId);
        if (snippetsEqual(reconciled.snippet, preview.proposed)) {
          return {
            videoId: preview.videoId,
            channelId: preview.channelId,
            before: preview.original,
            after: reconciled.snippet,
            reconciled: true,
            verified: true,
          };
        }
        if (snippetsEqual(reconciled.snippet, preview.original)) throw writeError;
        throw new AppError(
          "REMOTE_STATE_CHANGED",
          "The write result is ambiguous and the remote metadata matches neither state.",
        );
      } catch (reconciliationError) {
        if (reconciliationError instanceof AppError) throw reconciliationError;
        throw writeError;
      }
    }

    const verified = await this.gateway.getOwnedVideo(preview.videoId);
    if (!snippetsEqual(verified.snippet, preview.proposed)) {
      throw new AppError("REMOTE_STATE_CHANGED", "YouTube did not retain the exact proposed metadata.");
    }
    return {
      videoId: preview.videoId,
      channelId: preview.channelId,
      before: preview.original,
      after: verified.snippet,
      reconciled: false,
      verified: true,
    };
  }
}
