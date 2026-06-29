# YouTube One-Click OAuth Setup

This setup lets customers connect a YouTube channel by clicking **连接 YouTube**.
Customers do not need to copy Client ID, Client Secret, or Refresh Token.

## 1. Google Cloud

1. Enable **YouTube Data API v3** for the Google Cloud project.
2. Open **Google Auth Platform** and configure the OAuth consent screen.
3. Add these scopes:

```text
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube.readonly
```

4. Create an OAuth Client:

```text
Application type: Web application
```

5. Add this authorized redirect URI:

```text
https://your-domain.com/api/overseas/youtube/oauth/callback
```

For local development, use the local backend origin:

```text
http://127.0.0.1:8790/api/overseas/youtube/oauth/callback
```

The redirect URI in Google Cloud must exactly match the app origin that starts
the OAuth flow.

## 2. Server Environment

Add these values to `.env`:

```env
PUBLIC_BASE_URL=https://your-domain.com
YOUTUBE_OAUTH_CLIENT_ID=your-google-oauth-client-id
YOUTUBE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
```

For local development, `PUBLIC_BASE_URL` can stay empty. The backend will use
the current request origin, such as `http://127.0.0.1:8790`.

## 3. Customer Flow

1. Open **消息渠道**.
2. Open **配对授权**.
3. Click **连接 YouTube**.
4. Sign in with the Google account that owns the YouTube channel.
5. Allow the requested YouTube permissions.

After that, **流量专家 -> AI生成 -> 一键发布** can upload rendered MP4 files to
the connected YouTube channel.

## Manual Admin Bootstrap

If you already have a `Client ID`, `Client Secret`, and `Refresh Token`, do not
hardcode them into source files.

Use:

```text
消息渠道 -> 配对授权 -> YouTube 一键授权 -> 高级手动接入
```

Paste the three values there once. The frontend sends them to the backend
`/api/overseas/youtube/connect` endpoint, and the backend stores the connected
YouTube account for the current tenant.

## Notes

- Keep `YOUTUBE_OAUTH_CLIENT_SECRET` only on the server.
- Keep `Refresh Token` only in backend storage.
- If the OAuth app is still in Testing mode, add the customer's Google account
  under **Test users**.
- Unverified YouTube API apps may be limited by Google's review policy.
