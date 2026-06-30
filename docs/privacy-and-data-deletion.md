# Privacy and Data Deletion

## Data flow

- OAuth happens directly between the local CLI, the user's system browser, and Google.
- API requests go directly from the local MCP process to official Google APIs.
- Tool results are returned to the configured MCP client. The MCP client's own privacy and model-data policies also apply.
- This package has no telemetry, hosted service, analytics beacon, advertising SDK, or Full Stack Craft data collector.

## Local storage

Named profiles store:

- The selected channel ID and title.
- The operator-provided OAuth client ID and client secret.
- Separate readonly and manage OAuth token files.

Files live in the operating system's application configuration directory. On POSIX systems, profile directories use mode `0700` and credential files use `0600`. Token updates are atomic and symlinked destinations are rejected.

The server does not persist YouTube video metadata or Analytics API data. Update previews exist only in memory, expire after ten minutes, and disappear when the server stops.

## Delete or revoke data

Delete one authorization mode and attempt remote Google revocation:

```shell
youtube-mcp auth revoke --profile <name> --mode readonly
youtube-mcp auth revoke --profile <name> --mode manage
```

To remove the remaining profile metadata and copied OAuth client configuration, delete that profile's directory from the platform config path shown by your operating system. Also revoke the application's access from your Google Account.

Removing the npm package does not automatically remove the platform profile directory.

## YouTube API data obligations

Operators are responsible for using this client consistently with the YouTube API Services Terms, Developer Policies, applicable privacy law, and the consent granted by the authorizing user.
