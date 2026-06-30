# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release.

## Reporting a vulnerability

Do not open a public issue for credential exposure, authorization bypass, wrong-channel writes, or supply-chain vulnerabilities. Use GitHub's private vulnerability reporting for `FullStackCraft/youtube-mcp`.

Include the affected version, reproduction steps using test credentials, and the expected impact. Never include live OAuth tokens, client secrets, private analytics, or production channel data.

## Credential incident response

If credentials may have been exposed:

1. Revoke the affected Google Account connection.
2. Delete the local profile token files.
3. Rotate or delete the OAuth client in Google Cloud.
4. Review YouTube Studio for unexpected metadata changes.
5. Report the suspected product vulnerability privately.
