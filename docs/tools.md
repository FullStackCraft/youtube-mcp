# Tool Reference

All tools return a structured envelope:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "profile": "my-channel",
    "mode": "readonly",
    "channelId": "..."
  }
}
```

Errors use `isError: true` and include a stable code, safe message, and retriable flag. Raw Google responses and credentials are never returned.

## Read tools

- `youtube_get_auth_status()` — Local profile, mode, channel, scopes, and remediation.
- `youtube_get_my_channel()` — Bound channel metadata, statistics, and uploads playlist.
- `youtube_list_my_videos({ pageSize?, pageToken? })` — Owned uploads, 1–50 per page.
- `youtube_get_video({ videoId })` — Complete writable metadata, duration, live state, and statistics for an owned video.
- `youtube_list_video_categories({ regionCode? })` — Categories for a two-letter region, default `US`.
- `youtube_get_channel_analytics({ startDate, endDate })` — Non-monetary channel metrics.
- `youtube_get_video_analytics({ videoId, startDate, endDate })` — Non-monetary owned-video metrics.
- `youtube_get_video_traffic_sources({ videoId, startDate, endDate })` — Traffic source types sorted by views.
- `youtube_get_video_search_terms({ videoId, startDate, endDate, limit? })` — YouTube Search terms, default 25 and maximum 50.
- `youtube_get_video_retention({ videoId, startDate, endDate })` — Audience watch ratio and relative retention by elapsed-video ratio.

Dates use `YYYY-MM-DD`. Empty or privacy-suppressed Analytics responses are successful results with `available: false` and an explanation.

## Manage tools

Manage tools are registered only when the server starts with `--mode manage`.

### `youtube_preview_video_update`

```json
{
  "videoId": "required",
  "title": "optional replacement",
  "description": "optional replacement",
  "tags": ["optional", "complete replacement"],
  "categoryId": "optional replacement"
}
```

At least one supplied field must actually change. An empty tags array explicitly clears tags; omitted tags are preserved. The response includes original and proposed snippets, field-level diff, preview ID, SHA-256 hash, channel/video identity, and ten-minute expiry.

### `youtube_apply_video_update`

```json
{
  "previewId": "UUID returned by preview",
  "previewHash": "64-character hash returned by preview",
  "confirmVideoId": "exact video ID"
}
```

Apply rechecks profile, channel, ownership, expiry, hash, and the current remote snippet. It updates only title, description, tags, category ID, and an existing default language. Visibility, thumbnails, localization objects, made-for-kids settings, and all other fields are untouched.

## Stable error codes

- `AUTH_REQUIRED`
- `INSUFFICIENT_SCOPE`
- `CHANNEL_MISMATCH`
- `VIDEO_NOT_OWNED`
- `VALIDATION_ERROR`
- `PREVIEW_NOT_FOUND`
- `PREVIEW_EXPIRED`
- `PREVIEW_HASH_MISMATCH`
- `REMOTE_STATE_CHANGED`
- `QUOTA_EXCEEDED`
- `YOUTUBE_API_ERROR`
