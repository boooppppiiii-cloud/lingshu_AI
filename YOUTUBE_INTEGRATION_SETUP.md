# YouTube Integration Setup Guide

## Overview

This YouTube integration allows you to connect your YouTube channel to access:
- 📺 **Video Data**: View all your videos with view counts, likes, and comments
- 💬 **Comments**: Access all comments from your videos
- 📊 **Analytics**: View subscriber count, total views, and monetization status
- 💰 **Super Chats**: Track channel memberships and super chat events (where available)

## Prerequisites

- A Google Account with YouTube channel access
- Google Cloud Project with YouTube Data API v3 enabled
- OAuth 2.0 Client ID credentials

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. In the search bar, search for "YouTube Data API v3"
4. Click "YouTube Data API v3" and enable it

## Step 2: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - Choose "External" for User Type
   - Fill in required information
   - Add scopes:
     - `https://www.googleapis.com/auth/youtube`
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/yt-analytics.readonly`
4. Select **Desktop application** as the application type
5. Name it "Overseas Marketing Agent - YouTube"
6. Download the credentials as JSON

## Step 3: Get Your OAuth Tokens

You need to perform OAuth 2.0 authorization flow to get your refresh token:

### Option A: Using Google's OAuth Playground (Easiest)

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. Click the settings icon (gear) in the top-right
3. Check "Use your own OAuth credentials"
4. Enter your Client ID and Client Secret
5. In the left panel:
   - Select "YouTube Data API v3"
   - Choose all scopes you need
   - Click "Authorize APIs"
6. Click "Exchange authorization code for tokens"
7. Copy the **Refresh Token** and **Access Token**

### Option B: Using Your Application

If you prefer to use command line, create this script:

```bash
# save as get_youtube_token.sh
CLIENT_ID="your-client-id.apps.googleusercontent.com"
CLIENT_SECRET="your-client-secret"
REDIRECT_URI="urn:ietf:wg:oauth:2.0:oob"

# First, open this URL in your browser
echo "Visit this URL and approve:"
echo "https://accounts.google.com/o/oauth2/v2/auth?client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyt-analytics.readonly"

# Then paste the authorization code here
read -p "Enter authorization code: " AUTH_CODE

# Exchange for tokens
curl -X POST "https://oauth2.googleapis.com/token" \
  -d "code=$AUTH_CODE&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&redirect_uri=$REDIRECT_URI&grant_type=authorization_code"
```

## Step 4: Connect Your YouTube Channel in the App

1. Open the YouTube Integration page in your Overseas Marketing Agent
2. Click "Connect YouTube Account"
3. Fill in:
   - **Client ID**: From your OAuth credentials JSON
   - **Client Secret**: From your OAuth credentials JSON
   - **Refresh Token**: From the OAuth authorization process
4. Click "Connect"

## API Endpoints

Once connected, the following endpoints are available (all require authentication):

### List Connected Accounts
```
GET /api/overseas/youtube/accounts
```

### Get Channel Information
```
GET /api/overseas/youtube/accounts/:id/channel-info
```

### Get All Videos
```
GET /api/overseas/youtube/accounts/:id/videos?maxResults=50
```

### Get All Comments (from all videos)
```
GET /api/overseas/youtube/accounts/:id/comments?maxResults=1000
```

### Get Comments on Specific Video
```
GET /api/overseas/youtube/accounts/:id/video/:videoId/comments?maxResults=100
```

### Get Channel Analytics
```
GET /api/overseas/youtube/accounts/:id/analytics
```

### Get Super Chats
```
GET /api/overseas/youtube/accounts/:id/super-chats?videoId=optional
```

### Sync Account Data
```
POST /api/overseas/youtube/accounts/:id/sync
```

## Example API Usage

### Connect Account (cURL)
```bash
curl -X POST http://localhost:8788/api/overseas/youtube/connect \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

### Get Videos (cURL)
```bash
curl -X GET "http://localhost:8788/api/overseas/youtube/accounts/ACCOUNT_ID/videos?maxResults=50" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

### Get Comments (cURL)
```bash
curl -X GET "http://localhost:8788/api/overseas/youtube/accounts/ACCOUNT_ID/comments" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

## Data Sync

YouTube data is automatically cached in the PocketBase database. You can:

1. **Manual Sync**: Click "Sync Data" on any connected account to refresh
2. **Schedule Sync**: (Optional) Set up scheduled tasks to sync data at intervals
3. **Selective Fetch**: Each endpoint fetches fresh data from YouTube API

## Rate Limiting

YouTube API has quota limits:
- Each user gets 10,000 quota units per day
- Different endpoints consume different amounts:
  - `channels` endpoint: 1 unit
  - `playlistItems` endpoint: 1 unit
  - `videos` endpoint: 1 unit per video (max 50 per request)
  - `commentThreads` endpoint: 1 unit per video (max 20 comments)

## Troubleshooting

### "Invalid YouTube credentials"
- Verify your Client ID, Secret, and Refresh Token are correct
- Make sure YouTube Data API v3 is enabled in Google Cloud Console
- Check that your OAuth scopes include `youtube` and `youtube.readonly`

### "401 Unauthorized"
- Your refresh token might be expired
- Try disconnecting and reconnecting the account
- Re-authorize through the OAuth flow

### "403 Forbidden"
- Your Google Cloud project might not have YouTube API enabled
- Check API quota hasn't been exceeded
- Verify OAuth scopes in Google Cloud Console

### No Super Chats Appearing
- Super Chats require specific OAuth scopes
- Not all channels have Super Chat feature enabled
- Only channels with monetization enabled can receive Super Chats

## Security Best Practices

1. **Never share your Client Secret or Refresh Token**
2. **Store credentials securely** - use environment variables, not hardcoded values
3. **Rotate credentials regularly** in your Google Cloud Console
4. **Use OAuth consent screen** to inform users about data access
5. **Monitor API quota** to detect unusual usage patterns

## Support Resources

- [YouTube Data API Documentation](https://developers.google.com/youtube/v3)
- [OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [YouTube API Quota Documentation](https://developers.google.com/youtube/v3/determine_quota_cost)
- [Google Cloud Console](https://console.cloud.google.com/)

## Database Schema

The integration stores account information in the `youtube_accounts` collection:

```typescript
interface YouTubeAccount {
  tenantId: string;              // Your tenant ID
  userId: string;                // Your user ID
  channelId: string;             // YouTube channel ID
  channelTitle: string;          // Channel name
  channelDescription: string;    // Channel description
  customUrl: string;             // Custom URL if available
  clientId: string;              // OAuth Client ID
  clientSecret: string;          // OAuth Client Secret (encrypted)
  refreshToken: string;          // OAuth Refresh Token (encrypted)
  accessToken: string;           // Current Access Token
  subscriberCount: number;       // Channel subscribers
  videoCount: number;            // Total videos
  viewCount: number;             // Total views
  thumbnailUrl: string;          // Channel thumbnail
  connectedAt: string;           // ISO timestamp
  lastSyncAt: string;            // Last sync timestamp
  isMonetized: boolean;          // Monetization status
  status: 'connected' | 'error' | 'expired';
}
```

## Next Steps

1. ✅ Create Google Cloud Project
2. ✅ Enable YouTube Data API v3
3. ✅ Create OAuth 2.0 credentials
4. ✅ Get your OAuth tokens
5. ✅ Connect your YouTube channel in the app
6. ✅ Start accessing your video data and comments!
