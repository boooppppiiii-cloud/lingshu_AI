import { useMemo, useState, useEffect } from 'react';
import { Info, Sparkles, Loader2, Flame, TrendingUp, Check, Play } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { studioApi } from '../lib/studioApi';

/* 流量页 = 社媒内容数据（内容运营视角）。
   记录「内容基因」（选题/钩子/形式/时长/封面/平台/语言/投流），
   重点分析 爆款率·内容基因曝光·完播·内容→视频曝光，
   呈现 爆款墙 + 气泡矩阵 + 趋势 + 明细。占位数据，接入后替换。 */

interface Post {
  id: string; title: string; hue: number;
  platform: string; account: string; lang: string; postType: '自发' | '达人'; paid: boolean; spend: number;
  topic: string; hook: string; format: string; dur: string;
  daysAgo: number;
  plays: number; comp: number; eng: number; clicks: number; inq: number; orders: number; gmv: number;
}

const POSTS: Post[] = [
  { id: 'p1',  title: 'You NEED this in 2026',     hue: 38,  platform: 'TikTok',    account: '@yiwu_home',     lang: '阿语', postType: '自发', paid: false, spend: 0,   topic: '痛点解决', hook: '痛点冲击', format: '真人口播', dur: '15-30s', daysAgo: 0,  plays: 1240000, comp: 42, eng: 8.1, clicks: 9200, inq: 142, orders: 421, gmv: 9240 },
  { id: 'p12', title: 'Stop wasting money on…',    hue: 240, platform: 'TikTok',    account: '@yiwu_home',     lang: '英语', postType: '自发', paid: false, spend: 0,   topic: '痛点解决', hook: '痛点冲击', format: '真人口播', dur: '15-30s', daysAgo: 1,  plays: 880000,  comp: 39, eng: 7.8, clicks: 6100, inq: 103, orders: 236, gmv: 5180 },
  { id: 'p5',  title: '3 problems this solves',    hue: 200, platform: 'TikTok',    account: '@yiwu_home',     lang: '阿语', postType: '达人', paid: false, spend: 0,   topic: '痛点解决', hook: '数字冲击', format: '达人出镜', dur: '15-30s', daysAgo: 2,  plays: 960000,  comp: 35, eng: 6.9, clicks: 5200, inq: 96,  orders: 198, gmv: 4520 },
  { id: 'p2',  title: 'Factory price, 24h ship',   hue: 140, platform: 'Instagram', account: '@yiwu.official', lang: '英语', postType: '自发', paid: false, spend: 0,   topic: '促销',     hook: '价格冲击', format: '纯混剪',   dur: '<15s',   daysAgo: 3,  plays: 710000,  comp: 29, eng: 7.2, clicks: 3300, inq: 61,  orders: 142, gmv: 3210 },
  { id: 'p9',  title: 'Creator picks her fav',     hue: 340, platform: 'TikTok',    account: '@yiwu_home',     lang: '阿语', postType: '达人', paid: false, spend: 0,   topic: '达人种草', hook: '悬念',     format: '达人出镜', dur: '15-30s', daysAgo: 4,  plays: 640000,  comp: 33, eng: 7.5, clicks: 4600, inq: 74,  orders: 151, gmv: 3460 },
  { id: 'p3',  title: 'Why everyone is obsessed',  hue: 320, platform: 'TikTok',    account: '@yiwu_home',     lang: '西语', postType: '自发', paid: false, spend: 0,   topic: '测评',     hook: '反常识',   format: '真人口播', dur: '30-60s', daysAgo: 5,  plays: 520000,  comp: 31, eng: 6.4, clicks: 4100, inq: 88,  orders: 167, gmv: 3980 },
  { id: 'p7',  title: 'POV: your desk upgrade',    hue: 60,  platform: 'TikTok',    account: '@yiwu_home',     lang: '英语', postType: '自发', paid: true,  spend: 380, topic: '场景演示', hook: '提问',     format: '纯混剪',   dur: '<15s',   daysAgo: 7,  plays: 540000,  comp: 34, eng: 5.2, clicks: 3200, inq: 36,  orders: 96,  gmv: 2200 },
  { id: 'p13', title: 'Ramadan gift idea',         hue: 150, platform: 'Instagram', account: '@yiwu.official', lang: '阿语', postType: '自发', paid: false, spend: 0,   topic: '促销',     hook: '悬念',     format: '纯混剪',   dur: '15-30s', daysAgo: 8,  plays: 470000,  comp: 30, eng: 6.1, clicks: 2900, inq: 52,  orders: 118, gmv: 2740 },
  { id: 'p6',  title: '$12 vs $200 — which wins',  hue: 280, platform: 'Instagram', account: '@yiwu.official', lang: '西语', postType: '自发', paid: true,  spend: 240, topic: '对比',     hook: '数字冲击', format: '纯混剪',   dur: '15-30s', daysAgo: 11, plays: 300000,  comp: 27, eng: 4.9, clicks: 1800, inq: 22,  orders: 58,  gmv: 1480 },
  { id: 'p11', title: 'The one home find',         hue: 100, platform: 'Facebook',  account: 'Yiwu Home',      lang: '英语', postType: '自发', paid: true,  spend: 180, topic: '测评',     hook: '痛点冲击', format: '纯混剪',   dur: '15-30s', daysAgo: 13, plays: 260000,  comp: 22, eng: 3.4, clicks: 1200, inq: 19,  orders: 47,  gmv: 980 },
  { id: 'p4',  title: 'Unboxing the viral kit',    hue: 20,  platform: 'YouTube',   account: 'Yiwu Trading',   lang: '英语', postType: '自发', paid: false, spend: 0,   topic: '开箱',     hook: '悬念',     format: '真人口播', dur: '30-60s', daysAgo: 15, plays: 420000,  comp: 21, eng: 4.8, clicks: 1600, inq: 24,  orders: 53,  gmv: 1520 },
  { id: 'p10', title: 'Pin this for later',        hue: 0,   platform: 'Pinterest', account: 'Yiwu Home',      lang: '西语', postType: '自发', paid: false, spend: 0,   topic: '场景演示', hook: '反常识',   format: '图文',     dur: '<15s',   daysAgo: 18, plays: 330000,  comp: 0,  eng: 3.1, clicks: 2400, inq: 19,  orders: 47,  gmv: 1180 },
  { id: 'p8',  title: 'How to set up in 60s',      hue: 170, platform: 'YouTube',   account: 'Yiwu Trading',   lang: '英语', postType: '自发', paid: false, spend: 0,   topic: '教程',     hook: '提问',     format: '真人口播', dur: '30-60s', daysAgo: 22, plays: 180000,  comp: 24, eng: 4.1, clicks: 900,  inq: 14,  orders: 31,  gmv: 880 },
  { id: 'p14', title: 'Tutorial: pro setup',       hue: 190, platform: 'YouTube',   account: 'Yiwu Trading',   lang: '英语', postType: '自发', paid: false, spend: 0,   topic: '教程',     hook: '数字冲击', format: '真人口播', dur: '>60s',   daysAgo: 27, plays: 120000,  comp: 19, eng: 3.6, clicks: 600,  inq: 9,   orders: 21,  gmv: 560 },
];

