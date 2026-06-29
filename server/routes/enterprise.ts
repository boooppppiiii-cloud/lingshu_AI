import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../../data/enterprise.json');

export interface EnterpriseProfile {
  company: {
    name: string;
    industry: string;
    mainMarkets: string;
    founded: string;
    description: string;
  };
  products: {
    categories: string;
    priceRange: string;
    moq: string;
    certifications: string;
    highlights: string;
  };
  brand: {
    tone: string;
    style: string;
    taboos: string;
    usp: string;
  };
  knowledge: string;
}

function readProfile(): EnterpriseProfile {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      company: { name: '', industry: '', mainMarkets: '', founded: '', description: '' },
      products: { categories: '', priceRange: '', moq: '', certifications: '', highlights: '' },
      brand: { tone: '', style: '专业', taboos: '', usp: '' },
      knowledge: '',
    };
  }
}

export function buildEnterpriseContext(profile: EnterpriseProfile): string {
  const parts: string[] = [];
  if (profile.company.name) parts.push(`公司名称：${profile.company.name}`);
  if (profile.company.industry) parts.push(`行业类目：${profile.company.industry}`);
  if (profile.company.mainMarkets) parts.push(`主攻市场：${profile.company.mainMarkets}`);
  if (profile.company.description) parts.push(`公司简介：${profile.company.description}`);
  if (profile.products.categories) parts.push(`主营产品：${profile.products.categories}`);
  if (profile.products.priceRange) parts.push(`价格区间：${profile.products.priceRange}`);
  if (profile.products.moq) parts.push(`起订量：${profile.products.moq}`);
  if (profile.products.highlights) parts.push(`产品优势：${profile.products.highlights}`);
  if (profile.brand.usp) parts.push(`核心卖点：${profile.brand.usp}`);
  if (profile.brand.tone) parts.push(`品牌调性：${profile.brand.tone}`);
  if (profile.brand.taboos) parts.push(`禁忌话题：${profile.brand.taboos}`);
  if (profile.knowledge) parts.push(`补充知识：${profile.knowledge}`);
  return parts.join('\n');
}

export const enterpriseRouter = Router();

enterpriseRouter.get('/profile', (_req, res) => {
  res.json(readProfile());
});

enterpriseRouter.post('/profile', (req, res) => {
  const profile = req.body as EnterpriseProfile;
  fs.writeFileSync(DATA_FILE, JSON.stringify(profile, null, 2), 'utf8');
  res.json({ ok: true });
});

enterpriseRouter.get('/context', (_req, res) => {
  const profile = readProfile();
  res.json({ context: buildEnterpriseContext(profile) });
});
