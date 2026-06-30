# Google Cloud and OAuth Setup

This MCP requires your own Google Cloud project. Full Stack Craft credentials are not bundled with the package.

## 1. Create a dedicated project

Create one Google Cloud project for this API client. Do not reuse or publish credentials from another application.

Enable:

- YouTube Data API v3
- YouTube Analytics API

## 2. Configure OAuth consent

Configure the OAuth consent screen for the account type you need. Add your own Google account as a test user while the consent screen is in testing.

### Add yourself as a test user

If the app's publishing status is **Testing**, Google permits only explicitly approved test users to authorize it:

1. In the Google Cloud Console, select the same project that owns the Desktop OAuth client you will download.
2. Open **Google Auth Platform → Audience**.
3. Confirm that the publishing status is **Testing**.
4. Under **Test users**, click **Add users**.
5. Add the exact Google account that manages the YouTube channel you want to use.
6. Save the audience configuration.
7. Run the `youtube-mcp auth login` command again and choose that same Google account in the browser.

If multiple Google accounts are signed in, use an incognito/private window or carefully confirm the selected account. For a YouTube Brand Account, add and authenticate the Google account that manages the Brand Account—not the channel name.

If Google still returns `Error 403: access_denied` with a message that only developer-approved testers may access the app, check both of these conditions:

- The OAuth client JSON belongs to the same Google Cloud project whose Audience page you edited.
- The Google account shown on the error page exactly matches an entry under **Test users**.

Google's [Audience documentation](https://support.google.com/cloud/answer/15549945) explains the Testing and Production access rules.

The readonly login requests:

- View your YouTube account.
- View non-monetary YouTube Analytics reports.

The manage login additionally requests YouTube account management over HTTPS. The server exposes only title, description, tags, and category updates even though Google's scope is broader.

Google may require verification for wider distribution of an OAuth client. Because this project uses bring-your-own credentials, each operator controls their own Cloud project and consent configuration.

Testing-mode authorizations that request YouTube scopes expire after seven days. This is suitable for initial setup and development, but it requires periodic reauthorization. For durable use, move the OAuth app to **In production**. A personal-use app with a limited audience can continue unverified with Google's warning and user cap; a broadly distributed shared OAuth client using sensitive YouTube scopes should complete Google's verification process. See Google's [OAuth production-readiness overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

## 3. Create a Desktop OAuth client

Create an OAuth client ID with application type **Desktop app**, then download its JSON file. It must have an `installed` object containing `client_id` and `client_secret`.

Store the file outside any source repository. The login command rejects symlinked client files and copies the required client values into the protected local profile directory.

## 4. Log in

```shell
youtube-mcp auth login \
  --profile my-channel \
  --mode readonly \
  --client-secrets /absolute/path/to/client_secret.json
```

The CLI opens Google's authorization page in the system browser and listens temporarily on a random `127.0.0.1` port. It validates OAuth state and uses PKCE S256. The loopback listener closes immediately after success, failure, or timeout.

Authorize manage mode separately only if metadata writes are needed:

```shell
youtube-mcp auth login \
  --profile my-channel \
  --mode manage \
  --client-secrets /absolute/path/to/client_secret.json
```

## 5. Validate

```shell
youtube-mcp auth status --profile my-channel --mode readonly
youtube-mcp doctor --profile my-channel --mode readonly
```

`doctor` verifies the bound channel and both enabled APIs. It does not display tokens or client credentials.

## Revocation

```shell
youtube-mcp auth revoke --profile my-channel --mode readonly
youtube-mcp auth revoke --profile my-channel --mode manage
```

Also review and revoke access from your Google Account's third-party connections when decommissioning a profile.
