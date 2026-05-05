import { useState, useEffect } from 'react';
import { Loader2, Sparkles, FileText, Bookmark, Copy, CheckCircle2, Layout, Zap, ChevronRight, Check, RefreshCw as RefreshIcon, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import VideoUploader from './VideoUploader';
import { geminiService } from '../services/gemini';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { pb } from '../lib/pb';
import { buildAssetCreateBody } from '../lib/recordMappers';
import { AssetType } from '../types';

interface Highlights {
  theme: string[];
  plot: string[];
  mood: string[];
  hook: string[];
}

interface CreativeTheme {
  title: string;
  description: string;
}

export default function InspirationExtraction() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [video, setVideo] = useState<{ base64: string; mimeType: string } | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Step 1 data
  const [highlights, setHighlights] = useState<Highlights | null>(null);
  const [selectedHighlights, setSelectedHighlights] = useState<string[]>([]);
  const [popularTags, setPopularTags] = useState<string[]>([]);

  // Step 2 data
  const SELLING_POINTS = [
    '种花送时装',
    '种花送家装',
    '种花领限定花种',
    '种花送真花',
    '种花解锁多种玩法'
  ];

  const STYLES = [
    '真人3D写实风格',
    '华丽建模动画画风',
    'Q版动漫人物画风',
    '赛博奇幻画风'
  ];

  const MOODS = [
    '温情',
    '治愈',
    '热血',
    '悲伤',
    '惊喜',
    '戏剧性',
    '反转打脸'
  ];

  const [sellingPoint, setSellingPoint] = useState<string>('');
  const [themes, setThemes] = useState<CreativeTheme[]>([]);
  const [selectedThemeIndex, setSelectedThemeIndex] = useState<number | null>(null);

  // Step 3 data
  const [selectedStyle, setSelectedStyle] = useState<string>('');
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [scriptsCache, setScriptsCache] = useState<{[key: number]: string}>({});
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{[key: string]: boolean}>({});

  useEffect(() => {
    void fetchPopularTags();
  }, []);

  const fetchPopularTags = async () => {
    try {
      const records = await pb.collection('market').getFullList({ sort: '-likes' });
      const tagMap: { [key: string]: number } = {};

      records.forEach((item) => {
        const tags = (item.tags as string[] | undefined) || [];
        tags.forEach((tag) => {
          const label = tag.includes(':') ? tag.split(':')[1] : tag;
          tagMap[label] = (tagMap[label] || 0) + Number(item.likes ?? 0);
        });
      });

      const sortedTags = Object.entries(tagMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag]) => tag);

      setPopularTags(sortedTags);
    } catch (error) {
      console.error('Error fetching popular tags:', error);
    }
  };

  const handleExtractHighlights = async () => {
    if (!video) return;
    setLoading(true);
    try {
      const data = await geminiService.extractHighlights(video.base64, video.mimeType);
      if (data) {
        setHighlights(data);
        setStep(2);
      }
    } catch (error) {
      console.error(error);
      alert("提取失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateThemes = async () => {
    if (selectedHighlights.length === 0 || !sellingPoint) {
      alert("请选择至少一个灵感点和卖点");
      return;
    }
    setLoading(true);
    try {
      const data = await geminiService.generateThemes(selectedHighlights, sellingPoint);
      setThemes(data);
      // Auto select first theme
      if (data.length > 0) {
        setSelectedThemeIndex(0);
        setStep(3); // Go to split view
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTheme = async (index: number) => {
    setSelectedThemeIndex(index);
    if (!scriptsCache[index]) {
      await handleGenerateFinalScriptForTheme(index);
    }
  };

  const handleGenerateFinalScriptForTheme = async (index: number) => {
    const theme = themes[index];
    if (!theme) return;
    
    setLoading(true);
    try {
      const script = await geminiService.generateFinalScript(
        theme.title,
        theme.description,
        selectedStyle || '真人3D写实风格',
        selectedMoods.length > 0 ? selectedMoods.join('、') : '治愈、惊喜'
      );
      setScriptsCache(prev => ({ ...prev, [index]: script }));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAsset = async (type: AssetType, content: string, title: string) => {
    if (!user) return alert('请先登录以收藏资产');

    try {
      await pb.collection('assets').create(
        buildAssetCreateBody({
          userId: user.uid,
          type,
          title,
          content,
          tags: [sellingPoint, selectedStyle, ...selectedMoods, ...selectedHighlights].filter(Boolean),
          likes: 0,
          likedBy: [],
        })
      );

      const labelMap: Record<string, string> = {
        prompt: '提示词',
        full_script: '整篇脚本',
        storyboard: '分镜脚本',
        inspiration: '灵感卡片',
        visual_detail: '画面与口令',
      };

      showToast(`已收藏至资产卡片：${labelMap[type] || type}`, 'success');
      setSaveStatus((prev) => ({ ...prev, [type + title]: true }));
      setTimeout(() => setSaveStatus((prev) => ({ ...prev, [type + title]: false })), 2000);
    } catch (e) {
      console.error(e);
      showToast('保存失败，请检查 PocketBase 与 assets 集合', 'error');
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-primary-blue mb-2">灵感提取 <span className="text-accent-blue text-lg ml-2 font-medium opacity-50">/ Workflow</span></h1>
          <p className="text-slate-500">深度解析素材，重构为具备爆款潜质的新脚本。</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <StepBadge num={1} active={step >= 1} label="素材分析" />
          <ChevronRight className="w-4 h-4 text-slate-300" />
          <StepBadge num={2} active={step >= 2} label="方案生成" />
          <ChevronRight className="w-4 h-4 text-slate-300" />
          <StepBadge num={3} active={step >= 3} label="最终脚本" />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="glass-card p-10 bg-white border-slate-200 shadow-sm"
          >
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 bg-accent-blue/5 rounded-3xl flex items-center justify-center mb-6">
                <Layout className="w-10 h-10 text-accent-blue" />
              </div>
              <h2 className="text-2xl font-black text-primary-blue mb-2">第一步：素材分析</h2>
              <p className="text-slate-500 mb-10 text-center max-w-md">上传你认为优秀的视频片段，AI 将为你提取核心亮点。</p>
              
              <div className="w-full max-w-2xl bg-slate-50 rounded-[2.5rem] p-8 border border-slate-200 shadow-inner">
                <VideoUploader onUpload={(base64, mimeType) => setVideo({ base64, mimeType })} />
              </div>

              <button
                onClick={handleExtractHighlights}
                disabled={!video || loading}
                className="mt-12 bg-primary-blue text-white w-full max-w-md py-6 rounded-2xl font-bold flex items-center justify-center text-lg shadow-xl shadow-slate-200 hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin mr-2" /> : <Sparkles className="w-6 h-6 mr-2" />}
                {loading ? '正在分析亮点...' : '提取核心灵感'}
              </button>
            </div>
          </motion.div>
        )}

        {step === 2 && highlights && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="glass-card p-8 bg-white border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-black text-primary-blue flex items-center gap-3">
                    <Zap className="w-6 h-6 text-accent-blue" /> 1. 灵感点勾选
                  </h3>
                  <button
                    onClick={handleExtractHighlights}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-accent-blue rounded-xl text-xs font-bold transition-all border border-slate-200 cursor-pointer"
                  >
                    <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    重新分析亮点
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <HighlightGroup 
                    title="核心主题 (Theme)" 
                    items={highlights.theme} 
                    selected={selectedHighlights} 
                    onToggle={(item) => setSelectedHighlights(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])} 
                  />
                  <HighlightGroup 
                    title="情节亮点 (Plot)" 
                    items={highlights.plot} 
                    selected={selectedHighlights} 
                    onToggle={(item) => setSelectedHighlights(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])} 
                  />
                  <HighlightGroup 
                    title="氛围基调 (Mood)" 
                    items={highlights.mood} 
                    selected={selectedHighlights} 
                    onToggle={(item) => setSelectedHighlights(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])} 
                  />
                  <HighlightGroup 
                    title="吸睛钩子 (Hook)" 
                    items={highlights.hook} 
                    selected={selectedHighlights} 
                    onToggle={(item) => setSelectedHighlights(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])} 
                  />
                </div>

                {popularTags.length > 0 && (
                  <div className="mt-8 pt-8 border-t border-slate-100">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-accent-blue" /> 
                      热门市场标签
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {popularTags.map((tag, i) => (
                        <button
                          key={`${tag}-${i}`}
                          onClick={() => setSelectedHighlights(prev => prev.includes(tag) ? prev.filter(i => i !== tag) : [...prev, tag])}
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all cursor-pointer ${selectedHighlights.includes(tag) ? 'bg-blue-50 border-accent-blue text-accent-blue' : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-primary-blue hover:bg-white'}`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="glass-card p-8 bg-blue-50/30 border-blue-100 shadow-sm">
                <h3 className="text-xl font-black text-primary-blue mb-6 flex items-center gap-3">
                  <Sparkles className="w-6 h-6 text-accent-blue" /> 2. 核心卖点注魂
                </h3>
                <div className="flex flex-wrap gap-3 mb-8">
                  {SELLING_POINTS.map((sp, idx) => (
                    <button
                      key={`sp-${idx}-${sp}`}
                      onClick={() => setSellingPoint(sp)}
                      className={`px-6 py-3 rounded-2xl text-sm font-bold transition-all border cursor-pointer ${sellingPoint === sp ? 'bg-primary-blue text-white border-primary-blue' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                    >
                      {sp}
                    </button>
                  ))}
                </div>
                
                <button
                  onClick={handleGenerateThemes}
                  disabled={loading || selectedHighlights.length === 0 || !sellingPoint}
                  className="bg-accent-blue text-white px-8 py-5 rounded-2xl font-bold w-full flex items-center justify-center gap-2 shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                  {loading ? '正在构思精彩方案...' : '一键生成创意方案'}
                </button>
              </div>
            </div>
            
            <div className="flex justify-center mt-8">
              <button onClick={() => setStep(1)} className="text-slate-400 hover:text-primary-blue transition-all flex items-center gap-2 font-bold px-4 py-2 cursor-pointer">
                <ChevronRight className="w-4 h-4 rotate-180" /> 返回重新分析素材
              </button>
            </div>
          </motion.div>
        )}

        {step === 3 && themes.length > 0 && selectedThemeIndex !== null && (
          <motion.div
            key="step3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
          >
            {/* Left Column: Solution Ideas */}
            <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-8 max-h-[85vh] overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-black text-primary-blue flex items-center gap-2">
                  <Layout className="w-5 h-5 text-accent-blue" /> 方案 Ideas
                </h3>
                <button 
                  onClick={() => setStep(2)}
                  className="text-[10px] font-bold text-slate-400 uppercase hover:text-primary-blue transition-all cursor-pointer"
                >
                  重调灵感
                </button>
              </div>
              
              <div className="space-y-4">
                {themes.map((t, i) => (
                  <button
                    key={`theme-${i}-${t.title}`}
                    onClick={() => handleSelectTheme(i)}
                    className={`w-full text-left p-6 rounded-[2rem] border transition-all relative group cursor-pointer ${selectedThemeIndex === i ? 'bg-blue-50/50 border-accent-blue ring-4 ring-blue-50/20 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-black text-accent-blue uppercase tracking-widest">方案 0{i+1}</div>
                      {scriptsCache[i] && <CheckCircle2 className="w-4 h-4 text-accent-blue" />}
                    </div>
                    <div className="text-lg font-black text-primary-blue mb-2 leading-tight group-hover:text-accent-blue transition-colors">{t.title}</div>
                    <div className="text-xs text-slate-500 leading-relaxed line-clamp-3">{t.description}</div>
                    
                    {selectedThemeIndex === i && (
                      <motion.div 
                        layoutId="active-indicator"
                        className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-12 bg-accent-blue rounded-full shadow-[0_0_15px_rgba(37,99,235,0.2)]"
                      />
                    )}
                  </button>
                ))}
              </div>

              <div className="glass-card p-6 bg-white border-slate-200 shadow-sm mt-6">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">全局画法/情绪设定</h4>
                <div className="space-y-4">
                  <select 
                    value={selectedStyle}
                    onChange={(e) => setSelectedStyle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 outline-none focus:border-accent-blue transition-all"
                  >
                    <option value="">真人3D写实 (默认)</option>
                    {STYLES.map((s, idx) => <option key={`style-${idx}-${s}`} value={s}>{s}</option>)}
                  </select>
                  <div className="flex flex-wrap gap-1.5">
                    {MOODS.map((m, idx) => (
                      <button
                        key={`mood-${idx}-${m}`}
                        onClick={() => setSelectedMoods(prev => prev.includes(m) ? prev.filter(i => i !== m) : [...prev, m])}
                        className={`px-2 py-1 rounded-full text-[9px] font-bold border transition-all cursor-pointer ${selectedMoods.includes(m) ? 'bg-blue-50 border-accent-blue text-accent-blue' : 'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-200'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Generated Script */}
            <div className="lg:col-span-8">
              <div className="glass-card overflow-hidden h-full min-h-[700px] flex flex-col bg-white border-slate-200 shadow-sm">
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div>
                    <h2 className="text-2xl font-black text-primary-blue tracking-tight flex items-center gap-3">
                      <FileText className="w-6 h-6 text-accent-blue" /> 方案重构脚本
                    </h2>
                    <p className="text-slate-400 text-xs mt-1">方案: <span className="text-slate-600 font-bold">{themes[selectedThemeIndex]?.title}</span></p>
                  </div>
                  
                  {scriptsCache[selectedThemeIndex] && (
                    <div className="flex items-center gap-2">
                       <ActionButton 
                        onClick={() => setIsEditing(!isEditing)} 
                        icon={<FileText className="w-4 h-4" />} 
                        label={isEditing ? '预览' : '精修'} 
                      />
                      <ActionButton 
                        onClick={() => handleCopy(scriptsCache[selectedThemeIndex]!)} 
                        icon={<Copy className="w-4 h-4" />} 
                        label="复制" 
                      />
                      <ActionButton 
                        onClick={() => handleSaveAsset('full_script', scriptsCache[selectedThemeIndex]!, '重构脚本_' + themes[selectedThemeIndex]?.title)} 
                        icon={saveStatus['full_script' + '重构脚本_' + themes[selectedThemeIndex]?.title] ? <CheckCircle2 className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />} 
                        label="收藏脚本" 
                        active={saveStatus['full_script' + '重构脚本_' + themes[selectedThemeIndex]?.title]}
                      />
                    </div>
                  )}
                </div>

                <div className="flex-1 p-8 relative flex flex-col">
                  {loading && !scriptsCache[selectedThemeIndex] ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm z-10">
                      <div className="w-16 h-16 border-4 border-accent-blue border-t-transparent rounded-full animate-spin mb-4" />
                      <p className="text-accent-blue font-bold animate-pulse">正在精编脚本内容...</p>
                    </div>
                  ) : !scriptsCache[selectedThemeIndex] ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                      <Sparkles className="w-16 h-16 text-slate-300 mb-4" />
                      <p className="text-slate-500 font-bold">请点击左侧方案以生成脚本</p>
                      <button 
                         onClick={() => handleGenerateFinalScriptForTheme(selectedThemeIndex)}
                         className="mt-6 px-8 py-3 bg-slate-100 border border-slate-200 rounded-2xl text-slate-700 font-bold hover:bg-slate-200 transition-all cursor-pointer"
                      >
                        立即生成此方案脚本
                      </button>
                    </div>
                  ) : (
                    <div className="h-full">
                      {isEditing ? (
                        <textarea
                          value={scriptsCache[selectedThemeIndex]}
                          onChange={(e) => {
                            const newScript = e.target.value;
                            setScriptsCache(prev => ({ ...prev, [selectedThemeIndex]: newScript }));
                          }}
                          className="w-full h-[600px] bg-transparent border-none outline-none resize-none text-slate-700 leading-relaxed font-sans text-lg custom-scrollbar"
                          autoFocus
                        />
                      ) : (
                        <div className="markdown-body prose prose-slate prose-blue max-w-none h-[600px] overflow-y-auto pr-4 custom-scrollbar">
                          <ReactMarkdown>{scriptsCache[selectedThemeIndex]}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-8 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
                  <div className="flex items-center gap-4 text-xs font-bold text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-accent-blue" /> 生成成功
                    </div>
                    <span>内容长度: {scriptsCache[selectedThemeIndex]?.length || 0} 字</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => handleGenerateFinalScriptForTheme(selectedThemeIndex)}
                      disabled={loading}
                      className="p-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-400 rounded-xl transition-all cursor-pointer"
                      title="重新生成"
                    >
                      <RefreshIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepBadge({ num, active, label }: { num: number, active: boolean, label: string }) {
  return (
    <div className={`flex items-center gap-2 transition-all ${active ? 'opacity-100 scale-105' : 'opacity-30'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${active ? 'bg-primary-blue text-white shadow-lg shadow-slate-100' : 'bg-slate-200 text-slate-500'}`}>
        {num}
      </div>
      <span className={`text-xs font-black uppercase tracking-widest ${active ? 'text-primary-blue' : 'text-slate-500'}`}>{label}</span>
    </div>
  );
}

function HighlightGroup({ title, items = [], selected, onToggle }: { 
  title: string, 
  items?: string[], 
  selected: string[], 
  onToggle: (item: string) => void 
}) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">{title}</h4>
      <div className="space-y-2">
        {(items || []).map((item, i) => (
          <button
            key={`${item}-${i}`}
            onClick={() => onToggle(item)}
            className={`w-full flex items-center justify-between p-3 rounded-xl text-left text-xs transition-all border cursor-pointer ${selected.includes(item) ? 'bg-blue-50/50 border-accent-blue text-accent-blue shadow-sm' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-200 hover:text-primary-blue'}`}
          >
            <span className="font-medium mr-2">{item}</span>
            {selected.includes(item) && <Check className="w-4 h-4 flex-shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ onClick, icon, label, active }: { onClick: () => void, icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${active ? 'bg-primary-blue text-white border-primary-blue' : 'bg-white border-slate-200 text-slate-500 hover:text-primary-blue hover:border-slate-300'}`}
    >
      {icon}
      {label}
    </button>
  );
}
