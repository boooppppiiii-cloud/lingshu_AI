# TikTok / Instagram / Facebook Auth & Publish Setup

The app now keeps all account authorization under:

```text
消息渠道 -> 配对授权
```

The channel/video/comment views are under:

```text
消息渠道 -> 频道总览
```

## TikTok

Environment:

```env
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

Redirect URI:

```text
https://your-domain.com/api/overseas/social/oauth/tiktok/callback
```

Local development:

```text
http://127.0.0.1:8791/api/overseas/social/oauth/tiktok/callback
```

Requested scopes:

```text
user.info.basic
user.info.profile
user.info.stats
video.list
video.publish
```

TikTok direct posting usually requires app approval for Content Posting API.

## Instagram

Instagram uses Meta OAuth. The Instagram account must be a professional account
connected to a Facebook Page.

Environment:

```env
META_SOCIAL_APP_ID=
META_SOCIAL_APP_SECRET=
```

Redirect URI:

```text
https://your-domain.com/api/overseas/social/oauth/instagram/callback
```

Local development:

```text
http://127.0.0.1:8791/api/overseas/social/oauth/instagram/callback
```

Requested permissions:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
pages_read_user_content
instagram_basic
instagram_content_publish
instagram_manage_comments
```

Instagram Reels publishing needs a publicly reachable video URL. For local MP4
files, configure R2 so the backend can upload the rendered video and pass the
public URL to Instagram:

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=overseas-assets
R2_PUBLIC_URL=https://your-public-r2-domain
```

## Facebook

Facebook also uses Meta OAuth and publishes to Facebook Pages, not personal
profiles.

Redirect URI:

```text
https://your-domain.com/api/overseas/social/oauth/facebook/callback
```

Local development:

```text
http://127.0.0.1:8791/api/overseas/social/oauth/facebook/callback
```

The same `META_SOCIAL_APP_ID` and `META_SOCIAL_APP_SECRET` are used.

## Advanced Manual Connect

The authorization cards also include an advanced manual-connect fallback for
implementation/admin use. Normal customers should use one-click OAuth whenever
possible.

It is disabled by default. Enable it only during implementation:

```env
ADVANCED_MANUAL_CONNECT_ENABLED=true
```

- YouTube: Refresh Token is required. Google Client ID and Client Secret are
  read from `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET`.
- TikTok: Access Token is required. Refresh Token is optional.
- Facebook: Page Access Token is required. Page ID is optional when the token
  can resolve `/me` to the Page.
- Instagram: Page Access Token is required. Provide either Instagram Business
  Account ID or the connected Facebook Page ID.

Manual tokens are validated against the provider API before the account is
saved, and stored tokens are never returned to the frontend.

## Notes

- Keep all client secrets on the server.
- Production apps normally require TikTok/Meta app review before customer-wide
  publishing permissions work.
- TikTok comment reading is not exposed in this app yet because it needs
  separate TikTok API availability/approval.
