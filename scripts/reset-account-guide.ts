import { pbGet, pbListStrict } from '../server/storage/pb.js';
import { resetAccountGuide, type DemoAccountRegistryEntry } from '../server/lib/demoAccounts.js';

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function main(): Promise<void> {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Usage: npm run guide:reset -- account@example.com');

  const users = await pbListStrict<Record<string, unknown>>('users', {
    filter: `email = "${escapeFilterValue(email)}"`,
    perPage: 2,
  });
  if (users.items.length !== 1) {
    throw new Error(users.items.length ? `Multiple users found for ${email}` : `Account not found: ${email}`);
  }

  const user = users.items[0];
  const userId = String(user.id || '');
  const tenantId = String(user.tenantId || '');
  if (!userId || !tenantId) throw new Error(`Account identity is incomplete: ${email}`);

  const tenant = await pbGet('tenants', tenantId);
  const plan = String(tenant?.subscriptionPlan || '').toLowerCase();
  const subscriptionStatus = String(tenant?.subscriptionStatus || '').toLowerCase();
  const status: DemoAccountRegistryEntry['status'] = plan === 'admin'
    ? 'admin'
    : plan === 'customer' || subscriptionStatus === 'active'
      ? 'customer'
      : subscriptionStatus === 'expired'
        ? 'expired'
        : 'trialing';

  const updated = resetAccountGuide(email, { userId, tenantId, status });
  console.log(JSON.stringify({
    ok: true,
    email: updated.email,
    userId: updated.userId,
    tenantId: updated.tenantId,
    status: updated.status,
    guidePending: updated.guidePending,
    guideResetAt: updated.guideResetAt,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
