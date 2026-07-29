import { SocialConnectionPanel, YouTubeConnectionPanel } from './YouTubeIntegration';
import UserSocialAppCredentials from './UserSocialAppCredentials';

export default function ChannelsPage() {
  return (
    <main
      className="h-full overflow-y-auto bg-gray-50 p-5 pb-28 md:pb-5"
      data-lingshu-guide="channel-connections"
    >
      <UserSocialAppCredentials />
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <YouTubeConnectionPanel />
        <SocialConnectionPanel platform="instagram" />
        <SocialConnectionPanel platform="facebook" />
        <SocialConnectionPanel platform="tiktok" />
      </div>
    </main>
  );
}
