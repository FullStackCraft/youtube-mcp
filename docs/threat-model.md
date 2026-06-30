# Threat Model

## Protected assets

- Google OAuth client credentials and refresh tokens.
- Creator-only YouTube metadata and analytics.
- Integrity of channel ownership and video metadata.
- MCP stdio protocol integrity.

## Trust boundaries

- The local operator and filesystem.
- The MCP host and any model it invokes.
- Google's OAuth, YouTube Data, and YouTube Analytics services.
- npm/GitHub distribution infrastructure.

## Primary threats and controls

| Threat | Control |
| --- | --- |
| Credential disclosure | Protected platform files, atomic writes, symlink rejection, strict package allowlist, secret scan, and redacted errors. |
| OAuth callback forgery | Random loopback port, cryptographic state, PKCE S256, five-minute timeout, and one short-lived listener. |
| Excess permission | Separate readonly/manage tokens; readonly is default; no monetary or partner scopes. |
| Wrong-channel operation | Profile binding after OAuth; owned-channel checks on reads, preview, and apply. |
| Accidental metadata loss | No direct write; complete writable snippet; exact diff; expiry; hash; remote-state recheck; post-write verification. |
| Duplicate/ambiguous write | One-time preview and read-after-error reconciliation instead of blind retries. |
| Protocol corruption | Stdio stdout is reserved for MCP; diagnostics use stderr. |
| Supply-chain leakage | Packed-package inspection, clean-install smoke test, CI, lockfile, and runtime dependency audit. |

## Accepted limitations

- MCP annotations are hints and cannot force a host to show a human confirmation dialog. Operators must review the preview before apply.
- Protected files are not equivalent to an operating-system keychain. A user or process with access to the local account can read them.
- Google's manage scope is broader than the four write fields exposed by this server.
- The server cannot determine the remaining Google Cloud quota through the YouTube API; reported quota units are per-call estimates.
- An MCP host can retain tool results after this server exits. Consult that host's retention policy.
