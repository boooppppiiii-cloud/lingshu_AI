import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Building2, CheckCircle2, ChevronLeft, ChevronRight, Copy, ExternalLink, FileSpreadsheet, ImagePlus, KeyRound, Loader2, Upload, X } from 'lucide-react';
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
type Market = '中东' | '东南亚' | '中亚' | '南亚' | '东亚' | '欧洲' | '北美' | '拉美' | '非洲' | '大洋洲' | '俄罗斯及独联体' | '其他';
type PlatformStatus = '做过' | '没做过' | '正在准备';
type ProductImportPath = 'upload' | 'api' | 'manual';

interface EnterpriseProduct {
  sku?: string;
  name: string;
  category?: string;
  color?: string;
  size?: string;
  tagPrice?: string;
  retailPrice?: string;
  moq?: string;
  brand?: string;
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
const MARKETS: Market[] = ['中东', '东南亚', '中亚', '南亚', '东亚', '欧洲', '北美', '拉美', '非洲', '大洋洲', '俄罗斯及独联体', '其他'];
const PLATFORM_OPTIONS: PlatformStatus[] = ['做过', '没做过', '正在准备'];
const BATCH_SIZE = 200;
const CONFETTI_COLORS = ['#16a34a', '#0ea5e9', '#f59e0b', '#ec4899', '#7c3aed', '#f97316'];
const CONFETTI_PIECES = Array.from({ length: 48 }, (_, index) => ({
  id: index,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  left: (index * 37 + 7) % 100,
  delay: (index % 12) * 0.08,
  duration: 2.4 + (index % 7) * 0.16,
  drift: ((index % 9) - 4) * 18,
  rotation: 240 + (index % 8) * 75,
  size: 7 + (index % 4) * 2,
}));

function defaultLanguage(markets: Market[]) {
  if (markets.includes('中东')) return '阿语';
  if (markets.includes('拉美')) return '西语';
  if (markets.includes('中亚') || markets.includes('俄罗斯及独联体')) return '俄语';
  if (markets.includes('欧洲') || markets.includes('北美') || markets.includes('大洋洲')) return '英语';
  if (markets.includes('东南亚')) return '英语';
  if (markets.includes('南亚') || markets.includes('东亚') || markets.includes('非洲')) return '英语';
  return '';
}

async function readProfile(): Promise<EnterpriseProfile> {
  return fetch('/api/overseas/enterprise/profile', { headers: authHeader() }).then(r => r.json()).catch(() => ({}));
}

async function saveProfile(profile: EnterpriseProfile) {
  const response = await fetch('/api/overseas/enterprise/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(profile),
  });
  if (!response.ok) throw new Error(`企业资料保存失败（${response.status}）`);
}

