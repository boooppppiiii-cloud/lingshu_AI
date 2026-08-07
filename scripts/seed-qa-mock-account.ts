import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.production', override: true });

const pbUrl = String(process.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const appUrl = String(process.env.QA_MOCK_APP_URL || 'http://127.0.0.1:8788/api/overseas').replace(/\/$/, '');
const email = String(process.env.QA_MOCK_EMAIL || 'lingshu-qa-mock@local.test').trim().toLowerCase();
const password = String(process.env.QA_MOCK_PASSWORD || '');
const tenantName = '灵枢 QA Mock 企业';
const marker = 'qa_mock_isolated';

type Row = Record<string, unknown>;

function escaped(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function request(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${url} failed ${response.status}: ${await response.text()}`);
  return await response.json() as Row;
}

async function adminToken() {
  const identity = String(process.env.PB_ADMIN_EMAIL || '');
  const secret = String(process.env.PB_ADMIN_PASSWORD || '');
  if (!identity || !secret) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD are required');
  for (const route of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const response = await fetch(`${pbUrl}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password: secret }),
    });
    if (response.ok) return String((await response.json() as Row).token || '');
  }
  throw new Error('PocketBase admin login failed');
}

async function list(token: string, collection: string, filter: string) {
  const params = new URLSearchParams({ page: '1', perPage: '200', filter });
  const result = await request(`${pbUrl}/api/collections/${collection}/records?${params}`, { headers: { Authorization: token } });
  return (result.items || []) as Row[];
}

