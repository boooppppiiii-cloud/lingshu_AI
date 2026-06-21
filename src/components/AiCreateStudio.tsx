import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutGrid, Film, FileText, Music, Image as ImageIcon, Play, Send,
  Check, ChevronLeft, ChevronRight, Folder, Search, Volume2, Globe,
  Mic, Download, Loader2, Sparkles, Wand2, Copy, RefreshCw, Clock,
  Upload, X, Plus, Smartphone, List, Save, FolderOpen, Trash2,
} from 'lucide-react';
import { studioApi, getDesktopRender, type StudioProject } from '../lib/studioApi';

/* ──────────────────────────────────────────────────────────────────────────
   AI 生成内容工作台 — 社媒（流量）页子模块
   流程：选模式 → 选素材 → 口播脚本 → 配乐 → 封面 → 成片预览 → 导出/一键发布
   三栏布局：① 步骤导航  ② 操作区  ③ 实时预览 / 制作摘要
─────────────────────────────────────────────────────────────────────────── */

const AMBER = '#d97706';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type StepId = 'mode' | 'material' | 'script' | 'bgm' | 'cover' | 'preview' | 'publish';

const STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',  icon: LayoutGrid, hint: '选择生成起点与全局参数' },
  { id: 'material', label: '选素材',  icon: Film,       hint: '从素材库挑选并排序片段' },
  { id: 'script',   label: '口播脚本', icon: FileText,   hint: 'AI 生成口播 + 配音音色' },
  { id: 'bgm',      label: '配乐',     icon: Music,      hint: 'AI 推荐背景乐与音量平衡' },
  { id: 'cover',    label: '封面',     icon: ImageIcon,  hint: '生成封面候选并选定标题' },
  { id: 'preview',  label: '成片预览', icon: Play,       hint: '合成成片，局部微调重渲染' },
  { id: 'publish',  label: '导出/发布', icon: Send,       hint: '下载成片或一键多平台发布' },
];

/* ── Mock 数据 ─────────────────────────────────────────────────────────── */

interface MaterialFolder { id: string; name: string; count: number }
const FOLDERS: MaterialFolder[] = [
  { id: 'all',     name: '全部素材',   count: 48 },
  { id: 'product', name: '产品主图',   count: 16 },
  { id: 'factory', name: '工厂实拍',   count: 9 },
  { id: 'scene',   name: '使用场景',   count: 12 },
  { id: 'model',   name: '模特出镜',   count: 7 },
  { id: 'detail',  name: '细节特写',   count: 4 },
];

interface Clip {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number; // seconds
  size: string;
}
const CLIPS: Clip[] = [
  { id: 'c1',  name: '产品正面展示.mp4',    folder: 'product', type: 'video', duration: 8,  size: '12.4 MB' },
  { id: 'c2',  name: '开箱细节特写.mp4',    folder: 'detail',  type: 'video', duration: 6,  size: '9.1 MB' },
  { id: 'c3',  name: '工厂流水线.mov',      folder: 'factory', type: 'video', duration: 12, size: '27.9 MB' },
  { id: 'c4',  name: '模特使用场景.mp4',    folder: 'model',   type: 'video', duration: 15, size: '34.1 MB' },
  { id: 'c5',  name: '产品主图01.jpg',      folder: 'product', type: 'image', duration: 0,  size: '690 KB' },
  { id: 'c6',  name: '材质纹理特写.mp4',    folder: 'detail',  type: 'video', duration: 5,  size: '7.3 MB' },
  { id: 'c7',  name: '居家使用场景.mp4',    folder: 'scene',   type: 'video', duration: 10, size: '18.7 MB' },
  { id: 'c8',  name: '功能演示.mp4',        folder: 'scene',   type: 'video', duration: 14, size: '22.5 MB' },
  { id: 'c9',  name: '产品主图02.jpg',      folder: 'product', type: 'image', duration: 0,  size: '720 KB' },
  { id: 'c10', name: '包装展示.mp4',        folder: 'product', type: 'video', duration: 7,  size: '11.2 MB' },
  { id: 'c11', name: '细节质感.jpg',        folder: 'detail',  type: 'image', duration: 0,  size: '540 KB' },
  { id: 'c12', name: '海外仓发货.mp4',      folder: 'factory', type: 'video', duration: 9,  size: '15.8 MB' },
];

interface Bgm { id: string; name: string; mood: string; duration: string; recommended?: boolean }
const BGMS: Bgm[] = [
  { id: 'b1', name: 'Upbeat Pop Energy',    mood: '活力 · 快节奏', duration: '0:30', recommended: true },
  { id: 'b2', name: 'Chill Lo-Fi Vibes',    mood: '舒缓 · 治愈',   duration: '0:45' },
  { id: 'b3', name: 'Cinematic Inspire',    mood: '大气 · 高级感', duration: '0:38' },
  { id: 'b4', name: 'Trendy TikTok Beat',   mood: '潮流 · 卡点',   duration: '0:28' },
];