function upsertProducts(existing: EnterpriseProduct[], incoming: EnterpriseProduct[]) {
  const next = [...existing];
  for (const product of incoming) {
    const sku = product.sku?.trim();
    const normalizedName = product.name.trim().toLowerCase();
    const index = sku
      ? next.findIndex(item => item.sku?.trim().toLowerCase() === sku.toLowerCase())
      : next.findIndex(item => item.name.trim().toLowerCase() === normalizedName);
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

export default function BusinessDiagnosisModal({ open, session, onDismissToday, onNavigate }: Props) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [celebrating, setCelebrating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [path, setPath] = useState<ProductImportPath>('upload');
  const [companyName, setCompanyName] = useState(session.tenant?.name || '');
  const [category, setCategory] = useState<Category | ''>('');
  const [customCategory, setCustomCategory] = useState('');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [customMarket, setCustomMarket] = useState('');
  const [platform, setPlatform] = useState<PlatformStatus | ''>('');
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState<ProductMapping>({});
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingNote, setMappingNote] = useState('');
  const [headerRowIndex, setHeaderRowIndex] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const [total, setTotal] = useState(0);
  const [importMessage, setImportMessage] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualSellingPoint, setManualSellingPoint] = useState('');
  const [manualImage, setManualImage] = useState<File | null>(null);
  const [apiInfo, setApiInfo] = useState<ProductApiInfo | null>(null);
  const [apiStatus, setApiStatus] = useState<ProductApiStatus>({ count: 0 });
  const [apiBaseline, setApiBaseline] = useState<ProductApiStatus | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  const language = defaultLanguage(markets);
  const selectedCategory = category === '其他' ? customCategory.trim() : category;
  const selectedMarkets = [...markets.filter(item => item !== '其他'), ...(markets.includes('其他') && customMarket.trim() ? [customMarket.trim() as Market] : [])];
  const selectedSheet = useMemo(
    () => sheets.find(sheet => sheet.name === sheetName) ?? sheets.slice().sort((a, b) => b.rowCount - a.rowCount)[0],
    [sheets, sheetName],
  );
  const prepared = useMemo(() => (selectedSheet ? prepareSheet(selectedSheet, headerRowIndex ?? undefined) : null), [headerRowIndex, selectedSheet]);
  const hasImageColumn = Object.values(mapping).includes('imageUrl');
  const mappedFields = Array.from(new Set(Object.values(mapping).filter(Boolean))) as ProductSchemaField[];
  const canImport = Boolean(prepared?.dataRows.length && (mappedFields.includes('name') || mappedFields.includes('sku')) && !mappingLoading);
  const progress = total ? Math.round((imported / total) * 100) : 0;
  const apiConnected = Boolean(apiBaseline && (
    apiStatus.count > apiBaseline.count ||
    (apiStatus.lastIngestedAt && apiStatus.lastIngestedAt !== apiBaseline.lastIngestedAt)
  ));

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setPath('upload');
    setCelebrating(false);
    setCompleting(false);
  }, [open]);

  const applyBusinessProfile = useCallback(async (products?: EnterpriseProduct[]) => {
    const profile = await readProfile();
    const existingItems = Array.isArray(profile.products?.items) ? profile.products!.items! : [];
    const nextProducts = products ? upsertProducts(existingItems, products) : existingItems;
    const targetMarkets = selectedMarkets.join('、');
    const profileText = [
      companyName ? `公司：${companyName}` : '',
      selectedCategory ? `主营品类：${selectedCategory}` : '',
      targetMarkets ? `目标市场：${targetMarkets}` : '',
      platform ? `海外平台经验：${platform}` : '',
      language ? `默认创作语言：${language}` : '',
    ].filter(Boolean).join('\n');
    const next: EnterpriseProfile = {
      ...profile,
      company: {
        ...profile.company,
        name: companyName || profile.company?.name || session.tenant?.name || '',
        ...(selectedCategory ? { industry: selectedCategory } : {}),
        ...(targetMarkets ? { mainMarkets: targetMarkets } : {}),
        ...(language ? { primaryLanguages: language } : {}),
      },
      products: {
        ...profile.products,
        ...(selectedCategory ? { categories: selectedCategory } : {}),
        items: nextProducts,
      },
      brand: {
        ...profile.brand,
        ...(language ? { preferredLanguages: language } : {}),
      },
      strategy: {
        ...profile.strategy,
        ...(targetMarkets ? { focusMarkets: targetMarkets } : {}),
        ...(selectedCategory ? { focusProducts: selectedCategory } : {}),
      },
      knowledge: [profile.knowledge, profileText].filter(Boolean).join('\n\n'),
    };
    await saveProfile(next);
  }, [companyName, language, platform, selectedCategory, selectedMarkets, session.tenant?.name]);

  const completeDiagnosis = async () => {
    if (completing) return;
    setCompleting(true);
    await applyBusinessProfile().catch(() => {});
    setCelebrating(true);
    setCompleting(false);
  };

  const loadMapping = useCallback(async (
    headers: string[],
    sampleRows: Record<string, string>[],
    candidateRows: unknown[][],
    currentHeaderRowIndex: number,
  ) => {
    const fallback = heuristicProductMapping(headers);
    setMapping(fallback);
    setMappingLoading(true);
    setMappingNote('正在用 AI 识别客户表头');
    try {
      const response = await fetch('/api/overseas/studio/map-product-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ headers, sampleRows, candidateRows: candidateRows.slice(0, 10), currentHeaderRowIndex }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'AI mapping failed');
      if (Number.isInteger(result?.headerRowIndex)
        && result.headerRowIndex >= 0
        && result.headerRowIndex < candidateRows.length
        && result.headerRowIndex !== currentHeaderRowIndex) {
        setMappingNote(`AI 重新识别到第 ${result.headerRowIndex + 1} 行是列名，正在刷新映射`);
        setHeaderRowIndex(result.headerRowIndex);
        return;
      }
      const aiMapping: ProductMapping = { ...fallback };
      for (const header of headers) {
        const value = result?.mapping?.[header];
        if (PRODUCT_SCHEMA_FIELDS.includes(value as ProductSchemaField)) aiMapping[header] = value;
      }
      setMapping(aiMapping);
      const recognized = Object.values(aiMapping).filter(Boolean).length;
      setMappingNote(result?.notes || `已识别 ${recognized} 个字段，请确认后入库`);
    } catch {
      setMappingNote('AI 映射暂不可用，已使用本地规则预映射，可手动调整');
    } finally {
      setMappingLoading(false);
    }
  }, []);

  const onFileChange = async (file?: File) => {
    if (!file) return;
    setImportMessage('');
    try {
      const parsed = (await parseWorkbook(file)).sort((a, b) => b.rowCount - a.rowCount);
      setSheets(parsed);
      setSheetName(parsed[0]?.name ?? '');
      const first = parsed[0] ? prepareSheet(parsed[0]) : null;
      setHeaderRowIndex(first?.headerRowIndex ?? null);
    } catch (error) {
      setSheets([]);
      setImportMessage(error instanceof Error ? error.message : '表格读取失败，请检查文件格式');
    }
  };

  useEffect(() => {
    if (!prepared || !selectedSheet) return;
    void loadMapping(prepared.headers, prepared.sampleRows, selectedSheet.rows, prepared.headerRowIndex);
  }, [loadMapping, prepared?.headerRowIndex, prepared?.sheetName, selectedSheet]);

  const startImport = async () => {
    if (!prepared || !canImport) {
      setImportMessage('请先把“商品名称”或“货号”对应到表格中的正确列。');
      return false;
    }
    if (!hasImageColumn) window.alert('没有图片的商品无法生成视频，请后续补传图片列或主图链接。');
    const rows = prepared.dataRows;
    setTotal(rows.length);
    setImported(0);
    setImporting(true);
    setImportMessage('');
    try {
      for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        const batch = rows.slice(start, start + BATCH_SIZE).map(row => {
          const mapped = mapRowToProduct(row, mapping) as Partial<EnterpriseProduct>;
          const name = String(mapped.name || mapped.sku || '').trim();
          if (!name) return null;
          const imageUrl = mapped.imageUrl?.trim();
          return {
            ...mapped,
            name,
            category: mapped.category || selectedCategory || undefined,
            images: imageUrl ? [{ name: '商品图片URL', type: 'image/url', size: 0, updatedAt: new Date().toISOString(), url: imageUrl }] : [],
            videos: [],
            documents: [],
          } as EnterpriseProduct;
        }).filter((product): product is EnterpriseProduct => Boolean(product));
        if (!batch.length) continue;
        await applyBusinessProfile(batch);
        setImported(Math.min(start + batch.length, rows.length));
      }
      setImported(rows.length);
      setImportMessage(`已成功导入 ${rows.length} 条商品，可在企业中心继续补充图片和资料。`);
      return true;
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : '商品入库失败，请稍后重试');
      return false;
    } finally {
      setImporting(false);
    }
  };

  const addManualProduct = async () => {
    if (!manualName.trim() || !manualSellingPoint.trim() || !manualImage) return;
    const image = await uploadManualImage(manualImage);
    await applyBusinessProfile([{
      name: manualName.trim(),
      category: selectedCategory || undefined,
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
      {open && !celebrating && (
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
              <button type="button" onClick={() => setStep(3)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-surface-2" title="跳到最后一步">
                <X size={16} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="mb-5 grid grid-cols-3 gap-2 text-sm font-bold">
                <div className={`rounded-lg px-4 py-3 ${step === 1 ? 'bg-slate-950 text-white' : 'bg-surface text-text-muted'}`}>1. 生意画像（30秒）</div>
                <div className={`rounded-lg px-4 py-3 ${step === 2 ? 'bg-slate-950 text-white' : 'bg-surface text-text-muted'}`}>2. 产品接入</div>
                <div className={`rounded-lg px-4 py-3 ${step === 3 ? 'bg-slate-950 text-white' : 'bg-surface text-text-muted'}`}>3. 设置初始接待</div>
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
                    {category === '其他' && <input className="mt-3 w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-green-500" value={customCategory} onChange={event => setCustomCategory(event.target.value)} placeholder="补充主营品类，例如：汽摩配件" />}
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-bold text-text-primary">目标市场</p>
                    <div className="flex flex-wrap gap-2">
                      {MARKETS.map(item => {
                        const active = markets.includes(item);
                        return <button key={item} type="button" onClick={() => setMarkets(prev => active ? prev.filter(v => v !== item) : [...prev, item])} className={`rounded-lg border px-4 py-2 text-sm font-bold ${active ? 'border-green-600 bg-green-600 text-white' : 'border-border bg-white text-text-secondary'}`}>{item}</button>;
                      })}
                    </div>
                    {markets.includes('其他') && <input className="mt-3 w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-green-500" value={customMarket} onChange={event => setCustomMarket(event.target.value)} placeholder="补充目标国家或地区，例如：加勒比地区" />}
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
                    <button type="button" className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-secondary" onClick={() => setStep(2)}>跳过此步</button>
                    <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-40" disabled={!companyName.trim() || !selectedCategory || !selectedMarkets.length || !platform} onClick={() => { void applyBusinessProfile(); setStep(2); }}>
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
                            <select className="rounded-lg border border-border px-3 py-2 text-sm" value={selectedSheet?.name ?? ''} onChange={e => {
                              const nextName = e.target.value;
                              const nextSheet = sheets.find(sheet => sheet.name === nextName);
                              setSheetName(nextName);
                              setHeaderRowIndex(nextSheet ? prepareSheet(nextSheet).headerRowIndex : null);
                            }}>
                              {sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}（{sheet.rowCount} 行）</option>)}
                            </select>
                            {mappingLoading ? <Loader2 className="h-4 w-4 animate-spin text-green-700" /> : <CheckCircle2 className="h-4 w-4 text-green-700" />}
                            <span className="text-xs text-text-muted">{mappingNote}</span>
                          </div>
                          <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-black text-sky-950">先确认哪一行是列名</p>
                                <p className="mt-1 text-xs leading-5 text-sky-800">如果下面出现的是货号或商品内容，说明表头行选错了，请切换到包含“货号、品名、价格”等列名的那一行。</p>
                              </div>
                              <select className="max-w-md rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-950" value={prepared.headerRowIndex} onChange={event => setHeaderRowIndex(Number(event.target.value))}>
                                {selectedSheet.rows.slice(0, 10).map((row, index) => {
                                  const preview = row.map(value => String(value || '').trim()).filter(Boolean).slice(0, 4).join(' ｜ ');
                                  return <option key={index} value={index}>第 {index + 1} 行：{preview || '空行'}</option>;
                                })}
                              </select>
                            </div>
                          </div>
                          {!hasImageColumn && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">没有图片的商品无法生成视频，请后续补传图片列或主图链接。</div>}
                          <div className="rounded-lg border border-border bg-white px-4 py-3 text-xs leading-5 text-text-secondary">
                            系统正在把您表格里的列对应到产品字段。至少要识别“商品名称”或“货号”；不需要的列可以保持“不导入”。当前将读取 <strong>{prepared.dataRows.length}</strong> 行，已对应 <strong>{mappedFields.length}</strong> 个字段。
                          </div>
                          <div className="overflow-hidden rounded-xl border border-border">
                            <div className="grid grid-cols-2 bg-surface text-xs font-black text-text-muted">
                              <div className="px-4 py-3">您表格中的列</div>
                              <div className="px-4 py-3">导入为</div>
                            </div>
                            {prepared.headers.map(header => (
                              <div key={header} className="grid grid-cols-2 border-t border-border">
                                <div className="px-4 py-2">
                                  <p className="text-sm font-bold text-text-secondary">{header}</p>
                                  <p className="mt-1 truncate text-[11px] text-text-muted">示例：{prepared.sampleRows[0]?.[header] || '空'}</p>
                                </div>
                                <div className="px-4 py-2">
                                  <select className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={mapping[header] ?? ''} onChange={e => setMapping(prev => ({ ...prev, [header]: e.target.value as ProductSchemaField | '' }))}>
                                    <option value="">不导入</option>
                                    {PRODUCT_SCHEMA_FIELDS.map(field => <option key={field} value={field}>{PRODUCT_FIELD_LABELS[field]}</option>)}
                                  </select>
                                </div>
                              </div>
                            ))}
                          </div>
                          {!canImport && !mappingLoading && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">还没找到商品名称或货号。请先纠正表头行，或在右侧手动选择对应字段。</div>}
                          {importMessage && <div className={`rounded-lg border px-4 py-3 text-sm font-semibold ${imported === total && total > 0 ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{importMessage}</div>}
                          {total > 0 && (
                            <div className="rounded-xl border border-border p-4">
                              <div className="mb-2 flex justify-between text-sm font-bold text-text-secondary"><span>已导入 {imported} / {total}</span><span>{progress}%</span></div>
                              <div className="h-2 overflow-hidden rounded-full bg-surface"><div className="h-full bg-green-600 transition-all" style={{ width: `${progress}%` }} /></div>
                            </div>
                          )}
                          <div className="flex flex-wrap justify-end gap-3">
                            <button type="button" disabled={!canImport || importing} className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-secondary disabled:opacity-40" onClick={() => { void startImport(); setStep(3); }}>后台导入，继续下一步</button>
                            <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-40" disabled={!canImport || importing} onClick={() => void startImport()}>
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
                            下一步：完善 AI 接待
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
                        <button type="button" className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-secondary" onClick={() => setStep(3)}>暂时跳过</button>
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
                  <KnowledgeIntakePanel mode="onboarding" onDone={() => void completeDiagnosis()} />
                </div>
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
      {open && celebrating && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-slate-900/20 px-5 py-8 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {!reduceMotion && CONFETTI_PIECES.map(piece => (
            <motion.span
              key={piece.id}
              aria-hidden="true"
              className="pointer-events-none absolute top-[-5vh] rounded-sm"
              style={{
                left: `${piece.left}%`,
                width: piece.size,
                height: piece.size * 1.6,
                backgroundColor: piece.color,
              }}
              initial={{ y: '-6vh', x: 0, rotate: 0, opacity: 0 }}
              animate={{ y: '112vh', x: piece.drift, rotate: piece.rotation, opacity: [0, 1, 1, 0] }}
              transition={{
                duration: piece.duration,
                delay: piece.delay,
                repeat: Infinity,
                repeatDelay: 0.35,
                ease: 'linear',
              }}
            />
          ))}

          <motion.section
            className="relative z-10 flex w-full max-w-4xl flex-col items-center justify-center gap-1 px-2 md:flex-row md:gap-0"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 240, damping: 20, delay: 0.08 }}
          >
            <motion.div
              className="relative h-[250px] w-[250px] shrink-0 md:h-[330px] md:w-[330px]"
              style={{ perspective: 620, transformStyle: 'preserve-3d' }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-[18%] z-0 rounded-full bg-[radial-gradient(circle,rgba(207,247,227,0.54)_0%,rgba(207,247,227,0.18)_48%,transparent_72%)] blur-md"
              />
              <motion.div
                aria-hidden="true"
                className="absolute inset-[3%] z-0 rounded-full [transform-style:preserve-3d]"
                style={{ rotateX: 66, rotateY: -8 }}
                animate={reduceMotion ? undefined : { rotateZ: [-12, 348] }}
                transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
              >
                <span
                  className="absolute inset-0 rounded-full opacity-90 drop-shadow-[0_10px_8px_rgba(52,196,113,0.18)]"
                  style={{
                    background: 'conic-gradient(from 15deg, rgba(52,196,113,0.18), rgba(52,196,113,0.92), rgba(207,247,227,0.3), rgba(52,196,113,0.72), rgba(52,196,113,0.18))',
                    WebkitMaskImage: 'radial-gradient(circle, transparent 68%, #000 69%, #000 72%, transparent 73%)',
                    maskImage: 'radial-gradient(circle, transparent 68%, #000 69%, #000 72%, transparent 73%)',
                  }}
                />
                <span className="absolute left-[5%] top-[42%] h-3 w-3 rounded-full bg-[#6FDBA1] shadow-[0_0_0_6px_rgba(207,247,227,0.55),0_8px_12px_rgba(52,196,113,0.24)]" />
                <span className="absolute right-[7%] top-[25%] h-2.5 w-2.5 rounded-full border-2 border-[#34C471] bg-white shadow-[0_7px_12px_rgba(52,196,113,0.22)]" />
              </motion.div>
              <motion.div
                aria-hidden="true"
                className="absolute inset-[17%] z-0 rounded-full [transform-style:preserve-3d]"
                style={{ rotateX: 58, rotateY: 18 }}
                animate={reduceMotion ? undefined : { rotateZ: [24, -336] }}
                transition={{ duration: 11, repeat: Infinity, ease: 'linear' }}
              >
                <span
                  className="absolute inset-0 rounded-full opacity-80"
                  style={{
                    background: 'conic-gradient(from 190deg, rgba(111,219,161,0.12), rgba(111,219,161,0.82), rgba(255,255,255,0.2), rgba(111,219,161,0.12))',
                    WebkitMaskImage: 'radial-gradient(circle, transparent 63%, #000 64%, #000 68%, transparent 69%)',
                    maskImage: 'radial-gradient(circle, transparent 63%, #000 64%, #000 68%, transparent 69%)',
                  }}
                />
                <span className="absolute right-[10%] top-[50%] h-2.5 w-2.5 rotate-45 rounded-[3px] border border-[#34C471] bg-[#CFF7E3] shadow-[0_6px_10px_rgba(52,196,113,0.22)]" />
              </motion.div>
              <motion.span
                aria-hidden="true"
                className="absolute left-[12%] top-[20%] z-0 text-2xl font-light text-[#34C471]/80 drop-shadow-[0_6px_8px_rgba(52,196,113,0.2)]"
                animate={reduceMotion ? undefined : { y: [0, -7, 0], rotate: [0, 10, 0], scale: [0.92, 1.08, 0.92] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              >+</motion.span>
              <motion.img
                src="/lingshu-mascot.png"
                alt="灵小枢挥手欢迎"
                className="absolute inset-[4%] z-10 h-[92%] w-[92%] object-contain drop-shadow-[0_18px_18px_rgba(52,196,113,0.18)]"
                style={{
                  WebkitMaskImage: 'radial-gradient(ellipse 48% 50% at 50% 50%, #000 52%, rgba(0,0,0,0.88) 68%, transparent 100%)',
                  maskImage: 'radial-gradient(ellipse 48% 50% at 50% 50%, #000 52%, rgba(0,0,0,0.88) 68%, transparent 100%)',
                }}
                animate={reduceMotion ? undefined : { y: [0, -8, 0], rotate: [0, -1.2, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            </motion.div>

            <motion.div
              className="relative w-full max-w-lg rounded-3xl border border-white/90 bg-white/72 p-6 text-center shadow-[0_28px_80px_rgba(15,23,42,0.2)] backdrop-blur-2xl md:p-7 md:text-left"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 250, damping: 22, delay: 0.2 }}
            >
              <span aria-hidden="true" className="absolute left-1/2 top-[-10px] h-5 w-5 -translate-x-1/2 rotate-45 border-l border-t border-white/90 bg-white/72 backdrop-blur-2xl md:hidden" />
              <span aria-hidden="true" className="absolute -left-[10px] top-1/2 hidden h-5 w-5 -translate-y-1/2 rotate-45 border-b border-l border-white/90 bg-white/72 backdrop-blur-2xl md:block" />
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-xs font-black text-emerald-700">灵小枢已准备好</span>
              <h2 className="mt-3 text-3xl font-black text-text-primary">欢迎来到灵枢</h2>
              <p className="mt-3 text-sm leading-7 text-text-secondary">
                基础诊断完成了。我会先按你刚确认的信息协助接待客户，更多企业资料可以随时到企业中心继续完善。
              </p>

              <div className="mt-7 flex w-full flex-col gap-3 sm:flex-row md:justify-start">
                <button
                  type="button"
                  onClick={() => { onNavigate('enterprise'); onDismissToday(); }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700"
                >
                  <Building2 size={17} />去企业中心继续完善
                </button>
                <button
                  type="button"
                  onClick={onDismissToday}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/90 bg-white/65 px-5 py-3 text-sm font-black text-text-secondary backdrop-blur-md hover:bg-white/90"
                >
                  先开始使用
                </button>
              </div>
            </motion.div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