// 30 天视频曝光 / 播放趋势（占位，确定性生成）
const SERIES = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() - (29 - i));
  const wave = 1 + 0.45 * Math.sin(i / 3.2) + 0.25 * Math.sin(i / 1.7);
  return { day: `${d.getMonth() + 1}/${d.getDate()}`, daysAgo: 29 - i, gmv: Math.round(620 * wave + 180), plays: Math.round(120000 * wave + 30000) };
});

const PLATFORMS = ['全部', 'TikTok', 'Instagram', 'YouTube', 'Facebook', 'Pinterest'];
const LANGS = ['全部', '英语', '阿语', '西语'];
const POST_TYPES = ['全部', '自发', '达人'] as const;
const TOPIC_COLORS: Record<string, string> = {
  痛点解决: '#16a34a', 促销: '#16a34a', 测评: '#3b82f6', 场景演示: '#a855f7',
  对比: '#ec4899', 教程: '#0891b2', 达人种草: '#ef4444', 开箱: '#f59e0b',
};
const THRESHOLDS = [[300000, '30万'], [500000, '50万'], [800000, '80万']] as const;

const uniq = (k: keyof Post) => ['全部', ...Array.from(new Set(POSTS.map(p => String(p[k]))))];
const F = { topic: uniq('topic'), hook: uniq('hook'), format: uniq('format'), platform: uniq('platform'), lang: uniq('lang'), paid: ['全部', '投流', '自然'] };

