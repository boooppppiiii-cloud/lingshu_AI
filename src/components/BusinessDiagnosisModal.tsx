import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, ChevronLeft, ChevronRight, Copy, ExternalLink, FileSpreadsheet, ImagePlus, KeyRound, Loader2, Upload, X } from 'lucide-react';
import type { Page } from '../App';
import type { AuthSession } from '../lib/auth';
import { authHeader } from '../lib/auth';
import {
  PRODUCT_FIELD_LABELS,
  PRODUCT_SCHEMA_FIELDS,
  type ParsedSheet,
  type ProductMapping,
  type ProductSchemaField,
  heuristicProductMapping,
  mapRowToProduct,
  parseWorkbook,
  prepareSheet,
} from '../lib/productImport';
import KnowledgeIntakePanel from './enterprise/KnowledgeIntakePanel';

interface Props {
  open: boolean;
  session: AuthSession;
  onClose: () => void;
  onDismissToday: () => void;
  onNavigate: (page: Page) => void;
}

type Category = '服装' | '家居' | '饰品' | '五金' | '美妆' | '玩具' | '消费电子' | '其他';
type Market = '中东' | '东南亚' | '欧美' | '拉美';
type PlatformStatus = '做过' | '没做过' | '正在准备';
type ProductImportPath = 'upload' | 'api' | 'manual';

interface EnterpriseProduct {
  sku?: string;
  name: string;
  category?: string;
  color?: string;
  size?: string;
  tagPrice?: string;
  material?: string;
  imageUrl?: string;
  highlights?: string;
  images?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
  videos?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
  documents?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
}

interface EnterpriseProfile {
  company?: { name?: string; industry?: string; mainMarkets?: string; primaryLanguages?: string; description?: string };
  products?: { categories?: string; highlights?: string; items?: EnterpriseProduct[] };
  brand?: { preferredLanguages?: string; usp?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string };
  customers?: { targetProfiles?: string };
  knowledge?: string;
}

interface ProductApiInfo {
  apiKey: string;
  tenantId: string;
  docsUrl: string;
  createdAt?: string;
  lastIngestedAt?: string;
  lastProductName?: string;
}

interface ProductApiStatus {
  count: number;
  lastIngestedAt?: string;
  lastProductName?: string;
}

const CATEGORIES: Category[] = ['服装', '家居', '饰品', '五金', '美妆', '玩具', '消费电子', '其他'];
const MARKETS: Market[] = ['中东', '东南亚', '欧美', '拉美'];
const PLATFORM_OPTIONS: PlatformStatus[] = ['做过', '没做过', '正在准备'];
const BATCH_SIZE = 200;

function defaultLanguage(markets: Market[]) {
  if (markets.includes('中东')) return '阿语';
  if (markets.includes('拉美')) return '西语';
  if (markets.includes('欧美')) return '英语';
  if (markets.includes('东南亚')) return '英语';
  return '';
}

async function readProfile(): Promise<EnterpriseProfile> {
  return fetch('/api/overseas/enterprise/profile', { headers: authHeader() }).then(r => r.json()).catch(() => ({}));
}

async function saveProfile(profile: EnterpriseProfile) {
  await fetch('/api/overseas/enterprise/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(profile),
  });
}

function upsertProducts(existing: EnterpriseProduct[], incoming: EnterpriseProduct[]) {
  const next = [...existing];
  for (const product of incoming) {
    const sku = product.sku?.trim();
    const index = sku ? next.findIndex(item => item.sku?.trim() === sku) : -1;
    if (index >= 0) next[index] = { ...next[index], ...product };
    else next.push(product);
  }
  return next;
}

async function uploadManualImage(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const response = await fetch('/api/overseas/enterprise/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ name: file.name, type: file.type, dataUrl }),
  });
  if (!response.ok) throw new Error('图片上传失败');
  return response.json() as Promise<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
}

