# YouTube MCP

A safe, local-first Model Context Protocol server for inspecting and managing a creator-owned YouTube channel.

`@fullstackcraftllc/youtube-mcp` uses Google's official YouTube Data API v3 and YouTube Analytics API. It does not scrape YouTube, download videos, send telemetry, or provide a hosted intermediary.

## Features

- Inspect your channel and page through its uploads.
- Read owned-video metadata and public statistics.
- Analyze channel/video performance, traffic sources, YouTube search terms, and audience retention.
- Preview exact title, description, tag, and category changes.
- Apply only an unexpired reviewed preview after rechecking ownership and remote state.
- Maintain separate readonly and manage OAuth authorizations in named local profiles.

Version 0.1 intentionally excludes uploads, deletes, thumbnails, visibility, comments, playlists, monetization, public-channel research, transcripts, and HTTP hosting.

## Requirements

- Node.js 22 or newer.
- A creator-owned YouTube channel.
- Your own Google Cloud project and Desktop OAuth client.

Follow [Google Cloud setup](docs/google-cloud-setup.md) before logging in. Never commit the downloaded OAuth client JSON.

## Authorize a profile

Readonly analytics:

```shell
npx -y @fullstackcraftllc/youtube-mcp@0.1.0 auth login \
  --profile vannacharm \
  --mode readonly \
  --client-secrets /absolute/path/to/client_secret.json
```

Metadata management uses a separate token and explicit extra permission:

```shell
npx -y @fullstackcraftllc/youtube-mcp@0.1.0 auth login \
  --profile vannacharm \
  --mode manage \
  --client-secrets /absolute/path/to/client_secret.json
```

If Google exposes multiple channels, repeat the command with `--channel-id <id>` after the CLI prints the valid choices.

Check configuration without exposing credentials:

```shell
npx -y @fullstackcraftllc/youtube-mcp@0.1.0 auth status --profile vannacharm --mode readonly
npx -y @fullstackcraftllc/youtube-mcp@0.1.0 doctor --profile vannacharm --mode readonly
```

## MCP client configuration

Codex, readonly:

```shell
codex mcp add youtube \
  -- npx -y @fullstackcraftllc/youtube-mcp@0.1.0 serve --profile vannacharm --mode readonly
```

Codex, manage mode as a separately named server:

```shell
codex mcp add youtube-manage \
  -- npx -y @fullstackcraftllc/youtube-mcp@0.1.0 serve --profile vannacharm --mode manage
```

Claude Desktop:

```json
{
  "mcpServers": {
    "youtube": {
      "command": "npx",
      "args": [
        "-y",
        "@fullstackcraftllc/youtube-mcp@0.1.0",
        "serve",
        "--profile",
        "vannacharm",
        "--mode",
        "readonly"
      ]
    }
  }
}
```

The server starts even if authorization is missing so the client can call `youtube_get_auth_status`. Other tools return `AUTH_REQUIRED` until the selected profile and mode are authorized.

## Safe metadata updates

There is no direct update tool. The workflow is:

1. Call `youtube_preview_video_update` with one or more proposed fields.
2. Review the complete before/after diff, video ID, channel ID, expiry, and hash.
3. Call `youtube_apply_video_update` with the preview ID, hash, and exact video ID.

Apply re-fetches current metadata and fails if anything changed since preview. YouTube receives a complete writable snippet so omitted fields are preserved. A preview expires after ten minutes and is consumed after one apply attempt.

See the complete [tool reference](docs/tools.md), [privacy and deletion behavior](docs/privacy-and-data-deletion.md), and [threat model](docs/threat-model.md).

## Other CLI commands

```shell
youtube-mcp profiles list
youtube-mcp auth revoke --profile vannacharm --mode readonly
youtube-mcp auth revoke --profile vannacharm --mode manage
youtube-mcp --help
youtube-mcp --version
```

## Local development

```shell
git clone https://github.com/FullStackCraft/youtube-mcp.git
cd youtube-mcp
npm install
npm run release:check
```

Run locally from an MCP client with:

```shell
node /absolute/path/to/youtube-mcp/dist/index.js serve --profile vannacharm --mode readonly
```

## Compliance and affiliation

Use of this software is subject to the [YouTube Terms of Service](https://www.youtube.com/t/terms), [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service), and [Google Privacy Policy](https://policies.google.com/privacy).

YouTube and Google are trademarks of Google LLC. This independent project is not affiliated with, sponsored by, or endorsed by YouTube or Google.

## License

MIT © Full Stack Craft LLC.