interface Voice { id: string; name: string; tag: string }
const VOICES: Voice[] = [
  { id: 'v1', name: 'Emma（女声 · 英美）', tag: '亲和' },
  { id: 'v2', name: 'James（男声 · 英美）', tag: '沉稳' },
  { id: 'v3', name: 'Layla（女声 · 阿语）', tag: '温暖' },
  { id: 'v4', name: '上传真人口播',          tag: '自定义' },
];

const COVERS = [
  { id: 'cv1', title: 'You NEED this in 2026', accent: '#d97706' },
  { id: 'cv2', title: 'Factory price, 24h ship', accent: '#16a34a' },
  { id: 'cv3', title: 'Why everyone is obsessed', accent: '#c13584' },
];

interface SocialAccount { id: string; platform: string; handle: string; color: string }
const ACCOUNTS: SocialAccount[] = [
  { id: 'a1', platform: 'TikTok',    handle: '@yiwu_home',     color: '#010101' },
  { id: 'a2', platform: 'Instagram', handle: '@yiwu.official', color: '#c13584' },
  { id: 'a3', platform: 'YouTube',   handle: 'Yiwu Trading',   color: '#ff0000' },
];

const MODES = [
  { id: 'material', icon: Film,    title: '从素材库生成', desc: '挑选本地素材，AI 智能编排成片' },
  { id: 'clone',    icon: Wand2,   title: '爆款克隆',     desc: '复用已分析爆款的结构与节奏' },
  { id: 'product',  icon: Sparkles,title: '从商品生成',   desc: '输入商品信息，一键全自动出片' },
] as const;