export default function BusinessDiagnosisModal({ open, session, onClose, onDismissToday }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [path, setPath] = useState<ProductImportPath>('upload');
  const [companyName, setCompanyName] = useState(session.tenant?.name || '');
  const [category, setCategory] = useState<Category | ''>('');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [platform, setPlatform] = useState<PlatformStatus | ''>('');
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState<ProductMapping>({});
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingNote, setMappingNote] = useState('');
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [total, setTotal] = useState(0);
  const [manualName, setManualName] = useState('');
  const [manualSellingPoint, setManualSellingPoint] = useState('');
  const [manualImage, setManualImage] = useState<File | null>(null);
  const [apiInfo, setApiInfo] = useState<ProductApiInfo | null>(null);
  const [apiStatus, setApiStatus] = useState<ProductApiStatus>({ count: 0 });
  const [apiBaseline, setApiBaseline] = useState<ProductApiStatus | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  const language = defaultLanguage(markets);
  const selectedSheet = useMemo(
    () => sheets.find(sheet => sheet.name === sheetName) ?? sheets.slice().sort((a, b) => b.rowCount - a.rowCount)[0],
    [sheets, sheetName],
  );
  const prepared = useMemo(() => (selectedSheet ? prepareSheet(selectedSheet) : null), [selectedSheet]);
  const hasImageColumn = Object.values(mapping).includes('imageUrl');
  const progress = total ? Math.round((imported / total) * 100) : 0;
  const apiConnected = Boolean(apiBaseline && (
    apiStatus.count > apiBaseline.count ||
    (apiStatus.lastIngestedAt && apiStatus.lastIngestedAt !== apiBaseline.lastIngestedAt)
  ));

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setPath('upload');
  }, [open]);

  const applyBusinessProfile = useCallback(async (products?: EnterpriseProduct[]) => {
    const profile = await readProfile();
    const existingItems = Array.isArray(profile.products?.items) ? profile.products!.items! : [];
    const nextProducts = products ? upsertProducts(existingItems, products) : existingItems;
    const targetMarkets = markets.join('、');
    const profileText = [
      companyName ? `公司：${companyName}` : '',
      category ? `主营品类：${category}` : '',
      targetMarkets ? `目标市场：${targetMarkets}` : '',
      platform ? `海外平台经验：${platform}` : '',
      language ? `默认创作语言：${language}` : '',
    ].filter(Boolean).join('\n');
    const next: EnterpriseProfile = {
      ...profile,
      company: {
        ...profile.company,
        name: companyName || profile.company?.name || session.tenant?.name || '',
        ...(category ? { industry: category } : {}),
        ...(targetMarkets ? { mainMarkets: targetMarkets } : {}),
        ...(language ? { primaryLanguages: language } : {}),
      },
      products: {
        ...profile.products,
        ...(category ? { categories: category } : {}),
        items: nextProducts,
      },
      brand: {
        ...profile.brand,
        ...(language ? { preferredLanguages: language } : {}),
      },
      strategy: {
        ...profile.strategy,
        ...(targetMarkets ? { focusMarkets: targetMarkets } : {}),
        ...(category ? { focusProducts: category } : {}),
      },
      knowledge: [profile.knowledge, profileText].filter(Boolean).join('\n\n'),
    };
    await saveProfile(next);
  }, [category, companyName, language, markets, platform, session.tenant?.name]);

  const finish = async (dock = false) => {
    await applyBusinessProfile().catch(() => {});
    if (dock) onClose();
    else onDismissToday();
  };

  const loadMapping = useCallback(async (headers: string[], sampleRows: Record<string, string>[]) => {
    const fallback = heuristicProductMapping(headers);
    setMapping(fallback);
    setMappingLoading(true);
    setMappingNote('正在用 AI 识别客户表头');
    try {
      const response = await fetch('/api/overseas/studio/map-product-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ headers, sampleRows }),
      });
      const result = await response.json();
      const aiMapping: ProductMapping = {};
      for (const header of headers) {
        const value = result?.mapping?.[header];
        aiMapping[header] = PRODUCT_SCHEMA_FIELDS.includes(value as ProductSchemaField) ? value : '';
      }
      setMapping({ ...fallback, ...aiMapping });
      setMappingNote(result?.notes || '已根据表头和前 5 行样本生成映射');
    } catch {
      setMappingNote('AI 映射暂不可用，已使用本地规则预映射，可手动调整');
    } finally {
      setMappingLoading(false);
    }
  }, []);

  const onFileChange = async (file?: File) => {
    if (!file) return;
    const parsed = (await parseWorkbook(file)).sort((a, b) => b.rowCount - a.rowCount);
    setSheets(parsed);
    setSheetName(parsed[0]?.name ?? '');
    const first = parsed[0] ? prepareSheet(parsed[0]) : null;
    if (first) void loadMapping(first.headers, first.sampleRows);
  };

  useEffect(() => {
    if (!prepared) return;
    void loadMapping(prepared.headers, prepared.sampleRows);
  }, [loadMapping, prepared?.sheetName]);

  const startImport = async () => {
    if (!prepared) return;
    if (!hasImageColumn) window.alert('没有图片的商品无法生成视频，请后续补传图片列或主图链接。');
    const rows = prepared.dataRows;
    setTotal(rows.length);
    setImported(0);
    setImporting(true);
    try {
      let allProducts: EnterpriseProduct[] = [];
      for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        const batch = rows.slice(start, start + BATCH_SIZE).map(row => {
          const mapped = mapRowToProduct(row, mapping) as Partial<EnterpriseProduct>;
          const imageUrl = mapped.imageUrl?.trim();
          return {
            ...mapped,
            name: mapped.name || mapped.sku || `商品${start + 1}`,
            category: mapped.category || category || undefined,
            images: imageUrl ? [{ name: '商品图片URL', type: 'image/url', size: 0, updatedAt: new Date().toISOString(), url: imageUrl }] : [],
            videos: [],
            documents: [],
          };
        });
        allProducts = [...allProducts, ...batch];
        await applyBusinessProfile(allProducts);
        setImported(Math.min(start + batch.length, rows.length));
      }
    } finally {
      setImporting(false);
    }
  };

  const addManualProduct = async () => {
    if (!manualName.trim() || !manualSellingPoint.trim() || !manualImage) return;
    const image = await uploadManualImage(manualImage);
    await applyBusinessProfile([{
      name: manualName.trim(),
      category: category || undefined,
      highlights: manualSellingPoint.trim(),
      images: [image],
      videos: [],
      documents: [],
    }]);
    setStep(3);
  };

  const refreshProductApiStatus = useCallback(async () => {
    const status = await fetch('/api/overseas/enterprise/product-api/status', { headers: authHeader() }).then(r => r.json());
    setApiStatus(status);
    setApiBaseline(prev => prev ?? status);
    return status as ProductApiStatus;
  }, []);

  const loadProductApiInfo = useCallback(async () => {
    setApiLoading(true);
    try {
      const [info] = await Promise.all([
        fetch('/api/overseas/enterprise/product-api', { headers: authHeader() }).then(r => r.json()),
        refreshProductApiStatus(),
      ]);
      setApiInfo(info);
    } finally {
      setApiLoading(false);
    }
  }, [refreshProductApiStatus]);

  useEffect(() => {
    if (!open || step !== 2 || path !== 'api') return;
    void loadProductApiInfo();
    const timer = window.setInterval(() => {
      void refreshProductApiStatus();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadProductApiInfo, open, path, refreshProductApiStatus, step]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-5 py-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            initial={{ opacity: 0.88, scale: 0.985, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0.92, scale: 0.985, y: 12 }}
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div>
                <p className="text-xs font-semibold text-green-700">首次登录 · 全程可跳过</p>
                <h2 className="text-xl font-bold text-text-primary">5分钟让 AI 开始接待</h2>
                <p className="mt-1 text-sm text-text-muted">先给 AI 一点真实原料，它来整理，你只负责确认。</p>
              </div>
              <button type="button" onClick={() => void finish(false)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-surface-2" title="跳过">
                <X size={16} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="mb-5 grid grid-cols-3 gap-2 text-sm font-bold">
                <div className={`rounded-lg px-4 py-3 ${step === 1 ? 'bg-slate-950 text-white' : 'bg-surface text-text-muted'}`}>1. 生意画像（30秒）</div>
                <div className={`rounded-lg px-4 py-3 ${step === 2 ? 'bg-slate-950 text-white' : 'bg-surface text-text-muted'}`}>2. 产品接入</div>
                <div className={`rounded-lg px-4 py-3 ${step === 3 ? 'bg-slate-950 text-white' : 'bg-surface text-text-muted'}`}>3. 教 AI 怎么回复</div>
              </div>

              {step === 1 ? (
                <div className="grid gap-5">
                  <label className="grid gap-2">
                    <span className="text-sm font-bold text-text-primary">公司名</span>
                    <input className="rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-green-500" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="例如：星河贸易有限公司" />
                  </label>
                  <div>
                    <p className="mb-2 text-sm font-bold text-text-primary">主营品类</p>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map(item => (
                        <button key={item} type="button" onClick={() => setCategory(item)} className={`rounded-lg border px-4 py-2 text-sm font-bold ${category === item ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>{item}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-bold text-text-primary">目标市场</p>
                    <div className="flex flex-wrap gap-2">
                      {MARKETS.map(item => {
                        const active = markets.includes(item);
                        return <button key={item} type="button" onClick={() => setMarkets(prev => active ? prev.filter(v => v !== item) : [...prev, item])} className={`rounded-lg border px-4 py-2 text-sm font-bold ${active ? 'border-green-600 bg-green-600 text-white' : 'border-border bg-white text-text-secondary'}`}>{item}</button>;
                      })}
                    </div>
                    {language && <p className="mt-2 text-xs text-text-muted">创作室默认语言：{language}</p>}
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-bold text-text-primary">有没有做过海外平台</p>
                    <div className="flex flex-wrap gap-2">
                      {PLATFORM_OPTIONS.map(item => (
                        <button key={item} type="button" onClick={() => setPlatform(item)} className={`rounded-lg border px-4 py-2 text-sm font-bold ${platform === item ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>{item}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-secondary" onClick={() => void finish(false)}>跳过</button>
                    <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-40" disabled={!companyName.trim() || !category || !markets.length || !platform} onClick={() => { void applyBusinessProfile(); setStep(2); }}>
                      下一步 <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              ) : step === 2 ? (
                <div className="grid gap-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-bold text-text-secondary hover:bg-surface">
                      <ChevronLeft size={15} /> 返回上一步
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setPath('upload')} className={`rounded-lg border px-4 py-2 text-sm font-bold ${path === 'upload' ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>表格上传 + AI字段映射</button>
                      <button type="button" onClick={() => { setPath('api'); setApiBaseline(null); }} className={`rounded-lg border px-4 py-2 text-sm font-bold ${path === 'api' ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>API接入</button>
                      <button type="button" onClick={() => setPath('manual')} className={`rounded-lg border px-4 py-2 text-sm font-bold ${path === 'manual' ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>手动添加</button>
                    </div>
                  </div>

                  {path === 'upload' ? (
                    <>
                      <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-8 text-center hover:border-green-500 hover:bg-green-50/30">
                        <FileSpreadsheet className="mb-3 h-8 w-8 text-green-700" />
                        <span className="text-sm font-black text-text-primary">上传 xlsx / csv 商品表</span>
                        <span className="mt-1 text-xs text-text-muted">AI 只读取表头和前 5 行样本；上千行会分批写入企业中心。</span>
                        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => void onFileChange(e.target.files?.[0])} />
                      </label>
                      {sheets.length > 0 && prepared && (
                        <div className="grid gap-4">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm font-bold text-text-secondary">Sheet</span>
                            <select className="rounded-lg border border-border px-3 py-2 text-sm" value={selectedSheet?.name ?? ''} onChange={e => setSheetName(e.target.value)}>
                              {sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}（{sheet.rowCount} 行）</option>)}
                            </select>
                            {mappingLoading ? <Loader2 className="h-4 w-4 animate-spin text-green-700" /> : <CheckCircle2 className="h-4 w-4 text-green-700" />}
                            <span className="text-xs text-text-muted">{mappingNote}</span>
                          </div>
                          {!hasImageColumn && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">没有图片的商品无法生成视频，请后续补传图片列或主图链接。</div>}
                          <div className="overflow-hidden rounded-xl border border-border">
                            <div className="grid grid-cols-2 bg-surface text-xs font-black text-text-muted">
                              <div className="px-4 py-3">客户列名</div>
                              <div className="px-4 py-3">系统字段</div>
                            </div>
                            {prepared.headers.map(header => (
                              <div key={header} className="grid grid-cols-2 border-t border-border">
                                <div className="px-4 py-2 text-sm text-text-secondary">{header}</div>
                                <div className="px-4 py-2">
                                  <select className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={mapping[header] ?? ''} onChange={e => setMapping(prev => ({ ...prev, [header]: e.target.value as ProductSchemaField | '' }))}>
                                    <option value="">不导入</option>
                                    {PRODUCT_SCHEMA_FIELDS.map(field => <option key={field} value={field}>{PRODUCT_FIELD_LABELS[field]}</option>)}
                                  </select>
                                </div>
                              </div>
                            ))}
                          </div>
                          {total > 0 && (
                            <div className="rounded-xl border border-border p-4">
                              <div className="mb-2 flex justify-between text-sm font-bold text-text-secondary"><span>已导入 {imported} / {total}</span><span>{progress}%</span></div>
                              <div className="h-2 overflow-hidden rounded-full bg-surface"><div className="h-full bg-green-600 transition-all" style={{ width: `${progress}%` }} /></div>
                            </div>
                          )}
                          <div className="flex flex-wrap justify-end gap-3">
                            <button type="button" className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-secondary" onClick={() => { void startImport(); setStep(3); }}>先导入，去下一步</button>
                            <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-40" disabled={importing} onClick={() => void startImport()}>
                              {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} 确认并批量入库
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : path === 'api' ? (
                    <div className="grid gap-4 rounded-xl border border-border p-5">
                      <div className="flex items-start gap-3">
                        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${apiConnected ? 'bg-green-100 text-green-700' : 'bg-surface text-text-secondary'}`}>
                          {apiConnected ? <CheckCircle2 size={18} /> : apiLoading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-text-primary">{apiConnected ? '已收到数据，产品 API 接通了' : '把这个发给你的技术/ERP服务商'}</p>
                          <p className="mt-1 text-xs leading-relaxed text-text-muted">接口只有批量 upsert、查询、删除；字段就是货号、名称、颜色、尺码、吊牌价、面料、图片、卖点，服装自由标签放 attributes。</p>
                        </div>
                      </div>
                      <div className="grid gap-3 rounded-xl bg-surface p-4">
                        <div>
                          <p className="mb-1 text-xs font-bold text-text-muted">API Key</p>
                          <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-primary">{apiInfo?.apiKey || '正在生成...'}</code>
                            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary" onClick={() => apiInfo?.apiKey && navigator.clipboard?.writeText(apiInfo.apiKey)}>
                              <Copy size={13} />复制
                            </button>
                          </div>
                        </div>
                        <a className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-green-700" href={apiInfo?.docsUrl || '/api/overseas/enterprise/product-api/docs'} target="_blank" rel="noreferrer">
                          查看极简接口文档 <ExternalLink size={13} />
                        </a>
                      </div>
                      <div className={`rounded-xl border px-4 py-3 ${apiConnected ? 'border-green-200 bg-green-50' : 'border-border bg-white'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className={`text-sm font-black ${apiConnected ? 'text-green-700' : 'text-text-primary'}`}>{apiConnected ? '接通成功' : '等待 ERP 推送商品数据'}</p>
                            <p className="mt-1 text-xs text-text-muted">当前企业中心商品数：{apiStatus.count}{apiStatus.lastProductName ? `，最近接入：${apiStatus.lastProductName}` : ''}</p>
                          </div>
                          <button type="button" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white" onClick={() => setStep(3)}>
                            下一步：教 AI 回复
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 rounded-xl border border-border p-5">
                      <p className="text-sm font-bold text-text-secondary">先加一个试试，其他的之后可以批量导入。</p>
                      <input className="rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-green-500" value={manualName} onChange={e => setManualName(e.target.value)} placeholder="主推品名称" />
                      <input className="rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-green-500" value={manualSellingPoint} onChange={e => setManualSellingPoint(e.target.value)} placeholder="一句话卖点" />
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border px-4 py-4 text-sm font-bold text-text-secondary hover:border-green-500">
                        <ImagePlus size={18} className="text-green-700" />
                        {manualImage ? manualImage.name : '上传一张商品图'}
                        <input type="file" accept="image/*" className="hidden" onChange={e => setManualImage(e.target.files?.[0] ?? null)} />
                      </label>
                      <div className="flex justify-end gap-3">
                        <button type="button" className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-secondary" onClick={() => void finish(false)}>跳过</button>
                        <button type="button" className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-40" disabled={!manualName.trim() || !manualSellingPoint.trim() || !manualImage} onClick={() => void addManualProduct()}>添加主推品</button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="text-xs text-text-muted">产品可以以后继续批量补充，不影响先设置接待口径。</p>
                    <button type="button" onClick={() => setStep(3)} className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-bold text-text-secondary hover:bg-surface">
                      暂时跳过产品 <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <button type="button" onClick={() => setStep(2)} className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-bold text-text-secondary hover:bg-surface">
                    <ChevronLeft size={15} /> 返回产品接入
                  </button>
                  <KnowledgeIntakePanel mode="onboarding" onDone={onDismissToday} />
                </div>
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
