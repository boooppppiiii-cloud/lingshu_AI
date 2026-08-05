import { store } from '../storage/index.js';

export type SocialAccountCleanupPlatform = 'youtube' | 'google' | 'meta' | 'tiktok';

export async function disconnectTenantPlatformAccounts(
  tenantId: string,
  platform: SocialAccountCleanupPlatform,
): Promise<number> {
  const collection = platform === 'youtube' || platform === 'google'
    ? 'youtube_accounts'
    : 'social_accounts';
  const result = await store.list<Record<string, unknown>>(collection, {
    where: { tenantId },
    perPage: 200,
  });
  const matching = platform === 'meta'
    ? result.items.filter(item => item.platform === 'instagram' || item.platform === 'facebook')
    : platform === 'tiktok'
      ? result.items.filter(item => item.platform === 'tiktok')
      : result.items;

  let disconnectedAccounts = 0;
  for (const account of matching) {
    const id = typeof account.id === 'string' ? account.id.trim() : '';
    if (!id) continue;
    const deleted = await store.delete(collection, id);
    if (!deleted) throw new Error(`account_disconnect_failed:${collection}:${id}`);
    disconnectedAccounts += 1;
  }
  return disconnectedAccounts;
}
