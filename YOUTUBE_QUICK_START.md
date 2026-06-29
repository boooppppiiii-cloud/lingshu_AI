# YouTube Integration - Quick Start Guide

## Installation Steps

### 1. Backend Setup

The backend is already configured. You have:
- ✅ YouTube API integration (`server/integrations/youtube.ts`)
- ✅ YouTube routes (`server/routes/youtube.ts`)
- ✅ Type definitions (`server/types/index.ts`)

Make sure to restart your server after pulling the changes:
```bash
npm run dev:server
```

### 2. Frontend Integration

#### Option A: Add YouTube Page to Main Navigation

Edit `src/App.tsx` to include YouTube integration:

```typescript
import YouTubeIntegrationPage from './components/YouTubeIntegration';

export type Page =
  | 'strategy'
  | 'traffic'
  | 'conversion'
  | 'retention'
  | 'enterprise'
  | 'plugins'
  | 'scheduled'
  | 'channels'
  | 'youtube';  // Add this

// Then in your router, add:
case 'youtube':
  return <YouTubeIntegrationPage />;
```

#### Option B: Add as Settings/Tools Section

Add a button in your navigation menu:
```typescript
<button
  onClick={() => setCurrentPage('youtube')}
  className="flex items-center gap-2 px-4 py-2 hover:bg-slate-700"
>
  <Youtube size={20} />
  YouTube
</button>
```

### 3. Environment Configuration

Make sure your `.env` file includes (these are already configured by default):
```
# No additional env vars needed for basic YouTube integration
# YouTube OAuth credentials are stored per user in database
```

### 4. Database Initialization

The YouTube accounts table will be created automatically when you first connect an account. If you want to pre-create it, run:

```bash
# This is optional - the table auto-creates
npm run setup:pb
```

## Usage

### First Time Setup

1. **Get OAuth Credentials**:
   - Follow the guide in `YOUTUBE_INTEGRATION_SETUP.md`
   - Get your Client ID, Client Secret, and Refresh Token

2. **Connect Account**:
   - Open YouTube Integration page
   - Click "Connect YouTube Account"
   - Paste your credentials
   - Click "Connect"

3. **Access Data**:
   - View Videos
   - View Comments
   - Sync Data
   - View Analytics

### Features Available

#### 📺 Video Data
```
GET /api/overseas/youtube/accounts/:id/videos
```
Returns all your videos with:
- Title, description, publish date
- View count, likes, comments
- Duration, thumbnails

#### 💬 Comments
```
GET /api/overseas/youtube/accounts/:id/comments
```
Gets all comments across your videos:
- Author name and profile
- Comment text
- Like count and timestamp
- Video ID it belongs to

#### 💬 Video-Specific Comments
```
GET /api/overseas/youtube/accounts/:id/video/:videoId/comments
```
Gets comments on a specific video

#### 📊 Analytics
```
GET /api/overseas/youtube/accounts/:id/analytics
```
Channel metrics:
- Monetization status
- Total subscribers
- Total views
- Video count

#### 💰 Super Chats
```
GET /api/overseas/youtube/accounts/:id/super-chats
```
Channel memberships and super chat events

## API Examples

### Connect Account
```bash
curl -X POST http://localhost:8788/api/overseas/youtube/connect \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "clientSecret": "YOUR_SECRET",
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

### List Accounts
```bash
curl http://localhost:8788/api/overseas/youtube/accounts \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Videos
```bash
curl "http://localhost:8788/api/overseas/youtube/accounts/ACCOUNT_ID/videos?maxResults=50" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Advanced Customization

### Modify the Component

The YouTube component is in `src/components/YouTubeIntegration.tsx`. You can customize:

1. **Colors & Styling**:
   - Change Tailwind classes for different theme

2. **Features**:
   - Add more data fields
   - Modify layout
   - Add export functionality

3. **Error Handling**:
   - Customize error messages
   - Add retry logic
   - Add logging

### Example: Add Video Export Feature

```typescript
const handleExportVideos = () => {
  const csv = [
    ['Title', 'Views', 'Likes', 'Comments', 'Published'].join(','),
    ...videoList.map(v =>
      [v.title, v.viewCount, v.likeCount, v.commentCount, v.publishedAt].join(',')
    ),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'youtube-videos.csv';
  a.click();
};
```

### Example: Add Comment Analysis

```typescript
const analyzeComments = async (comments: YouTubeComment[]) => {
  // Send to your AI agent for sentiment analysis
  const response = await fetch('/api/overseas/agents/analyze', {
    method: 'POST',
    body: JSON.stringify({ comments, task: 'sentiment' }),
  });
  return response.json();
};
```

## Troubleshooting

### "youtube" route not found
- Make sure you added YouTube to the `Page` type in App.tsx
- Added the import statement
- Added the case in the router

### API 404 errors
- Verify `/api/overseas/youtube` routes are registered in `server/index.ts`
- Check that the YouTube route file exists
- Restart the server

### "Unauthorized" errors
- Verify your auth token is valid
- Check token is being sent in Authorization header
- Make sure user is authenticated

### OAuth credential errors
- Double-check Client ID, Secret, and Refresh Token
- Verify they're from the same Google Cloud Project
- Ensure YouTube Data API is enabled
- Try refreshing OAuth tokens through Google Console

## Database Schema

YouTube accounts are stored in `youtube_accounts` collection:

```typescript
{
  id: string;                    // Unique ID
  tenantId: string;              // Your tenant
  userId: string;                // Your user ID
  channelId: string;             // YouTube channel ID
  channelTitle: string;          // Channel name
  channelDescription: string;    // Description
  customUrl: string;             // Channel URL
  clientId: string;              // OAuth Client ID
  clientSecret: string;          // OAuth Secret (encrypted)
  refreshToken: string;          // Refresh Token (encrypted)
  accessToken: string;           // Access Token
  subscriberCount: number;       // Subscribers
  videoCount: number;            // Video count
  viewCount: number;             // Total views
  thumbnailUrl: string;          // Avatar
  connectedAt: string;           // ISO timestamp
  lastSyncAt: string;            // Last sync
  isMonetized: boolean;          // Monetization
  status: string;                // connected|error|expired
}
```

## Performance Tips

1. **Cache Data**: Store fetched videos/comments in React state or IndexedDB
2. **Pagination**: Use `maxResults` parameter to limit API calls
3. **Batch Operations**: Fetch all videos once, then filter locally
4. **Background Sync**: Use scheduled jobs to refresh data periodically
5. **Error Recovery**: Implement auto-retry with exponential backoff

## Security Considerations

1. **Never expose** Client Secret or Refresh Token to frontend
2. **Always use** HTTPS in production
3. **Store tokens** securely in backend (encrypted)
4. **Validate** all user inputs
5. **Rate limit** API calls to avoid quota issues
6. **Audit** data access logs

## Next Steps

1. ✅ Set up Google Cloud Project
2. ✅ Get OAuth credentials  
3. ✅ Add YouTube component to your app
4. ✅ Connect your YouTube channel
5. ✅ Customize as needed

For detailed setup, see `YOUTUBE_INTEGRATION_SETUP.md`
