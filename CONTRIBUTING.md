# Contributing

Contributions should preserve the project's local-first, least-privilege security boundary.

## Development

```shell
npm install
npm run release:check
```

Use fake channels and sanitized fixtures in tests. Never commit OAuth client JSON, access tokens, refresh tokens, private analytics, or copied production API responses.

## Pull requests

- Explain changes to OAuth scopes, tool side effects, storage, or API data retention.
- Add tests for tool schemas and error behavior.
- Preserve stdout exclusively for MCP protocol traffic.
- Do not add uploads, deletes, visibility, comments, playlists, thumbnails, monetization, public-channel scraping, or hosted transports without a separate threat-model and policy review.