async function write(token: string, collection: string, body: Row, id?: string) {
  return await request(`${pbUrl}/api/collections/${collection}/records${id ? `/${id}` : ''}`, {
    method: id ? 'PATCH' : 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main() {
  if (password.length < 12) throw new Error('QA_MOCK_PASSWORD must contain at least 12 characters');
  const token = await adminToken();
  const users = await list(token, 'users', `email = "${escaped(email)}"`);
  let tenantId = String(users[0]?.tenantId || '');
  let tenant: Row | undefined;
  if (tenantId) tenant = (await list(token, 'tenants', `id = "${escaped(tenantId)}"`))[0];
  if (!tenant) {
    tenant = await write(token, 'tenants', {
      name: tenantName,
      companyName: tenantName,
      industry: '美容护肤品 OEM/ODM',
      notes: marker,
      subscriptionStatus: 'active',
      subscriptionPlan: 'qa_mock',
      registeredEmail: email,
      registeredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    tenantId = String(tenant.id);
  } else {
    await write(token, 'tenants', { name: tenantName, notes: marker, subscriptionStatus: 'active', subscriptionPlan: 'qa_mock' }, tenantId);
  }

  const userBody = { email, password, passwordConfirm: password, name: 'QA Mock Tester', tenantId, emailVisibility: true };
  const user = users[0]?.id ? await write(token, 'users', userBody, String(users[0].id)) : await write(token, 'users', userBody);

  const profile = {
    company: { name: tenantName, industry: '美容护肤品 OEM/ODM', companyType: '生产厂家', mainMarkets: '美国、英国、阿联酋', primaryLanguages: '英语、俄语', socialPlatformExperience: 'YouTube、TikTok、Instagram', founded: '2016', description: '仅供前端全链路测试的隔离 Mock 企业。' },
    products: { categories: '精华液、面膜、防晒乳', priceRange: 'US$1.80-8.50', moq: '500件', certifications: 'ISO 22716、GMPC', highlights: '低 MOQ、7天打样、OEM/ODM', items: [
      { sku: 'QA-SERUM-001', name: 'Mock 玻尿酸精华液', category: '精华液', priceRange: 'US$2.20-3.60', moq: '500件', certifications: 'ISO 22716', highlights: '补水、无香型、可定制包装' },
      { sku: 'QA-MASK-002', name: 'Mock 胶原面膜', category: '面膜', priceRange: 'US$1.80-2.80', moq: '1000件', certifications: 'GMPC', highlights: '独立包装、支持贴牌' },
    ] },
    brand: { tone: '专业、可信、简洁', style: 'B2B 工厂实证', taboos: '禁止医疗功效承诺', usp: '低 MOQ 与快速打样', preferredLanguages: '英语、俄语' },
    strategy: { currentGoal: '获取海外 OEM 询盘', focusProducts: '精华液、面膜', focusMarkets: '美国、英国、阿联酋', excludedMarkets: '', pricingStrategy: '阶梯报价', minMargin: '25%', agentAutonomy: '草稿优先', aiAutonomy: 'draft_only' },
    customers: { targetProfiles: '美妆品牌创始人、采购经理、经销商', highValueSignals: '询问 MOQ、打样、证书', lowQualitySignals: '只索取免费样品', commonQuestions: 'MOQ、交期、配方、包装', followupStyle: '简洁专业' },
    operations: { leadTime: '样品7天，大货25天', customization: '配方、瓶器、标签、彩盒', logistics: 'EXW/FOB/CIF', paymentTerms: '30%定金，70%出货前', riskNotes: '不得承诺未经验证的功效' },
    knowledge: '这是 QA Mock 数据。所有内容仅用于测试，不代表真实企业。',
    dataGovernance: { aiAccessEnabled: true, lastSavedAt: new Date().toISOString(), lastSavedSource: 'system' },
  };
  const profiles = await list(token, 'tenant_profiles', `tenant_id = "${escaped(tenantId)}"`);
  await write(token, 'tenant_profiles', { tenant_id: tenantId, profile, updated_by: String(user.id) }, profiles[0]?.id ? String(profiles[0].id) : undefined);

  const oldTrends = await list(token, 'trend_videos', `tenantId = "${escaped(tenantId)}"`);
  for (const row of oldTrends) {
    await fetch(`${pbUrl}/api/collections/trend_videos/records/${row.id}`, { method: 'DELETE', headers: { Authorization: token } });
  }
  const trendSeeds = [
    ['Mock 爆款｜3秒展示精华液质地', 'TikTok', 18, 'texture_demo,hook,qa_mock'],
    ['Mock 爆款｜工厂灌装线实拍', 'YouTube', 32, 'factory,production,qa_mock'],
    ['Mock 爆款｜面膜包装前后对比', 'Instagram', 24, 'before_after,packaging,qa_mock'],
    ['Mock 爆款｜低MOQ采购问答', 'TikTok', 21, 'buyer_pain,moq,qa_mock'],
  ];
  const trendIds: string[] = [];
  for (const [title, platform, duration, tags] of trendSeeds) {
    const row = await write(token, 'trend_videos', {
      tenantId, platform, title, duration, tags, status: 'completed',
      thumbnailUrl: `https://picsum.photos/seed/${encodeURIComponent(String(title))}/360/640`,
      sourceUrl: `https://example.com/qa-mock/${trendIds.length + 1}`,
      aiAnalysis: JSON.stringify({ summary: `${title} 的 Mock 分析`, status: 'completed', marker }),
      crawledAt: new Date().toISOString(),
    });
    trendIds.push(String(row.id));
  }
  const today = new Date().toISOString().slice(0, 10);
  const dailies = await list(token, 'daily_trends', `tenantId = "${escaped(tenantId)}"`);
  for (const row of dailies) await fetch(`${pbUrl}/api/collections/daily_trends/records/${row.id}`, { method: 'DELETE', headers: { Authorization: token } });
  await write(token, 'daily_trends', { tenantId, date: today, videoIds: trendIds.join(','), selectedIds: trendIds.join(','), status: 'completed' });

  const login = await request(`${appUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const appToken = String(login.token || '');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const currentMaterials = await request(`${appUrl}/studio/materials?scope=own`, { headers: { Authorization: `Bearer ${appToken}` } }) as unknown as Row[];
  const names = new Set((Array.isArray(currentMaterials) ? currentMaterials : []).map(item => String(item.name || '')));
  for (const name of ['QA Mock 产品主图', 'QA Mock 工厂实拍图', 'QA Mock 包装细节图']) {
    if (names.has(name)) continue;
    await request(`${appUrl}/studio/materials`, {
      method: 'POST', headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: name.includes('工厂') ? 'factory' : name.includes('包装') ? 'detail' : 'product', type: 'image', width: 1080, height: 1920, mimeType: 'image/png', dataBase64: png, scope: 'own' }),
    });
  }

  console.log(JSON.stringify({ ok: true, email, tenantId, userId: user.id, trends: trendIds.length, materials: 3 }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