const wan = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : Math.round(n).toLocaleString());
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const convOf = (p: Post) => (p.clicks ? p.orders / p.clicks * 100 : 0);

export default function TrafficDataBoard({ windowDays = 30 }: { windowDays?: number }) {
  const [platform, setPlatform] = useState('全部');
  const [lang, setLang] = useState('全部');
  const [postType, setPostType] = useState<'全部' | '自发' | '达人'>('全部');
  const [paidOnly, setPaidOnly] = useState(false);
  const [compare, setCompare] = useState(false);
  const [threshold, setThreshold] = useState(500000);
  const [view, setView] = useState<'reach' | 'conv'>('reach'); // 高起量 / 高转化
  const [yMetric, setYMetric] = useState<'exposure' | 'inq' | 'roas'>('exposure'); // 气泡 y 轴
  const [insight, setInsight] = useState<{ summary: string; actions: string[] } | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const posts = useMemo(() => POSTS.filter(p =>
    p.daysAgo <= windowDays
    && (platform === '全部' || p.platform === platform)
    && (lang === '全部' || p.lang === lang)
    && (postType === '全部' || p.postType === postType)
    && (!paidOnly || p.paid)), [platform, lang, postType, paidOnly, windowDays]);

  // 明细表的列头下拉筛选（在上方全局筛选基础上再下钻）
  const [tf, setTf] = useState({ topic: '全部', hook: '全部', format: '全部', platform: '全部', lang: '全部', paid: '全部' });
  const setF = (k: keyof typeof tf, v: string) => setTf(s => ({ ...s, [k]: v }));
  const tablePosts = useMemo(() => posts.filter(p =>
    (tf.topic === '全部' || p.topic === tf.topic)
    && (tf.hook === '全部' || p.hook === tf.hook)
    && (tf.format === '全部' || p.format === tf.format)
    && (tf.platform === '全部' || p.platform === tf.platform)
    && (tf.lang === '全部' || p.lang === tf.lang)
    && (tf.paid === '全部' || (tf.paid === '投流' ? p.paid : !p.paid))), [posts, tf]);

  const agg = useMemo(() => {
    const sum = (k: keyof Post) => posts.reduce((s, p) => s + (p[k] as number), 0);
    const hits = posts.filter(p => p.plays >= threshold);
    const plays = sum('plays');
    return {
      n: posts.length, hits: hits.length, hitRate: posts.length ? hits.length / posts.length * 100 : 0,
      plays, gmv: sum('gmv'), clicks: sum('clicks'), inq: sum('inq'), orders: sum('orders'), spend: sum('spend'),
      comp: plays ? posts.reduce((s, p) => s + p.comp * p.plays, 0) / plays : 0,
      conv: sum('clicks') ? sum('orders') / sum('clicks') * 100 : 0,
    };
  }, [posts, threshold]);

  const wall = useMemo(() => [...posts].sort((a, b) => view === 'reach' ? b.plays - a.plays : convOf(b) - convOf(a)).slice(0, 8), [posts, view]);

  // 气泡：按选题聚合
  const bubble = useMemo(() => {
    const m = new Map<string, { topic: string; x: number; gmv: number; inq: number; spend: number; z: number }>();
    posts.forEach(p => {
      const e = m.get(p.topic) ?? { topic: p.topic, x: 0, gmv: 0, inq: 0, spend: 0, z: 0 };
      e.x += p.plays; e.gmv += p.gmv; e.inq += p.inq; e.spend += p.spend; e.z += 1; m.set(p.topic, e);
    });
    return [...m.values()].map(e => ({
      topic: e.topic, x: Math.round(e.x / 10000), z: e.z,
      y: yMetric === 'exposure' ? Math.round(e.x / 10000) : yMetric === 'inq' ? e.inq : (e.spend > 0 ? +(e.gmv / e.spend).toFixed(1) : null),
    })).filter(e => e.y !== null) as { topic: string; x: number; y: number; z: number }[];
  }, [posts, yMetric]);

  // 基因排行（按视频曝光）
  const genes = useMemo(() => {
    const rank = (key: 'hook' | 'topic' | 'format') => {
      const m = new Map<string, number>();
      posts.forEach(p => m.set(p[key], (m.get(p[key]) ?? 0) + p.plays));
      const arr = [...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, 4);
      const max = arr[0]?.v ?? 1;
      return arr.map(x => ({ ...x, pct: Math.round(x.v / max * 100) }));
    };
    return { hook: rank('hook'), topic: rank('topic'), format: rank('format') };
  }, [posts]);

  const platBar = useMemo(() => {
    const m = new Map<string, number>();
    posts.forEach(p => m.set(p.platform, (m.get(p.platform) ?? 0) + p.plays));
    return [...m.entries()].map(([platform, exposure]) => ({ platform, exposure })).sort((a, b) => b.exposure - a.exposure);
  }, [posts]);

  const trend = useMemo(() => SERIES.filter(s => s.daysAgo <= windowDays), [windowDays]);

  // AI 结论（按当期聚合请求；后端不可用时本地兜底）
  useEffect(() => {
    let cancelled = false;
    setInsightLoading(true);
    const topTopic = genes.topic[0]?.k ?? '';
    const t = setTimeout(async () => {
      const metrics = { 发布: agg.n, 爆款: agg.hits, 爆款率: `${agg.hitRate.toFixed(0)}%`, 视频曝光: agg.plays, 引流: agg.clicks, 询盘: agg.inq, 完播率: `${agg.comp.toFixed(0)}%`, 最佳选题: topTopic, 最佳钩子: genes.hook[0]?.k };
      const r = await studioApi.insight({ scope: 'traffic', metrics });
      if (cancelled) return;
      if (r.summary) setInsight({ summary: r.summary, actions: r.actions ?? [] });
      else setInsight({
        summary: `本期发 ${agg.n} 条爆 ${agg.hits} 条（${agg.hitRate.toFixed(0)}%），「${topTopic}」选题曝光最高。`,
        actions: [`放大「${genes.hook[0]?.k ?? '痛点冲击'}」开场`, '阿语 TikTok 加量', '砍掉低完播教程类'],
      });
      setInsightLoading(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agg.n, agg.hits, agg.plays, threshold]);

  const seg = (active: boolean) => `px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`;
  const sel = 'rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs outline-none hover:border-border-bright';
  const GREEN = '#16a34a';
  const delta = (v: string) => compare ? <span className="text-[10px] font-semibold text-accent ml-1">▲ {v}</span> : null;

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-5xl mx-auto">
        {/* 控件（日期维度在数据大屏壳层统一控制） */}
        <div className="flex items-center gap-2.5 flex-wrap mb-4">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
            {POST_TYPES.map(p => <button key={p} className={seg(postType === p)} onClick={() => setPostType(p)}>{p}</button>)}
          </div>
          <select value={platform} onChange={e => setPlatform(e.target.value)} className={sel}>{PLATFORMS.map(p => <option key={p} value={p}>{p === '全部' ? '全部平台' : p}</option>)}</select>
          <select value={lang} onChange={e => setLang(e.target.value)} className={sel}>{LANGS.map(l => <option key={l} value={l}>{l === '全部' ? '全部语言' : l}</option>)}</select>
          <button onClick={() => setPaidOnly(v => !v)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors" style={paidOnly ? { borderColor: GREEN, background: '#DCFCE7', color: '#166534' } : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <span className="w-3.5 h-3.5 rounded flex items-center justify-center" style={{ background: paidOnly ? GREEN : 'transparent', border: paidOnly ? 'none' : '1px solid var(--color-border-bright)' }}>{paidOnly && <Check size={10} className="text-white" />}</span>仅投流
          </button>
          <button onClick={() => setCompare(v => !v)} className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${compare ? 'border-accent text-accent' : 'border-border text-text-secondary hover:text-text-primary'}`}>对比上期</button>
        </div>

        {/* AI 结论 */}
        <div className="rounded-xl p-3.5 mb-5 flex items-start gap-2.5" style={{ background: 'var(--color-accent-glow)' }}>
          <Sparkles size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
          <div className="min-w-0 flex-1">
            {insightLoading && !insight ? (
              <p className="text-sm text-text-secondary flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> AI 正在解读本期数据…</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-text-primary leading-snug">{insight?.summary}</p>
                {insight?.actions?.length ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {insight.actions.map((a, i) => <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-surface text-text-secondary border border-border">{a}</span>)}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* 一号位：爆款率 + 爆款墙 */}
        <div className="flex items-center gap-2 mb-2.5">
          <Flame size={15} style={{ color: GREEN }} />
          <span className="text-sm font-semibold text-text-primary">{view === 'reach' ? '爆款表现' : '高转化内容'}</span>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border ml-1">
            <button className={seg(view === 'reach')} onClick={() => setView('reach')}>高起量</button>
            <button className={seg(view === 'conv')} onClick={() => setView('conv')}>高转化</button>
          </div>
          {view === 'reach' && (
            <div className="flex items-center gap-1 ml-auto text-[11px] text-text-muted">
              爆款线
              <select value={threshold} onChange={e => setThreshold(+e.target.value)} className="rounded-md border border-border bg-surface px-1.5 py-1 text-[11px] outline-none">
                {THRESHOLDS.map(([v, l]) => <option key={v} value={v}>{l}播放</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex gap-4 mb-6 flex-col lg:flex-row">
          {/* 爆款率仪表 */}
          <div className="rounded-2xl p-5 flex-shrink-0 lg:w-56" style={{ background: '#DCFCE7' }}>
            {view === 'reach' ? (
              <>
                <p className="text-xs" style={{ color: '#166534' }}>爆款率 {delta('4pp')}</p>
                <p className="text-4xl font-bold mt-1" style={{ color: '#166534' }}>{agg.hitRate.toFixed(0)}%</p>
                <p className="text-xs mt-2" style={{ color: '#166534' }}>本期发 {agg.n} 条 · 爆 {agg.hits} 条</p>
                <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: 'rgba(133,79,11,0.2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${agg.hitRate}%`, background: GREEN }} />
                </div>
                <p className="text-[11px] mt-3" style={{ color: '#166534' }}>破流量池 {agg.hits} · 平均完播 {agg.comp.toFixed(0)}%</p>
              </>
            ) : (
              <>
                <p className="text-xs" style={{ color: '#166534' }}>平均转化率 {delta('1.2pp')}</p>
                <p className="text-4xl font-bold mt-1" style={{ color: '#166534' }}>{agg.conv.toFixed(1)}%</p>
                <p className="text-xs mt-2" style={{ color: '#166534' }}>引流 {wan(agg.clicks)} · 下单 {Math.round(agg.orders)}</p>
                <p className="text-[11px] mt-3" style={{ color: '#166534' }}>视频曝光 {wan(agg.plays)}</p>
              </>
            )}
          </div>
          {/* 爆款墙 */}
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {wall.map(p => {
                const hot = p.plays >= threshold;
                return (
                  <div key={p.id} className="card !rounded-xl overflow-hidden">
                    <div className="relative aspect-[4/5]" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 60% 80%), hsl(${(p.hue + 40) % 360} 60% 68%))` }}>
                      {view === 'reach' && hot && <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white flex items-center gap-0.5" style={{ background: GREEN }}><Flame size={9} /> 爆款</span>}
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[8px] font-semibold text-white bg-black/45">{p.platform}</span>
                      <span className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] font-bold text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,.7)' }}>
                        {view === 'reach' ? `曝光 ${wan(p.plays)}` : `转化 ${convOf(p).toFixed(1)}% · 曝光 ${wan(p.plays)}`}
                      </span>
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-[10px] text-text-muted truncate">{p.topic} · {p.hook}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 内容基因：气泡矩阵 + ROI 排行 */}
        <div className="flex items-center gap-2 mb-2.5">
          <TrendingUp size={15} className="text-text-muted" />
          <span className="text-sm font-semibold text-text-primary">内容基因分析</span>
          <span className="text-xs text-text-muted">选题 × 效果</span>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border ml-auto">
            {([['exposure', '视频曝光'], ['inq', '询盘'], ['roas', '投流 ROAS']] as const).map(([m, l]) => <button key={m} className={seg(yMetric === m)} onClick={() => setYMetric(m)}>{l}</button>)}
          </div>
        </div>
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          <div className="card !rounded-xl p-3">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 12, bottom: 16, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis type="number" dataKey="x" name="曝光(万)" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" label={{ value: '曝光(万)', position: 'insideBottom', offset: -8, fontSize: 10 }} />
                  <YAxis type="number" dataKey="y" name={yMetric} tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                  <ZAxis type="number" dataKey="z" range={[80, 500]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={((v: number, n: string) => [n === 'y' ? (yMetric === 'exposure' ? `${v}万` : yMetric === 'roas' ? `${v}x` : v) : `${v}万`, n === 'y' ? '效果' : '曝光']) as never} labelFormatter={() => ''} />
                  <Scatter data={bubble}>
                    {bubble.map((e, i) => <Cell key={i} fill={TOPIC_COLORS[e.topic] ?? '#888'} fillOpacity={0.75} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 mt-1">
              {bubble.map(e => <span key={e.topic} className="flex items-center gap-1 text-[10px] text-text-muted"><span className="w-2 h-2 rounded-full" style={{ background: TOPIC_COLORS[e.topic] }} />{e.topic}</span>)}
            </div>
          </div>
          <div className="card !rounded-xl p-4">
            <div className="grid grid-cols-3 gap-3">
              {([['hook', '钩子'], ['topic', '选题'], ['format', '形式']] as const).map(([key, label]) => (
                <div key={key}>
                  <p className="text-[11px] text-text-secondary mb-2">{label} · 曝光榜</p>
                  {genes[key].map(g => (
                    <div key={g.k} className="mb-2">
                      <div className="flex justify-between text-[11px]"><span className="truncate">{g.k}</span><span className="text-text-muted ml-1">{wan(g.v)}</span></div>
                      <div className="h-1.5 rounded-full bg-surface-2 mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${g.pct}%`, background: GREEN }} /></div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 趋势 + 平台对比 */}
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          <div className="card !rounded-xl p-3">
            <p className="text-xs text-text-secondary mb-1 px-1">视频曝光趋势 {delta('18%')}</p>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 6, right: 10, bottom: 0, left: -10 }}>
                  <defs><linearGradient id="gmvFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.35} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 9 }} stroke="var(--color-text-muted)" interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 9 }} stroke="var(--color-text-muted)" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={((v: number) => [wan(Number(v)), '视频曝光']) as never} />
                  <Area type="monotone" dataKey="plays" stroke={GREEN} strokeWidth={2} fill="url(#gmvFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card !rounded-xl p-3">
            <p className="text-xs text-text-secondary mb-1 px-1">各平台视频曝光</p>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={platBar} layout="vertical" margin={{ top: 6, right: 12, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} stroke="var(--color-text-muted)" />
                  <YAxis type="category" dataKey="platform" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" width={62} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={((v: number) => [wan(Number(v)), '视频曝光']) as never} cursor={{ fill: 'var(--color-surface-2)' }} />
                  <Bar dataKey="exposure" radius={[0, 4, 4, 0]} fill={GREEN} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* 明细表（列头下拉筛选） */}
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '17%' }} />
              {Array.from({ length: 13 }).map((_, i) => <col key={i} />)}
            </colgroup>
            <thead>
              <tr className="bg-surface-2 text-text-secondary align-bottom">
                <th className="px-1.5 py-2 text-left font-semibold">内容</th>
                {([['topic', '选题'], ['hook', '钩子'], ['format', '形式'], ['platform', '平台'], ['lang', '语言'], ['paid', '投流']] as const).map(([k, label]) => (
                  <th key={k} className="px-1 py-1.5 text-left font-semibold">
                    <select value={tf[k]} onChange={e => setF(k, e.target.value)}
                      className={`w-full bg-transparent text-[11px] font-semibold outline-none cursor-pointer ${tf[k] === '全部' ? 'text-text-secondary' : 'text-accent'}`}>
                      {F[k].map(o => <option key={o} value={o}>{o === '全部' ? label : o}</option>)}
                    </select>
                  </th>
                ))}
                {['播放', '完播', '引流', '询盘', '下单', '视频曝光', '转化'].map(h => (
                  <th key={h} className="px-1.5 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tablePosts.map(p => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-1.5 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-10 rounded-md flex-shrink-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 60% 80%), hsl(${(p.hue + 40) % 360} 60% 68%))` }}>
                        <Play size={11} className="text-white/90" fill="currentColor" />
                      </div>
                      <span className="truncate" title={p.title}>{p.title}</span>
                    </div>
                  </td>
                  <td className="px-1.5 py-2 whitespace-nowrap">{p.topic}</td>
                  <td className="px-1.5 py-2 whitespace-nowrap">{p.hook}</td>
                  <td className="px-1.5 py-2 whitespace-nowrap">{p.format}</td>
                  <td className="px-1.5 py-2">{p.platform}</td>
                  <td className="px-1.5 py-2">{p.lang}</td>
                  <td className="px-1.5 py-2">{p.paid ? <span className="px-1 py-0.5 rounded text-[9px] font-semibold" style={{ background: '#DCFCE7', color: '#166534' }}>投流</span> : <span className="text-text-muted">—</span>}</td>
                  <td className="px-1.5 py-2">{wan(p.plays)}</td>
                  <td className="px-1.5 py-2">{p.comp ? `${p.comp}%` : '—'}</td>
                  <td className="px-1.5 py-2">{p.clicks.toLocaleString()}</td>
                  <td className="px-1.5 py-2">{p.inq}</td>
                  <td className="px-1.5 py-2">{p.orders}</td>
                  <td className="px-1.5 py-2 font-semibold" style={{ color: '#166534' }}>{wan(p.plays)}</td>
                  <td className="px-1.5 py-2">{convOf(p).toFixed(1)}%</td>
                </tr>
              ))}
              {tablePosts.length === 0 && <tr><td colSpan={14} className="px-2 py-8 text-center text-text-muted">当前筛选无数据</td></tr>}
            </tbody>
          </table>
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-text-muted mt-4">
          <Info size={12} /> 数据来源：浅层取自各平台 Insights · 视频曝光取自播放与触达指标 · 投流取自投放后台；爆款=播放达阈值
        </p>
      </div>
    </div>
  );
}