const PLATFORMS = [
  { id: 'tiktok',    label: 'TikTok',    ratio: '9:16' },
  { id: 'instagram', label: 'Instagram', ratio: '9:16' },
  { id: 'youtube',   label: 'YouTube',   ratio: '16:9' },
];
const RATIOS = ['9:16', '1:1', '16:9'];
const LANGS = [
  { code: 'en', label: 'English' }, { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' }, { code: 'zh', label: '中文' },
];

const SAMPLE_SCRIPT = `[Hook · 0-3s]
Stop scrolling — this is the one product everyone's been asking about.

[Body · 3-15s]
Sourced straight from our factory, this changed how thousands of buyers shop. Premium quality, factory-direct pricing, ships worldwide in 24 hours.

[CTA · 15-20s]
Tap the link to grab yours before they sell out again.`;

/* ── 缩略图占位 ────────────────────────────────────────────────────────── */
function Thumb({ seed, label, ratio = 'aspect-video' }: { seed: string; label?: string; ratio?: string }) {
  const hue = (seed.charCodeAt(0) * 47 + (seed.charCodeAt(1) ?? 0) * 13) % 360;
  return (
    <div className={`relative w-full ${ratio} overflow-hidden rounded-lg`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 88%), hsl(${(hue + 40) % 360} 55% 78%))` }}>
      <div className="absolute inset-0 opacity-[0.12]"
        style={{ backgroundImage: `repeating-linear-gradient(45deg,#000 0,#000 1px,transparent 0,transparent 10px)` }} />
      {label && (
        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">
          {label}
        </span>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

export default function AiCreateStudio() {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx].id;

  // 全局制作状态
  const [mode, setMode] = useState<'material' | 'clone' | 'product'>('material');
  const [platform, setPlatform] = useState('tiktok');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState(20);
  const [lang, setLang] = useState('en');

  const [activeFolder, setActiveFolder] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>(['c1', 'c2', 'c4']);

  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [scriptType, setScriptType] = useState<'voiceover' | 'storyboard'>('voiceover');
  const [voice, setVoice] = useState('v1');
  const [scriptLoading, setScriptLoading] = useState(false);
  const autoGen = useRef(false); // 仅首次进入脚本步时自动生成一次

  const [bgm, setBgm] = useState('b1');
  const [bgmVol, setBgmVol] = useState(35);

  const [cover, setCover] = useState('cv1');
  const [coverTitles, setCoverTitles] = useState<string[]>(COVERS.map(c => c.title));
  const [coverLoading, setCoverLoading] = useState(false);

  const [selecting, setSelecting] = useState(false);

  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [renderOutputPath, setRenderOutputPath] = useState<string | null>(null); // 桌面端合成产物路径
  const renderToken = useRef(0); // 取消过期的渲染循环（重复点「重新合成」时）

  const [account, setAccount] = useState<string | null>('a1');
  const [caption, setCaption] = useState('Factory-direct home essentials 🏠✨ #tiktokmademebuyit #homefinds');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [published, setPublished] = useState(false);

  // 草稿 / 作品
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('未命名草稿');
  const [showProjects, setShowProjects] = useState(false);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [savingProj, setSavingProj] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  const selectedClips = useMemo(() => CLIPS.filter(c => selected.includes(c.id)), [selected]);
  const totalDur = selectedClips.reduce((s, c) => s + (c.type === 'image' ? 3 : c.duration), 0);
  const matNames = selectedClips.map(c => c.name);
  const curCoverTitle = coverTitles[Math.max(0, COVERS.findIndex(c => c.id === cover))];

  const canNext = step === 'material' ? selected.length > 0 : true;
  const isLast = stepIdx === STEPS.length - 1;

  const goPreview = async () => {
    setStepIdx(STEPS.findIndex(s => s.id === 'preview'));
    setRendered(false);
    setRendering(true);
    setRenderPct(0);
    setRenderOutputPath(null);
    const token = ++renderToken.current;

    const spec = {
      materials: matNames,
      script,
      voice,
      bgm,
      bgmVol,
      coverId: cover,
      coverTitle: curCoverTitle,
      ratio,
      duration,
      platform,
      language: lang,
    };

    // 1) 向服务器申请渲染授权（原料 manifest + 短期令牌）
    const auth = await studioApi.render(spec);

    // 2) 桌面客户端：用本机原生 ffmpeg 真实合成出片
    const desktop = getDesktopRender();
    if (desktop?.available) {
      const unsub = desktop.onProgress(p => {
        if (renderToken.current === token) setRenderPct(Math.min(99, Math.round(p)));
      });
      try {
        const out = await desktop.render(auth.manifest);
        if (renderToken.current !== token) return;
        if (out.ok) {
          setRenderOutputPath(out.outputPath ?? null);
          setRendering(false);
          setRendered(true);
          setRenderPct(100);
        } else {
          setRendering(false);
          setRendered(false);
        }
      } finally {
        unsub();
      }
      return;
    }

    // 3) 纯网页：无法调用本机 ffmpeg，仅模拟进度供预览交互（真出片需桌面客户端）
    for (let p = 12; p <= 100; p += 16) {
      await sleep(240);
      if (renderToken.current !== token) return;
      setRenderPct(Math.min(p, 100));
    }
    setRendering(false);
    setRendered(true);
    setRenderPct(100);
  };

  const next = () => {
    if (STEPS[stepIdx + 1]?.id === 'preview') return goPreview();
    setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  };
  const prev = () => setStepIdx(i => Math.max(i - 1, 0));

  const regenScript = async (type: 'voiceover' | 'storyboard' = scriptType) => {
    setScriptLoading(true);
    const { script: s } = await studioApi.script(
      { materials: matNames, language: lang, platform, duration, scriptType: type }, script,
    );
    setScript(s);
    setScriptLoading(false);
  };

  // 首次进入「口播脚本」步时自动生成一次
  useEffect(() => {
    if (step === 'script' && !autoGen.current) {
      autoGen.current = true;
      void regenScript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const switchScriptType = (type: 'voiceover' | 'storyboard') => {
    if (type === scriptType) return;
    setScriptType(type);
    void regenScript(type);
  };

  const aiSelect = async () => {
    setSelecting(true);
    const { selectedIds } = await studioApi.select(
      { materials: CLIPS.map(c => ({ id: c.id, name: c.name, type: c.type, duration: c.duration })), duration },
      selected,
    );
    setSelected(selectedIds);
    setSelecting(false);
  };

  const regenCovers = async () => {
    setCoverLoading(true);
    const { covers } = await studioApi.covers({ script, language: lang }, coverTitles);
    setCoverTitles(covers);
    setCoverLoading(false);
  };

  const aiCaption = async () => {
    setCaptionLoading(true);
    const { caption: cap, hashtags } = await studioApi.caption(
      { script, platform, language: lang },
      { caption, hashtags: [] },
    );
    const tags = (hashtags ?? []).map(t => `#${t.replace(/^#/, '')}`).join(' ');
    setCaption(tags ? `${cap} ${tags}` : cap);
    setCaptionLoading(false);
  };

  /* ── 草稿 / 作品 ─────────────────────────────────────────────────────── */
  const collectSpec = () => ({
    mode, platform, ratio, duration, lang,
    selected, script, scriptType, voice,
    bgm, bgmVol, cover, coverTitles, account, caption,
  });

  const applySpec = (s: Record<string, unknown>) => {
    if (s.mode) setMode(s.mode as typeof mode);
    if (s.platform) setPlatform(s.platform as string);
    if (s.ratio) setRatio(s.ratio as string);
    if (typeof s.duration === 'number') setDuration(s.duration);
    if (s.lang) setLang(s.lang as string);
    if (Array.isArray(s.selected)) setSelected(s.selected as string[]);
    if (typeof s.script === 'string') setScript(s.script);
    if (s.scriptType) setScriptType(s.scriptType as typeof scriptType);
    if (s.voice) setVoice(s.voice as string);
    if (s.bgm) setBgm(s.bgm as string);
    if (typeof s.bgmVol === 'number') setBgmVol(s.bgmVol);
    if (s.cover) setCover(s.cover as string);
    if (Array.isArray(s.coverTitles)) setCoverTitles(s.coverTitles as string[]);
    if (s.account !== undefined) setAccount(s.account as string | null);
    if (typeof s.caption === 'string') setCaption(s.caption);
  };

  const saveProject = async (status: 'draft' | 'published' = 'draft') => {
    setSavingProj(true);
    const { project } = await studioApi.saveProject({
      id: projectId ?? undefined,
      title: projectTitle.trim() || '未命名草稿',
      status,
      spec: collectSpec(),
      thumbSeed: cover,
    });
    if (project?.id) setProjectId(project.id);
    setSavingProj(false);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1800);
  };

  const openProjects = async () => {
    setShowProjects(true);
    setProjects(await studioApi.listProjects());
  };

  const loadProject = (p: StudioProject) => {
    applySpec(p.spec);
    setProjectId(p.id);
    setProjectTitle(p.title);
    autoGen.current = true; // 载入已有脚本，别再自动覆盖
    setStepIdx(0);
    setShowProjects(false);
    setPublished(false);
  };

  const removeProject = async (id: string) => {
    await studioApi.deleteProject(id);
    setProjects(await studioApi.listProjects());
    if (projectId === id) setProjectId(null);
  };

  const newProject = () => {
    setProjectId(null);
    setProjectTitle('未命名草稿');
    setStepIdx(0);
    setPublished(false);
    autoGen.current = false;
  };

  /* ── 渲染各步骤操作区 ─────────────────────────────────────────────── */
  const renderStep = () => {
    switch (step) {
      /* ① 选模式 */
      case 'mode':
        return (
          <div className="max-w-3xl">
            <SectionTitle title="选择生成模式" desc="不同起点决定 AI 如何编排素材" />
            <div className="grid grid-cols-3 gap-3 mb-7">
              {MODES.map(m => {
                const on = mode === m.id;
                return (
                  <button key={m.id} onClick={() => setMode(m.id)}
                    className="card p-4 text-left transition-all"
                    style={on ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
                      style={{ background: on ? AMBER : 'var(--color-surface-2)', color: on ? '#fff' : 'var(--color-text-muted)' }}>
                      <m.icon size={17} />
                    </div>
                    <p className="text-sm font-bold text-text-primary mb-1">{m.title}</p>
                    <p className="text-xs text-text-muted leading-relaxed">{m.desc}</p>
                  </button>
                );
              })}
            </div>

            <SectionTitle title="全局参数" desc="贯穿后续所有步骤" />
            <div className="space-y-4">
              <Field label="目标平台">
                <div className="flex gap-2">
                  {PLATFORMS.map(p => (
                    <Pill key={p.id} active={platform === p.id}
                      onClick={() => { setPlatform(p.id); setRatio(p.ratio); }}>
                      {p.label} <span className="opacity-50 ml-1">{p.ratio}</span>
                    </Pill>
                  ))}
                </div>
              </Field>
              <Field label="画面比例">
                <div className="flex gap-2">
                  {RATIOS.map(r => <Pill key={r} active={ratio === r} onClick={() => setRatio(r)}>{r}</Pill>)}
                </div>
              </Field>
              <Field label={`成片时长 · ${duration}s`}>
                <input type="range" min={10} max={60} value={duration}
                  onChange={e => setDuration(+e.target.value)}
                  className="w-full max-w-md accent-[#d97706]" />
              </Field>
              <Field label="目标市场语言">
                <div className="flex gap-2">
                  {LANGS.map(l => <Pill key={l.code} active={lang === l.code} onClick={() => setLang(l.code)}>{l.label}</Pill>)}
                </div>
              </Field>
            </div>
          </div>
        );

      /* ② 选素材 —— 文件夹 + 网格 两栏 */
      case 'material':
        return (
          <div className="flex h-full -m-6">
            {/* 文件夹栏 */}
            <div className="w-48 flex-shrink-0 border-r border-border p-3 overflow-y-auto">
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-semibold text-text-secondary">文件夹</span>
                <Plus size={13} className="text-text-muted cursor-pointer hover:text-text-primary" />
              </div>
              {FOLDERS.map(f => (
                <button key={f.id} onClick={() => setActiveFolder(f.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                    activeFolder === f.id ? 'bg-amber-dim text-amber font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
                  <Folder size={13} className="flex-shrink-0" />
                  <span className="flex-1 text-left truncate">{f.name}</span>
                  <span className="text-[10px] text-text-muted">{f.count}</span>
                </button>
              ))}
            </div>

            {/* 素材网格 */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
                <div className="relative flex-1 max-w-xs">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="按名称搜索…"
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border bg-surface text-xs outline-none focus:border-accent" />
                </div>
                <button className="btn-ghost !px-3 !py-1.5 !text-xs flex items-center gap-1.5">
                  <Upload size={12} /> 上传
                </button>
                <button onClick={aiSelect} disabled={selecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
                  style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }}>
                  {selecting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI 智能选材
                </button>
                <span className="text-xs text-text-muted ml-auto">已选 {selected.length} · 共 {CLIPS.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {CLIPS.filter(c =>
                    (activeFolder === 'all' || c.folder === activeFolder) &&
                    (search === '' || c.name.includes(search))
                  ).map(c => {
                    const on = selected.includes(c.id);
                    const idx = selected.indexOf(c.id);
                    return (
                      <button key={c.id} onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                        className="card !rounded-xl overflow-hidden text-left relative group"
                        style={on ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}>
                        <div className="relative">
                          <Thumb seed={c.id} label={c.type === 'image' ? 'IMG' : `0:${String(c.duration).padStart(2, '0')}`} />
                          {on && (
                            <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                              style={{ background: AMBER }}>{idx + 1}</span>
                          )}
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-black/45 uppercase">
                            {c.type}
                          </span>
                        </div>
                        <div className="p-2">
                          <p className="text-[11px] font-medium text-text-primary truncate">{c.name}</p>
                          <p className="text-[10px] text-text-muted mt-0.5">{c.size}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );

      /* ③ 口播脚本 */
      case 'script':
        return (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title={scriptType === 'storyboard' ? '分镜脚本' : '口播脚本'} desc={`AI 基于素材主题与企业知识库生成 · ${LANGS.find(l => l.code === lang)?.label}`} noMargin />
              <div className="flex items-center gap-2">
                {/* 口播 / 分镜 双模式 */}
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {([
                    { type: 'voiceover' as const, icon: <FileText size={12} />, label: '口播' },
                    { type: 'storyboard' as const, icon: <List size={12} />, label: '分镜' },
                  ]).map(({ type, icon, label }) => (
                    <button key={type} onClick={() => switchScriptType(type)} disabled={scriptLoading}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-50 ${
                        scriptType === type ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                      {icon}<span>{label}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => regenScript()} disabled={scriptLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50">
                  {scriptLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 重新生成
                </button>
              </div>
            </div>

            <div className="relative mb-5">
              <textarea value={script} onChange={e => setScript(e.target.value)} rows={11}
                className="w-full p-4 rounded-xl border border-border bg-surface-2 text-sm text-text-secondary leading-relaxed font-mono outline-none focus:border-accent resize-none" />
              {scriptLoading && (
                <div className="absolute inset-0 rounded-xl bg-surface/70 backdrop-blur-sm flex items-center justify-center">
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    <Loader2 size={14} className="animate-spin" /> AI 正在改写脚本…
                  </span>
                </div>
              )}
            </div>

            <Field label="配音音色">
              <div className="grid grid-cols-2 gap-2 max-w-xl">
                {VOICES.map(v => (
                  <button key={v.id} onClick={() => setVoice(v.id)}
                    className="card !rounded-xl p-3 flex items-center gap-2.5 text-left"
                    style={voice === v.id ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: voice === v.id ? AMBER : 'var(--color-surface-2)', color: voice === v.id ? '#fff' : 'var(--color-text-muted)' }}>
                      {v.id === 'v4' ? <Upload size={14} /> : <Mic size={14} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text-primary truncate">{v.name}</p>
                      <p className="text-[10px] text-text-muted">{v.tag}</p>
                    </div>
                  </button>
                ))}
              </div>
            </Field>
          </div>
        );

      /* ④ 配乐 */
      case 'bgm':
        return (
          <div className="max-w-2xl">
            <SectionTitle title="背景配乐" desc="AI 已按视频情绪推荐，可手动更换" />
            <div className="space-y-2 mb-7">
              {BGMS.map(b => {
                const on = bgm === b.id;
                return (
                  <button key={b.id} onClick={() => setBgm(b.id)}
                    className="card !rounded-xl w-full p-3 flex items-center gap-3 text-left"
                    style={on ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: on ? AMBER : 'var(--color-surface-2)', color: on ? '#fff' : 'var(--color-text-muted)' }}>
                      {on ? <Volume2 size={15} /> : <Play size={15} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary truncate">{b.name}</p>
                        {b.recommended && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: AMBER, color: '#fff' }}>AI 推荐</span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">{b.mood}</p>
                    </div>
                    <span className="text-xs font-mono text-text-muted">{b.duration}</span>
                    {on && <Check size={16} style={{ color: AMBER }} />}
                  </button>
                );
              })}
            </div>
            <Field label={`音量平衡 · 背景乐 ${bgmVol}% / 口播 ${100 - bgmVol}%`}>
              <input type="range" min={0} max={70} value={bgmVol}
                onChange={e => setBgmVol(+e.target.value)} className="w-full max-w-md accent-[#d97706]" />
              <p className="text-[11px] text-text-muted mt-1.5">口播时自动压低背景乐（ducking）</p>
            </Field>
          </div>
        );

      /* ⑤ 封面 */
      case 'cover':
        return (
          <div className="max-w-3xl">
            <SectionTitle title="选择封面" desc="AI 提取高光帧并自动配标题，可点选切换" />
            <div className="grid grid-cols-3 gap-4">
              {COVERS.map((cv, i) => {
                const on = cover === cv.id;
                return (
                  <button key={cv.id} onClick={() => setCover(cv.id)}
                    className="card !rounded-2xl overflow-hidden text-left"
                    style={on ? { borderColor: AMBER, boxShadow: `0 0 0 2px ${AMBER}` } : undefined}>
                    <div className="relative aspect-[9/16]">
                      <Thumb seed={cv.id} ratio="aspect-[9/16]" />
                      <div className="absolute inset-0 flex items-end p-3"
                        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent 55%)' }}>
                        <p className="text-white text-sm font-black leading-tight font-display" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                          {coverTitles[i]}
                        </p>
                      </div>
                      {on && (
                        <span className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: AMBER }}>
                          <Check size={14} />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <button onClick={regenCovers} disabled={coverLoading}
              className="mt-4 flex items-center gap-1.5 text-xs font-semibold disabled:opacity-60" style={{ color: AMBER }}>
              {coverLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} 重新生成封面候选
            </button>
          </div>
        );

      /* ⑥ 成片预览 */
      case 'preview':
        return (
          <div className="flex items-start gap-8">
            {/* 播放器 */}
            <div className="flex-shrink-0">
              <div className="relative rounded-2xl overflow-hidden border border-border" style={{ width: 260 }}>
                <Thumb seed={cover} ratio="aspect-[9/16]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  {rendering ? (
                    <div className="text-center">
                      <Loader2 size={30} className="text-white animate-spin mx-auto mb-2" />
                      <p className="text-white text-xs font-medium">AI 合成中… {renderPct}%</p>
                      <div className="mx-auto mt-2 h-1 w-32 rounded-full bg-white/25 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${renderPct}%`, background: '#fff' }} />
                      </div>
                    </div>
                  ) : (
                    <button className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <Play size={22} className="text-text-primary ml-0.5" fill="currentColor" />
                    </button>
                  )}
                </div>
                {!rendering && (
                  <div className="absolute bottom-0 inset-x-0 px-3 py-2 flex items-center justify-between bg-black/40">
                    <span className="text-[10px] font-mono text-white">0:00 / 0:{totalDur}</span>
                    <span className="text-[10px] font-mono text-white">{ratio}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 时间轴 + 局部重渲染 */}
            <div className="flex-1 min-w-0">
              <SectionTitle title="成片预览" desc={rendering ? '正在合成口播、配乐与字幕…' : '可对单个环节微调后局部重渲染'} />
              <div className="space-y-2 mb-6">
                {[
                  { icon: Film,     label: '素材片段', val: `${selectedClips.length} 段 · ${totalDur}s` },
                  { icon: Mic,      label: '口播配音', val: VOICES.find(v => v.id === voice)?.name ?? '' },
                  { icon: Music,    label: '背景配乐', val: BGMS.find(b => b.id === bgm)?.name ?? '' },
                  { icon: ImageIcon,label: '封面',     val: curCoverTitle },
                ].map(row => (
                  <div key={row.label} className="card !rounded-xl p-3 flex items-center gap-3">
                    <row.icon size={15} className="text-text-muted flex-shrink-0" />
                    <span className="text-xs font-semibold text-text-secondary w-16 flex-shrink-0">{row.label}</span>
                    <span className="text-xs text-text-primary flex-1 truncate">{row.val}</span>
                    <button className="text-[11px] font-semibold px-2 py-1 rounded-md hover:bg-surface-2" style={{ color: AMBER }}>
                      调整
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={goPreview} disabled={rendering}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50">
                <RefreshCw size={12} className={rendering ? 'animate-spin' : ''} /> 重新合成成片
              </button>
            </div>
          </div>
        );

      /* ⑦ 导出 / 一键发布 */
      case 'publish':
        return (
          <div className="max-w-3xl">
            {published ? (
              <div className="card !rounded-2xl p-10 text-center max-w-md mx-auto">
                <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }}>
                  <Check size={28} />
                </div>
                <p className="text-base font-bold text-text-primary mb-1">已提交发布</p>
                <p className="text-sm text-text-muted">成片已推送至 {ACCOUNTS.find(a => a.id === account)?.platform} · {ACCOUNTS.find(a => a.id === account)?.handle}</p>
                <button onClick={() => setPublished(false)} className="btn-ghost mt-6 !py-2 !text-xs">再发一条</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5">
                {/* 导出 */}
                <div className="card !rounded-2xl p-5">
                  <Download size={18} className="text-text-secondary mb-3" />
                  <p className="text-sm font-bold text-text-primary mb-1">导出成片</p>
                  <p className="text-xs text-text-muted mb-4 leading-relaxed">下载到本地或保存至「我的作品」素材库</p>
                  <div className="space-y-2">
                    <button className="btn-primary w-full !py-2.5 flex items-center justify-center gap-2">
                      <Download size={14} /> 下载 MP4（{ratio} · {totalDur}s）
                    </button>
                    <button className="btn-ghost w-full !py-2.5 flex items-center justify-center gap-2">
                      <Plus size={14} /> 存入「我的作品」
                    </button>
                  </div>
                </div>

                {/* 一键发布 */}
                <div className="card !rounded-2xl p-5">
                  <Send size={18} style={{ color: AMBER }} className="mb-3" />
                  <p className="text-sm font-bold text-text-primary mb-1">一键发布</p>
                  <p className="text-xs text-text-muted mb-3 leading-relaxed">选择已绑定的社媒账号，支持多平台同步</p>

                  <div className="space-y-1.5 mb-3">
                    {ACCOUNTS.map(a => (
                      <button key={a.id} onClick={() => setAccount(a.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors"
                        style={account === a.id ? { borderColor: AMBER, background: 'var(--color-amber-dim)' } : { borderColor: 'var(--color-border)' }}>
                        <span className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ background: a.color }}>
                          {a.platform[0]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-text-primary leading-tight">{a.platform}</p>
                          <p className="text-[10px] text-text-muted truncate">{a.handle}</p>
                        </div>
                        {account === a.id && <Check size={14} style={{ color: AMBER }} />}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-text-secondary">文案与话题标签</span>
                    <button onClick={aiCaption} disabled={captionLoading}
                      className="flex items-center gap-1 text-[11px] font-semibold disabled:opacity-60" style={{ color: AMBER }}>
                      {captionLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} AI 生成
                    </button>
                  </div>
                  <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3}
                    placeholder="文案与话题标签…"
                    className="w-full p-2.5 rounded-lg border border-border bg-surface-2 text-xs text-text-secondary outline-none focus:border-accent resize-none mb-2" />

                  <div className="flex items-center gap-2 mb-3 text-[11px] text-text-muted">
                    <Clock size={12} /> 立即发布
                    <button className="ml-auto font-semibold hover:text-text-primary">定时…</button>
                  </div>

                  <button onClick={() => { setPublished(true); void saveProject('published'); }} disabled={!account}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: AMBER }}>
                    <Send size={14} /> 发布到 {ACCOUNTS.find(a => a.id === account)?.platform ?? '…'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* ── 顶部工作条：标题 + 保存草稿 + 我的作品 ─────────── */}
      <div className="h-11 flex items-center gap-3 px-4 border-b border-border flex-shrink-0">
        <FileText size={13} className="text-text-muted flex-shrink-0" />
        <input
          value={projectTitle}
          onChange={e => setProjectTitle(e.target.value)}
          placeholder="未命名草稿"
          className="text-sm font-semibold text-text-primary bg-transparent outline-none min-w-0 flex-1 max-w-xs placeholder:text-text-muted"
        />
        {projectId && <span className="text-[10px] text-text-muted">已保存</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={newProject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-secondary hover:bg-surface-2 transition-colors">
            <Plus size={13} /> 新建
          </button>
          <button onClick={() => void saveProject('draft')} disabled={savingProj}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50 transition-colors">
            {savingProj ? <Loader2 size={13} className="animate-spin" /> : savedTick ? <Check size={13} className="text-accent" /> : <Save size={13} />}
            {savedTick ? '已保存' : '保存草稿'}
          </button>
          <button onClick={() => void openProjects()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all active:scale-95"
            style={{ background: AMBER }}>
            <FolderOpen size={13} /> 我的作品
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
      {/* ── ① 步骤导航 ─────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-r border-border flex flex-col bg-surface-2/40">
        <div className="px-4 pt-4 pb-3">
          <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-1">AI 生成内容</p>
          <p className="text-sm font-bold text-text-primary font-display">混剪工作台</p>
        </div>
        <div className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {STEPS.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <button key={s.id} onClick={() => i <= stepIdx && setStepIdx(i)}
                disabled={i > stepIdx}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                  active ? 'bg-surface shadow-sm' : i > stepIdx ? 'opacity-40 cursor-not-allowed' : 'hover:bg-surface'}`}>
                <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                  style={
                    active ? { background: AMBER, color: '#fff' }
                    : done ? { background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }
                    : { background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }
                  }>
                  {done ? <Check size={13} /> : i + 1}
                </span>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold leading-tight ${active ? 'text-text-primary' : 'text-text-secondary'}`}>{s.label}</p>
                  <p className="text-[10px] text-text-muted truncate mt-0.5">{s.hint}</p>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── ② 操作区 ───────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }} className="h-full">
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 底部导航条 */}
        <div className="h-14 flex items-center justify-between px-6 border-t border-border flex-shrink-0">
          <button onClick={prev} disabled={stepIdx === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <ChevronLeft size={15} /> 上一步
          </button>
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span key={i} className="h-1 rounded-full transition-all"
                style={{ width: i === stepIdx ? 18 : 6, background: i <= stepIdx ? AMBER : 'var(--color-border)' }} />
            ))}
          </div>
          {!isLast ? (
            <button onClick={next} disabled={!canNext}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40"
              style={{ background: AMBER }}>
              下一步 <ChevronRight size={15} />
            </button>
          ) : (
            <span className="w-[88px]" />
          )}
        </div>
      </div>

      {/* ── ③ 实时预览 / 制作摘要 ───────────────────── */}
      <aside className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-surface-2/40">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Smartphone size={13} className="text-text-muted" />
          <span className="text-xs font-semibold text-text-secondary">实时预览</span>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {/* 手机框预览 */}
          <div className="mx-auto rounded-2xl overflow-hidden border-2 border-border-bright shadow-sm" style={{ width: 150 }}>
            <div className="relative aspect-[9/16]">
              <Thumb seed={cover} ratio="aspect-[9/16]" />
              <div className="absolute inset-0 flex items-end p-2.5"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent 55%)' }}>
                <p className="text-white text-[11px] font-black leading-tight font-display">
                  {curCoverTitle}
                </p>
              </div>
              <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold text-white bg-black/45">
                {ratio}
              </span>
            </div>
          </div>

          {/* 制作摘要 */}
          <div className="mt-5 space-y-2.5">
            <SummaryRow icon={LayoutGrid} label="模式" value={MODES.find(m => m.id === mode)?.title ?? ''} />
            <SummaryRow icon={Globe} label="平台" value={`${PLATFORMS.find(p => p.id === platform)?.label} · ${ratio}`} />
            <SummaryRow icon={Clock} label="时长" value={`${totalDur || duration}s`} />
            <SummaryRow icon={Film} label="素材" value={`${selected.length} 段`} />
            <SummaryRow icon={Mic} label="配音" value={VOICES.find(v => v.id === voice)?.name.split('（')[0] ?? ''} />
            <SummaryRow icon={Music} label="配乐" value={BGMS.find(b => b.id === bgm)?.name ?? ''} />
            <SummaryRow icon={Globe} label="语言" value={LANGS.find(l => l.code === lang)?.label ?? ''} />
          </div>

          {rendered && (
            <div className="mt-4 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg"
              style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }}>
              <Check size={12} /> 成片已就绪，可导出或发布
            </div>
          )}
        </div>
      </aside>
      </div>

      {/* ── 我的作品 / 草稿 列表浮层 ─────────────────────── */}
      <AnimatePresence>
        {showProjects && (
          <ProjectsOverlay
            projects={projects}
            currentId={projectId}
            onClose={() => setShowProjects(false)}
            onLoad={loadProject}
            onDelete={removeProject}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 我的作品 / 草稿 浮层 ─────────────────────────────────────────────── */
function ProjectsOverlay({ projects, currentId, onClose, onLoad, onDelete }: {
  projects: StudioProject[];
  currentId: string | null;
  onClose: () => void;
  onLoad: (p: StudioProject) => void;
  onDelete: (id: string) => void;
}) {
  const drafts = projects.filter(p => p.status === 'draft');
  const works = projects.filter(p => p.status === 'published');

  const Section = ({ title, items }: { title: string; items: StudioProject[] }) => (
    <div className="mb-5">
      <p className="text-xs font-semibold text-text-secondary mb-2">{title} · {items.length}</p>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted py-3 text-center">暂无</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {items.map(p => (
            <div key={p.id}
              className="card !rounded-xl overflow-hidden group cursor-pointer relative"
              style={p.id === currentId ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}
              onClick={() => onLoad(p)}>
              <Thumb seed={p.thumbSeed ?? 'cv1'} ratio="aspect-video" />
              <div className="p-2.5">
                <p className="text-xs font-semibold text-text-primary truncate">{p.title}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{new Date(p.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDelete(p.id); }}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}>
      <motion.div
        initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="w-[560px] max-h-[80%] flex flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen size={15} style={{ color: AMBER }} />
            <span className="text-sm font-bold text-text-primary">我的作品</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {projects.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
              <p className="text-sm text-text-muted">还没有保存任何草稿或作品</p>
              <p className="text-xs text-text-muted mt-1">在工作台点「保存草稿」即可留存</p>
            </div>
          ) : (
            <>
              <Section title="我的草稿" items={drafts} />
              <Section title="已发布作品" items={works} />
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── 小组件 ───────────────────────────────────────────────────────────── */

function SectionTitle({ title, desc, noMargin }: { title: string; desc?: string; noMargin?: boolean }) {
  return (
    <div className={noMargin ? '' : 'mb-4'}>
      <h3 className="text-base font-bold text-text-primary font-display">{title}</h3>
      {desc && <p className="text-xs text-text-muted mt-0.5">{desc}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-secondary mb-2">{label}</p>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border"
      style={active
        ? { background: AMBER, color: '#fff', borderColor: AMBER }
        : { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>
      {children}
    </button>
  );
}

function SummaryRow({ icon: Icon, label, value }: { icon: typeof LayoutGrid; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={13} className="text-text-muted flex-shrink-0" />
      <span className="text-[11px] text-text-muted w-8 flex-shrink-0">{label}</span>
      <span className="text-[11px] font-medium text-text-primary flex-1 truncate text-right">{value}</span>
    </div>
  );
}
