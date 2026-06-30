import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import {
  MetadataUpdateService,
  PreviewStore,
  normalizeTags,
  validateWritableSnippet,
} from "../src/domain/metadata.js";
import { FakeGateway, baseSnippet } from "./helpers/fake-gateway.js";

function service(gateway = new FakeGateway(), now: () => number = Date.now) {
  return { gateway, updates: new MetadataUpdateService(gateway, new PreviewStore(now), "test", "channel-1", now) };
}

describe("metadata validation", () => {
  it("enforces title, description, and tag limits", () => {
    expect(() => validateWritableSnippet({ ...baseSnippet, title: "" })).toThrowError(AppError);
    expect(() => validateWritableSnippet({ ...baseSnippet, title: "x".repeat(101) })).toThrow(/100/);
    expect(() => validateWritableSnippet({ ...baseSnippet, description: "é".repeat(2_501) })).toThrow(/5,000/);
    expect(() => validateWritableSnippet({ ...baseSnippet, title: "bad < title" })).toThrow(/must not contain/);
    expect(() => normalizeTags(["Alpha", "alpha"])).toThrow(/Duplicate/);
    expect(() => normalizeTags([" "])).toThrow(/blank/);
    expect(() => normalizeTags(["a".repeat(501)])).toThrow(/500/);
  });

  it("trims tags without silently removing entries", () => {
    expect(normalizeTags([" alpha ", "beta tag"])).toEqual(["alpha", "beta tag"]);
  });
});

describe("metadata preview and apply", () => {
  it("preserves omitted fields and supports explicit tag clearing", async () => {
    const { updates } = service();
    const preview = await updates.preview({ videoId: "video-1", title: "New title", tags: [] });
    expect(preview.proposed).toEqual({ ...baseSnippet, title: "New title", tags: [] });
    expect(preview.diff.map((entry) => entry.field)).toEqual(["title", "tags"]);
  });

  it("rejects no-op proposals and invalid categories", async () => {
    const { updates } = service();
    await expect(updates.preview({ videoId: "video-1", title: baseSnippet.title })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(updates.preview({ videoId: "video-1", categoryId: "999" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("applies exactly one verified preview", async () => {
    const { gateway, updates } = service();
    const preview = await updates.preview({ videoId: "video-1", description: "Updated" });
    const result = await updates.apply(preview.previewId, preview.previewHash, "video-1");
    expect(result).toMatchObject({ reconciled: false, verified: true });
    expect(gateway.updateCalls).toHaveLength(1);
    expect(gateway.video.snippet.defaultLanguage).toBe("en");
    await expect(updates.apply(preview.previewId, preview.previewHash, "video-1")).rejects.toMatchObject({
      code: "PREVIEW_NOT_FOUND",
    });
  });

  it("rejects mismatched hashes and confirmation IDs without writing", async () => {
    const { gateway, updates } = service();
    const preview = await updates.preview({ videoId: "video-1", title: "New title" });
    await expect(updates.apply(preview.previewId, "0".repeat(64), "video-1")).rejects.toMatchObject({
      code: "PREVIEW_HASH_MISMATCH",
    });
    await expect(updates.apply(preview.previewId, preview.previewHash, "other")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(gateway.updateCalls).toHaveLength(0);
  });

  it("rejects expired and remotely stale previews", async () => {
    let now = Date.parse("2026-06-30T00:00:00Z");
    const { gateway, updates } = service(new FakeGateway(), () => now);
    const expired = await updates.preview({ videoId: "video-1", title: "New title" });
    now += 10 * 60 * 1000;
    await expect(updates.apply(expired.previewId, expired.previewHash, "video-1")).rejects.toMatchObject({
      code: "PREVIEW_EXPIRED",
    });

    now = Date.parse("2026-06-30T01:00:00Z");
    const stale = await updates.preview({ videoId: "video-1", title: "Another title" });
    gateway.video.snippet.description = "Changed elsewhere";
    await expect(updates.apply(stale.previewId, stale.previewHash, "video-1")).rejects.toMatchObject({
      code: "REMOTE_STATE_CHANGED",
    });
    expect(gateway.updateCalls).toHaveLength(0);
  });

  it("reconciles an ambiguous write that reached YouTube", async () => {
    const gateway = new FakeGateway();
    gateway.applyBeforeError = true;
    gateway.updateError = new AppError("YOUTUBE_API_ERROR", "Connection lost.", true);
    const { updates } = service(gateway);
    const preview = await updates.preview({ videoId: "video-1", title: "Reached remote" });
    const result = await updates.apply(preview.previewId, preview.previewHash, "video-1");
    expect(result).toMatchObject({ reconciled: true, verified: true });
  });

  it("reports a failed write that left the original intact", async () => {
    const gateway = new FakeGateway();
    gateway.updateError = new AppError("YOUTUBE_API_ERROR", "Connection lost.", true);
    const { updates } = service(gateway);
    const preview = await updates.preview({ videoId: "video-1", title: "Not applied" });
    await expect(updates.apply(preview.previewId, preview.previewHash, "video-1")).rejects.toMatchObject({
      code: "YOUTUBE_API_ERROR",
    });
  });
});
