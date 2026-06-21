import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Play, Sparkles, FileText, Layout as LayoutIcon,
  TrendingUp, Clock, Globe, ChevronDown, X, Loader2,
  Check, Copy, ArrowRight, Zap, LayoutGrid, List, ArrowUp
} from 'lucide-react';

type Platform = 'all' | 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'pinterest';
type ScriptType = 'voiceover' | 'storyboard';

interface TrendVideo {
  id: string;
  platform: Exclude<Platform, 'all'>;
  title: string;
  thumbnail: string;
  duration: number;
  tags: string[];
  views: string;
  trend: 'hot' | 'rising' | 'stable';
}

const PLATFORM_META: Record<Exclude<Platform, 'all'>, { label: string; color: string; bg: string }> = {
  tiktok:    { label: 'TikTok',    color: '#fff', bg: '#010101' },
  instagram: { label: 'Instagram', color: '#fff', bg: '#c13584' },
  youtube:   { label: 'YouTube',   color: '#fff', bg: '#ff0000' },
  facebook:  { label: 'Facebook',  color: '#fff', bg: '#1877f2' },
  pinterest: { label: 'Pinterest', color: '#fff', bg: '#e60023' },
};

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
];

const MOCK_VIDEOS: TrendVideo[] = [
  { id: '1',  platform: 'tiktok',    title: 'How I packed 2 weeks into a carry-on — minimalist travel hack',  thumbnail: '', duration: 47,  tags: ['travel', 'lifestyle', 'hack'],          views: '2.4M', trend: 'hot' },
  { id: '2',  platform: 'instagram', title: 'Morning skincare routine under $30 total',                        thumbnail: '', duration: 60,  tags: ['skincare', 'beauty', 'budget'],         views: '890K', trend: 'hot' },
  { id: '3',  platform: 'youtube',   title: "Testing viral Amazon kitchen gadgets so you don't have to",       thumbnail: '', duration: 183, tags: ['amazon', 'kitchen', 'review'],          views: '1.1M', trend: 'rising' },
  { id: '4',  platform: 'tiktok',    title: 'This $12 organizer changed my entire desk setup',                 thumbnail: '', duration: 32,  tags: ['organization', 'workspace', 'productivity'], views: '3.7M', trend: 'hot' },
  { id: '5',  platform: 'facebook',  title: 'Why everyone in my family is obsessed with this air fryer',       thumbnail: '', duration: 94,  tags: ['kitchen', 'food', 'review'],            views: '540K', trend: 'stable' },
  { id: '6',  platform: 'instagram', title: 'Aesthetic cable management — hide the mess',                      thumbnail: '', duration: 45,  tags: ['tech', 'setup', 'aesthetic'],           views: '720K', trend: 'rising' },
  { id: '7',  platform: 'pinterest', title: 'DIY wedding decoration inspo — under $200 total',                 thumbnail: '', duration: 78,  tags: ['wedding', 'diy', 'decor'],              views: '310K', trend: 'stable' },
  { id: '8',  platform: 'youtube',   title: 'I used only aliexpress products for 30 days',                     thumbnail: '', duration: 241, tags: ['aliexpress', 'challenge', 'review'],    views: '4.2M', trend: 'hot' },
  { id: '9',  platform: 'tiktok',    title: 'Portable charger that saved my road trip',                        thumbnail: '', duration: 28,  tags: ['tech', 'travel', 'charging'],           views: '1.8M', trend: 'rising' },
  { id: '10', platform: 'instagram', title: 'Unboxing: $40 diffuser vs $200 diffuser',                         thumbnail: '', duration: 55,  tags: ['home', 'wellness', 'comparison'],       views: '450K', trend: 'stable' },
];

const PLATFORM_FILTERS: { id: Platform; label: string }[] = [
  { id: 'all',       label: '全部平台' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'facebook',  label: 'Facebook' },
  { id: 'pinterest', label: 'Pinterest' },
];

function VideoThumbnail({ platform, title }: { platform: Exclude<Platform, 'all'>; title: string }) {
  const meta = PLATFORM_META[platform];
  const initials = title.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className="w-full h-full flex items-end justify-start relative overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${meta.bg}22, ${meta.bg}44)` }}>
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: `repeating-linear-gradient(45deg, ${meta.bg} 0, ${meta.bg} 1px, transparent 0, transparent 50%)`, backgroundSize: '12px 12px' }} />
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl font-black font-display opacity-20 text-white select-none">{initials}</span>
    </div>
  );
}

interface ScriptPanelProps {
  video: TrendVideo;
  onClose: () => void;
}

function ScriptPanel({ video, onClose }: ScriptPanelProps) {
  const [scriptType, setScriptType] = useState<ScriptType>('voiceover');
  const [language, setLanguage] = useState('en');
  const [productInfo, setProductInfo] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    await new Promise(r => setTimeout(r, 1800));
    setResult(scriptType === 'voiceover'
      ? `**[Hook]**\nHave you ever wondered why everyone's obsessed with this? Let me show you exactly why.\n\n**[Body]**\nThis ${video.tags[0]} product completely changed how I ${video.tags[1] ?? 'approach my daily routine'}. Within just one week, I noticed a dramatic difference — and I'm not the only one. Over ${video.views} people have already discovered this.\n\n**[CTA]**\nLink in bio to grab yours before they sell out again. Trust me, you'll thank me later.`
      : `**Scene 1** (0-3s)\n景别: 特写 | 运镜: 固定\n画面: 产品正面特写，光线打亮\n配音: "等等，这个你一定要看..."\n\n**Scene 2** (3-8s)\n景别: 中景 | 运镜: 推镜头\n画面: 使用前后对比\n配音: "我用了一周之后..."\n\n**Scene 3** (8-15s)\n景别: 近景 | 运镜: 横摇\n画面: 关键功能演示\n配音: "这个功能真的太绝了"\n\n**Scene 4** (15-20s)\n景别: 全景 | 运镜: 固定\n画面: 产品使用场景\n配音: "链接在简介，抢完就没了"`
    );
    setGenerating(false);
  };

  const handleCopy = () => {
    if (result) {
      void navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const selectedLang = LANGUAGES.find(l => l.code === language);

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 h-full w-[420px] flex flex-col border-l border-border z-50 bg-surface"
      style={{ right: '272px' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3.5 border-b border-border flex-shrink-0">
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-1">脚本生成</p>
          <h3 className="text-sm font-semibold text-text-primary leading-snug line-clamp-2">{video.title}</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors flex-shrink-0">
          <X size={15} />
        </button>
      </div>

      {/* Settings: script type + language */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0 flex items-center gap-2">
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
          {([
            { type: 'voiceover' as ScriptType, icon: <FileText size={12} />, label: '口播' },
            { type: 'storyboard' as ScriptType, icon: <LayoutIcon size={12} />, label: '分镜' },
          ] as const).map(({ type, icon, label }) => (
            <button
              key={type}
              onClick={() => setScriptType(type)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                scriptType === type ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {icon}<span>{label}</span>
            </button>
          ))}
        </div>

        <div className="relative flex-1">
          <button
            onClick={() => setShowLangDropdown(v => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-text-secondary hover:border-border-bright transition-colors"
          >
            <Globe size={11} className="text-text-muted flex-shrink-0" />
            <span className="flex-1 text-left">{selectedLang?.label}</span>
            <ChevronDown size={11} className={`text-text-muted transition-transform ${showLangDropdown ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showLangDropdown && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border bg-surface z-10 overflow-hidden shadow-lg"
              >
                <div className="p-1 max-h-44 overflow-y-auto">
                  {LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => { setLanguage(lang.code); setShowLangDropdown(false); }}
                      className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs hover:bg-surface-2 transition-colors"
                    >
                      <span className={language === lang.code ? 'text-accent font-semibold' : 'text-text-primary'}>{lang.label}</span>
                      {language === lang.code && <Check size={11} className="text-accent" />}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!result && !generating && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2.5">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-2 border border-border">
              <Sparkles size={18} className="text-text-muted" />
            </div>
            <p className="text-xs text-text-muted">输入产品信息，点击发送生成专属脚本</p>
          </div>
        )}

        {generating && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-accent">
              <Loader2 size={12} className="text-white animate-spin" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)' }}>
              <Sparkles size={12} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-4 py-3">
                <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line font-mono">{result}</p>
              </div>
              <div className="flex items-center gap-4 mt-1.5 px-1">
                <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                  {copied
                    ? <><Check size={11} className="text-green" /><span className="text-green">已复制</span></>
                    : <><Copy size={11} /><span>复制</span></>
                  }
                </button>
                <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                  <ArrowRight size={11} /><span>保存到脚本库</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Chat input */}
      <div className="p-4 border-t border-border flex-shrink-0">
        <div className="rounded-2xl border border-border bg-surface-2 overflow-hidden transition-colors focus-within:border-border-bright">
          <textarea
            value={productInfo}
            onChange={e => setProductInfo(e.target.value)}
            placeholder="描述你的产品：名称、核心功能、目标人群、价格区间..."
            rows={3}
            className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none"
          />
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            <p className="text-[11px] text-text-muted">
              {scriptType === 'voiceover' ? '口播脚本' : '分镜脚本'} · {selectedLang?.label}
            </p>
            <button
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--color-accent)', boxShadow: '0 2px 8px rgba(22,163,74,0.2)' }}
            >
              {generating
                ? <Loader2 size={13} className="text-white animate-spin" />
                : <ArrowUp size={13} className="text-white" />
              }
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function VideoListItem({ video, isSelected, onSelect }: { video: TrendVideo; isSelected: boolean; onSelect: () => void }) {
  const meta = PLATFORM_META[video.platform];
  const trendColor = video.trend === 'hot' ? 'text-amber' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const trendLabel = video.trend === 'hot' ? '热门' : video.trend === 'rising' ? '上升' : '平稳';

  return (
    <div
      className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-all group ${
        isSelected ? 'bg-accent-glow' : 'hover:bg-surface-2'
      }`}
      onClick={onSelect}
    >
      <div className="w-16 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-border">
        <VideoThumbnail platform={video.platform} title={video.title} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="platform-badge text-[9px]" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          <span className={`text-[10px] font-semibold ${trendColor}`}>{trendLabel}</span>
        </div>
        <p className="text-sm text-text-primary font-medium truncate">{video.title}</p>
      </div>
      <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
        {video.tags.slice(0, 2).map(tag => (
          <span key={tag} className="tag text-[10px]">#{tag}</span>
        ))}
      </div>
      <div className="flex-shrink-0 text-right min-w-[52px]">
        <p className="text-xs font-mono text-text-secondary">{Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}</p>
        <p className="text-[10px] text-text-muted">{video.views}</p>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onSelect(); }}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all opacity-0 group-hover:opacity-100"
        style={{ color: 'var(--color-accent)', borderColor: 'rgba(22,163,74,0.25)', background: 'var(--color-accent-glow)' }}
      >
        <Sparkles size={11} />
        <span>生成脚本</span>
      </button>
    </div>
  );
}

export default function InspirationDashboard() {
  const [platform, setPlatform] = useState<Platform>('all');
  const [search, setSearch] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const filtered = MOCK_VIDEOS.filter(v =>
    (platform === 'all' || v.platform === platform) &&
    (search === '' || v.title.toLowerCase().includes(search.toLowerCase()) || v.tags.some(t => t.includes(search.toLowerCase())))
  );

  return (
    <div className="relative">
      <div className={`transition-all duration-300 ${selectedVideo ? 'mr-[420px]' : ''}`}>
        {/* Page header */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary font-display">灵感大屏</h2>
              <p className="text-sm text-text-muted mt-0.5">追踪全球社媒爆款，一键生成口播 / 分镜脚本</p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted">
              <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
              <span>今日已推送 10 条</span>
            </div>
          </div>

          {/* Search + filters + view toggle */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="relative min-w-48 max-w-64">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索视频标题或标签..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap flex-1">
              {PLATFORM_FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setPlatform(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    platform === f.id
                      ? 'bg-accent text-white shadow-[0_2px_8px_rgba(22,163,74,0.25)]'
                      : 'bg-surface border border-border text-text-secondary hover:border-border-bright hover:text-text-primary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {/* View toggle */}
            <div className="flex items-center gap-0.5 p-1 rounded-lg bg-surface-2 border border-border flex-shrink-0">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <LayoutGrid size={13} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <List size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="px-6 mb-4 grid grid-cols-3 gap-3 max-w-xl">
          {[
            { icon: <Zap size={13} />,       label: '热门视频', value: `${MOCK_VIDEOS.filter(v => v.trend === 'hot').length}`,    color: 'text-amber' },
            { icon: <TrendingUp size={13} />, label: '上升趋势', value: `${MOCK_VIDEOS.filter(v => v.trend === 'rising').length}`, color: 'text-green' },
            { icon: <Globe size={13} />,      label: '覆盖平台', value: '5',                                                       color: 'text-accent' },
          ].map(stat => (
            <div key={stat.label} className="card p-3 flex items-center gap-2.5">
              <span className={stat.color}>{stat.icon}</span>
              <div>
                <p className="text-base font-bold text-text-primary font-display leading-none">{stat.value}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((video, i) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  index={i}
                  isSelected={selectedVideo?.id === video.id}
                  onSelect={() => setSelectedVideo(selectedVideo?.id === video.id ? null : video)}
                />
              ))}
            </div>
          ) : (
            <div className="card overflow-hidden divide-y divide-border">
              {filtered.map(video => (
                <VideoListItem
                  key={video.id}
                  video={video}
                  isSelected={selectedVideo?.id === video.id}
                  onSelect={() => setSelectedVideo(selectedVideo?.id === video.id ? null : video)}
                />
              ))}
            </div>
          )}
          {filtered.length === 0 && (
            <div className="text-center py-20">
              <Search size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
              <p className="text-text-muted text-sm">没有找到相关视频</p>
            </div>
          )}
        </div>
      </div>

      {/* Script panel */}
      <AnimatePresence>
        {selectedVideo && (
          <ScriptPanel video={selectedVideo} onClose={() => setSelectedVideo(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

interface VideoCardProps {
  video: TrendVideo;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}

function VideoCard({ video, index, isSelected, onSelect }: VideoCardProps) {
  const meta = PLATFORM_META[video.platform];
  const trendColor = video.trend === 'hot' ? 'text-amber' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const trendLabel = video.trend === 'hot' ? '🔥 热门' : video.trend === 'rising' ? '↑ 上升' : '— 平稳';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className={`card overflow-hidden cursor-pointer group ${isSelected ? 'border-accent ring-1 ring-accent/20' : ''}`}
      onClick={onSelect}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
        <VideoThumbnail platform={video.platform} title={video.title} />

        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <button
            onClick={e => { e.stopPropagation(); onSelect(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{ background: meta.bg, color: meta.color }}
          >
            <Play size={11} fill="currentColor" />
            <span>生成脚本</span>
          </button>
        </div>

        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-white bg-black/50 backdrop-blur-sm">
          {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
        </div>
        <div className="absolute top-2 left-2">
          <span className="platform-badge text-[10px]" style={{ background: meta.bg, color: meta.color }}>
            {meta.label}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-xs font-semibold text-text-primary leading-snug line-clamp-2 mb-2">{video.title}</p>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-mono font-bold ${trendColor}`}>{trendLabel}</span>
          <span className="flex items-center gap-1 text-[10px] text-text-muted">
            <Clock size={9} />{video.views} views
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {video.tags.slice(0, 2).map(tag => (
            <span key={tag} className="tag text-[10px]">#{tag}</span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
