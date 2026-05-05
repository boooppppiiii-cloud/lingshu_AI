import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Zap, Send, RefreshCw, MessageSquare, ChevronDown, Bookmark, Copy, CheckCircle2, Layout, FileText, Lightbulb, Image as ImageIcon, Upload, X } from 'lucide-react';
import ContentIteration from './ContentIteration';
import InspirationExtraction from './InspirationExtraction';
import { WorkshopTab, AssetType } from '../types';
import { geminiService } from '../services/gemini';
import { useAuth } from '../lib/AuthContext';
import { pb } from '../lib/pb';
import { buildAssetCreateBody } from '../lib/recordMappers';
import Markdown from 'react-markdown';

import { useToast } from '../lib/ToastContext';

export default function CreativeWorkshop() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<WorkshopTab>('flash');
  const [prompt, setPrompt] = useState('');
  const [sellingPoint, setSellingPoint] = useState<string>('');
  const [customSellingPoint, setCustomSellingPoint] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<string>('');
  const [customStyle, setCustomStyle] = useState('');
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [customMood, setCustomMood] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedScript, setGeneratedScript] = useState('');
  const [inspirationMode, setInspirationMode] = useState<'ideas' | 'script' | 'description' | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [inspirations, setInspirations] = useState<{title: string, concept: string, hook: string}[]>([]);
  const [activeInspirationIndex, setActiveInspirationIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{[key: string]: boolean}>({});

  const SELLING_POINTS = [
    '种花送时装',
    '种花送家装',
    '种花领限定花种',
    '种花送真花',
    '种花解锁多种玩法',
    '其他'
  ];

  const STYLES = [
    '真人3D写实风格',
    '华丽建模动画画风',
    'Q版动漫人物画风',
    '赛博奇幻画风',
    '其他'
  ];

  const MOODS = [
    '温情',
    '治愈',
    '热血',
    '悲伤',
    '惊喜',
    '戏剧性',
    '反转打脸',
    '其他'
  ];

  const handleFlashGenerate = async (mode: 'ideas' | 'script' | 'description') => {
    const finalSellingPoint = sellingPoint === '其他' ? customSellingPoint : sellingPoint;
    const finalStyle = selectedStyle === '其他' ? customStyle : selectedStyle;
    const finalMoods = [...selectedMoods.filter(m => m !== '其他'), ...(selectedMoods.includes('其他') ? [customMood] : [])].join('、');

    if (!prompt.trim() && !uploadedImage) return;

    setIsGenerating(true);
    setInspirationMode(mode);
    setGeneratedScript('');
    setInspirations([]);
    setIsEditing(false);
    setActiveInspirationIndex(null);

    try {
      if (mode === 'ideas') {
        const result = await geminiService.generateInspirationIdeas(prompt, finalSellingPoint, finalStyle, finalMoods);
        setInspirations(result || []);
      } else if (mode === 'script') {
        const result = await geminiService.generateFlashInspiration(prompt, finalSellingPoint, finalStyle, finalMoods);
        setGeneratedScript(result || '');
      } else if (mode === 'description') {
        const result = await geminiService.generateImageDescription(uploadedImage, prompt, finalSellingPoint, finalStyle, finalMoods);
        setGeneratedScript(result || '');
      }
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : '生成失败', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setUploadedImage(base64String);
        setImagePreview(base64String);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setUploadedImage(null);
    setImagePreview(null);
  };

  const handleGenerateFromInspiration = async (index: number) => {
     const insp = inspirations[index];
     const finalSellingPoint = sellingPoint === '其他' ? customSellingPoint : sellingPoint;
     const finalStyle = selectedStyle === '其他' ? customStyle : selectedStyle;
     const finalMoods = [...selectedMoods.filter(m => m !== '其他'), ...(selectedMoods.includes('其他') ? [customMood] : [])].join('、');

     setIsGenerating(true);
     setActiveInspirationIndex(index);
     setGeneratedScript('');
     setIsEditing(false);

     try {
       const scriptPrompt = `根据创意灵感点生成全文脚本：\n标题：${insp.title}\n核心梗：${insp.concept}\n爆点：${insp.hook}\n原始需求：${prompt}`;
       const result = await geminiService.generateFlashInspiration(scriptPrompt, finalSellingPoint, finalStyle, finalMoods);
       setGeneratedScript(result || '');
     } catch (error) {
       console.error(error);
       showToast(error instanceof Error ? error.message : '生成失败', 'error');
     } finally {
       setIsGenerating(false);
     }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleSaveAsset = async (type: AssetType, content: string, title: string) => {
    if (!user) return alert('请先登录以收藏资产');

    try {
      await pb.collection('assets').create(
        buildAssetCreateBody({
          userId: user.uid,
          type,
          title: title || '未命名资产',
          content,
          tags: [sellingPoint, selectedStyle, ...selectedMoods].filter(Boolean),
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

  const splitStoryboard = (script: string) => {
    const parts = script.split('【分镜脚本】');
    if (parts.length < 2) return null;
    return parts[1].trim();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit mx-auto mb-8 mt-4 sticky top-24 z-20 backdrop-blur-md border border-slate-200">
        <TabButton 
          active={activeTab === 'flash'} 
          onClick={() => setActiveTab('flash')}
          icon={<Zap className="w-4 h-4" />}
          label="灵光一闪"
        />
        <TabButton 
          active={activeTab === 'iteration'} 
          onClick={() => setActiveTab('iteration')}
          icon={<Sparkles className="w-4 h-4" />}
          label="创意迭代"
        />
        <TabButton 
          active={activeTab === 'inspiration'} 
          onClick={() => setActiveTab('inspiration')}
          icon={<Lightbulb className="w-4 h-4" />}
          label="灵感提取"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-12 custom-scrollbar">
        <AnimatePresence mode="wait">
          {activeTab === 'flash' ? (
            <motion.div
              key="flash"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-4xl mx-auto"
            >
              <div className="glass-card p-10">
                <div className="flex items-center gap-4 mb-10">
                  <div className="p-4 bg-accent-blue/5 rounded-2xl shadow-inner shadow-accent-blue/5">
                    <Zap className="w-8 h-8 text-accent-blue" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold text-primary-blue tracking-tight">灵光一闪</h2>
                    <p className="text-slate-500 text-sm">输入一段文字，AI 助你秒变分镜师</p>
                  </div>
                </div>

                <div className="space-y-8">
                  {/* Prompt Textarea */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-accent-blue" /> 核心创意描述 / 脚本需求
                      </label>
                      <button 
                        onClick={() => handleSaveAsset('prompt', prompt, prompt.slice(0, 20))}
                        disabled={!prompt.trim()}
                        className="text-[10px] font-bold text-accent-blue flex items-center gap-1 hover:brightness-125 disabled:opacity-30 transition-all font-sans"
                      >
                        {saveStatus['prompt'+prompt.slice(0, 20)] ? <CheckCircle2 className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                        收藏提示词
                      </button>
                    </div>
                    <div className="relative group">
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="例如：想要一个反转剧脚本，主角先是被看不起，然后通过展示奢华场景打脸对方..."
                        className="w-full h-40 bg-white border border-slate-200 rounded-[2rem] p-8 pr-20 focus:border-accent-blue outline-none transition-all resize-none leading-relaxed text-slate-700 shadow-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.metaKey) handleFlashGenerate('ideas');
                        }}
                      />

                      {imagePreview && (
                        <div className="absolute top-4 right-4 flex flex-col gap-2">
                          <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-accent-blue shadow-lg group/img">
                            <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                            <button 
                              onClick={clearImage}
                              className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="absolute bottom-6 right-6 flex items-center gap-3">
                        <input 
                          type="file" 
                          id="mood-image" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={handleImageUpload}
                        />
                        <button
                          onClick={() => document.getElementById('mood-image')?.click()}
                          className="p-3 bg-white border-2 border-slate-200 text-slate-500 rounded-2xl hover:border-accent-blue hover:text-accent-blue transition-all active:scale-95 shadow-sm"
                          title="上传参考图"
                        >
                          <Upload className="w-5 h-5" />
                        </button>

                        <button
                          onClick={() => handleFlashGenerate('ideas')}
                          disabled={isGenerating || (!prompt.trim() && !uploadedImage)}
                          className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all disabled:opacity-50 active:scale-95 shadow-lg border-2 ${
                            inspirationMode === 'ideas' 
                              ? 'bg-accent-blue text-white border-accent-blue scale-105' 
                              : 'bg-white border-accent-blue text-accent-blue hover:bg-accent-blue/5'
                          }`}
                        >
                          {isGenerating && inspirationMode === 'ideas' ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <Lightbulb className="w-5 h-5" />
                          )}
                          生成灵感
                        </button>

                        <button
                          onClick={() => handleFlashGenerate('description')}
                          disabled={isGenerating || (!prompt.trim() && !uploadedImage)}
                          className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all disabled:opacity-50 active:scale-95 shadow-lg border-2 ${
                            inspirationMode === 'description' 
                              ? 'bg-purple-600 text-white border-purple-600 scale-105' 
                              : 'bg-white border-purple-600 text-purple-600 hover:bg-purple-50'
                          }`}
                        >
                          {isGenerating && inspirationMode === 'description' ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <ImageIcon className="w-5 h-5" />
                          )}
                          画面描述
                        </button>

                        <button
                          onClick={() => handleFlashGenerate('script')}
                          disabled={isGenerating || (!prompt.trim() && !uploadedImage)}
                          className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all disabled:opacity-50 active:scale-95 shadow-xl ${
                            inspirationMode === 'script'
                              ? 'bg-primary-blue text-white border-primary-blue scale-105 shadow-primary-blue/20'
                              : 'bg-primary-blue text-white border-primary-blue hover:brightness-110 shadow-primary-blue/20'
                          }`}
                        >
                          {isGenerating && inspirationMode === 'script' ? (
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          ) : (
                            <Send className="w-5 h-5" />
                          )}
                          全文脚本
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Horizontal Selectors */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Dropdown 
                      label="卖点选择 (选填)" 
                      options={SELLING_POINTS} 
                      value={sellingPoint} 
                      onSelect={setSellingPoint} 
                      customValue={customSellingPoint}
                      onCustomChange={setCustomSellingPoint}
                      isOther={sellingPoint === '其他'}
                    />
                    <Dropdown 
                      label="画风选择 (选填)" 
                      options={STYLES} 
                      value={selectedStyle} 
                      onSelect={setSelectedStyle} 
                      customValue={customStyle}
                      onCustomChange={setCustomStyle}
                      isOther={selectedStyle === '其他'}
                    />
                    <Dropdown 
                      label="情绪选择 (多选/选填)" 
                      options={MOODS} 
                      value={selectedMoods} 
                      onSelect={(val: string) => {
                        setSelectedMoods(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
                      }} 
                      customValue={customMood}
                      onCustomChange={setCustomMood}
                      isOther={selectedMoods.includes('其他')}
                      isMulti
                    />
                  </div>
                </div>

                <AnimatePresence>
                  {inspirations.length > 0 && (
                    <motion.div
                      key="inspirations-list"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-12 space-y-6 pt-10 border-t border-slate-100"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-primary-blue font-black tracking-tight text-xl flex items-center gap-2">
                          <Lightbulb className="w-5 h-5 text-accent-blue" /> 生成的创意灵感
                        </h3>
                        <p className="text-xs text-slate-400">点击其中一个灵感以生成详细脚本</p>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {inspirations.map((insp, i) => (
                          <div 
                            key={`insp-${i}-${insp.title}`} 
                            className={`p-6 rounded-[2rem] border transition-all group relative ${activeInspirationIndex === i ? 'bg-accent-blue/5 border-accent-blue ring-4 ring-accent-blue/5' : 'bg-white border-slate-200 hover:border-accent-blue/30'}`}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-[10px] font-black text-accent-blue uppercase tracking-widest">灵感 0{i + 1}</span>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => handleSaveAsset('inspiration', `标题：${insp.title}\n核心梗：${insp.concept}\n爆点：${insp.hook}`, insp.title)}
                                  className="p-1.5 text-slate-400 hover:text-accent-blue transition-colors"
                                  title="收藏至资产卡片"
                                >
                                  {saveStatus['inspiration' + insp.title] ? <CheckCircle2 className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                                </button>
                                <button 
                                  onClick={() => handleGenerateFromInspiration(i)}
                                  className="p-1.5 text-slate-400 hover:text-primary-blue transition-colors"
                                  title="基于此灵感生成脚本"
                                >
                                  <FileText className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <h4 className="font-bold text-primary-blue mb-2">{insp.title}</h4>
                            <p className="text-xs text-slate-600 mb-2 leading-relaxed">{insp.concept}</p>
                            <div className="text-[10px] text-accent-blue font-bold p-2 bg-accent-blue/5 rounded-lg border border-accent-blue/10">
                              爆点：{insp.hook}
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {generatedScript && (
                    <motion.div
                      key="generated-script-display"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-12 space-y-6 pt-10 border-t border-white/5"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-accent-blue font-black uppercase tracking-widest text-sm flex items-center gap-2">
                          <Zap className="w-4 h-4" /> AI 生成脚本：
                        </h3>
                        <div className="flex items-center gap-2">
                          <ActionButton 
                            onClick={() => setIsEditing(!isEditing)} 
                            icon={<FileText className="w-4 h-4" />} 
                            label={isEditing ? '预览' : '人工编辑'} 
                          />
                          <ActionButton 
                            onClick={() => handleCopy(generatedScript)} 
                            icon={<Copy className="w-4 h-4" />} 
                            label="脚本复制" 
                          />
                          {inspirationMode === 'description' ? (
                            <ActionButton 
                              onClick={() => {
                                handleSaveAsset('visual_detail', generatedScript, prompt.slice(0, 15) + '_画面与口令');
                              }} 
                              icon={saveStatus['visual_detail' + prompt.slice(0, 15) + '_画面与口令'] ? <CheckCircle2 className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />} 
                              label="脚本收藏" 
                              active={saveStatus['visual_detail' + prompt.slice(0, 15) + '_画面与口令']}
                            />
                          ) : (
                            <ActionButton 
                              onClick={() => {
                                const defaultTitle = activeInspirationIndex !== null 
                                  ? inspirations[activeInspirationIndex].title + '_脚本'
                                  : prompt.slice(0, 15) + '_全文';
                                handleSaveAsset('full_script', generatedScript, defaultTitle);
                              }} 
                              icon={saveStatus['full_script' + (activeInspirationIndex !== null ? inspirations[activeInspirationIndex].title + '_脚本' : prompt.slice(0, 15) + '_全文')] ? <CheckCircle2 className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />} 
                              label="脚本收藏" 
                              active={saveStatus['full_script' + (activeInspirationIndex !== null ? inspirations[activeInspirationIndex].title + '_脚本' : prompt.slice(0, 15) + '_全文')]}
                            />
                          )}
                        </div>
                      </div>

                      <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-200 shadow-inner group relative">
                        {isEditing ? (
                          <textarea
                            value={generatedScript}
                            onChange={(e) => setGeneratedScript(e.target.value)}
                            className="w-full min-h-[300px] bg-transparent border-none outline-none resize-none text-slate-700 font-sans leading-relaxed text-lg"
                          />
                        ) : (
                          <div className="markdown-body prose prose-slate prose-blue max-w-none">
                            <Markdown>{generatedScript}</Markdown>
                          </div>
                        )}
                      </div>

                      {splitStoryboard(generatedScript) && (
                        <div className="flex items-center justify-end gap-3 mt-4">
                          <span className="text-xs text-slate-500 mr-auto font-medium">✨ 发现分镜部分，支持快速操作：</span>
                          <button 
                            onClick={() => handleCopy(splitStoryboard(generatedScript)!)}
                            className="text-[10px] font-bold text-slate-500 hover:text-primary-blue px-3 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm transition-all flex items-center gap-1.5"
                          >
                            <Layout className="w-3 h-3" /> 复制分镜
                          </button>
                          <button 
                            onClick={() => handleSaveAsset('full_script', splitStoryboard(generatedScript)!, prompt.slice(0, 15) + '_分镜')}
                            className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${saveStatus['full_script' + prompt.slice(0, 15) + '_分镜'] ? 'bg-accent-blue/10 border-accent-blue text-accent-blue' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300'}`}
                          >
                            {saveStatus['full_script' + prompt.slice(0, 15) + '_分镜'] ? <CheckCircle2 className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                            收藏分镜 (至整篇脚本)
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : activeTab === 'iteration' ? (
            <motion.div
              key="iteration"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-6xl mx-auto"
            >
              <ContentIteration />
            </motion.div>
          ) : (
            <motion.div
              key="inspiration"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-6xl mx-auto"
            >
              <InspirationExtraction />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface DropdownProps {
  label: string;
  options: string[];
  value: string | string[];
  onSelect: (val: string) => void;
  customValue: string;
  onCustomChange: (val: string) => void;
  isOther: boolean;
  isMulti?: boolean;
}

function Dropdown({ label, options, value, onSelect, customValue, onCustomChange, isOther, isMulti }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  const displayValue = isMulti 
    ? ((value as string[]).length > 0 ? (value as string[]).join(', ') : '请选择')
    : (value || '请选择');

  return (
    <div className="space-y-2 relative">
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-2">{label}</label>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-5 py-4 bg-slate-50 border rounded-2xl transition-all ${isOpen ? 'border-accent-blue/50 ring-4 ring-accent-blue/5' : 'border-slate-200 hover:border-slate-300'}`}
      >
        <span className={`text-sm truncate ${value && (isMulti ? (value as string[]).length > 0 : true) ? 'text-primary-blue font-bold' : 'text-slate-400'}`}>
          {displayValue}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-accent-blue' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 top-full left-0 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden"
          >
            <div className="max-h-60 overflow-y-auto py-2 custom-scrollbar">
              {options.map((opt: string, i: number) => (
                <button
                  key={`${opt}-${i}`}
                  onClick={() => {
                    onSelect(opt);
                    if (!isMulti) setIsOpen(false);
                  }}
                  className={`w-full text-left px-5 py-3 text-sm transition-colors flex items-center justify-between group ${
                    isMulti 
                      ? ((value as string[]).includes(opt) ? 'bg-accent-blue/5 text-accent-blue' : 'text-slate-600 hover:bg-slate-50')
                      : (value === opt ? 'bg-accent-blue/5 text-accent-blue' : 'text-slate-600 hover:bg-slate-50')
                  }`}
                >
                  <span className="font-medium group-hover:translate-x-1 transition-transform">{opt}</span>
                  {(isMulti ? (value as string[]).includes(opt) : value === opt) && <CheckCircle2 className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isOther && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2">
          <input
            type="text"
            value={customValue}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="请输入自定义内容..."
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs focus:border-accent-blue outline-none text-slate-700 shadow-sm"
          />
        </motion.div>
      )}
    </div>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}

function ActionButton({ onClick, icon, label, active }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${active ? 'bg-accent-blue text-white border-accent-blue' : 'bg-white border-slate-200 text-slate-500 hover:text-primary-blue hover:bg-slate-50 hover:border-slate-300'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function TabButton({ active, onClick, icon, label }: { 
  active: boolean, 
  onClick: () => void, 
  icon: React.ReactNode, 
  label: string 
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all relative z-10 ${active ? 'text-white' : 'text-slate-500 hover:text-slate-800'}`}
    >
      {active && (
        <motion.div
          layoutId="tab-active"
          className="absolute inset-0 bg-primary-blue rounded-lg shadow-md"
        />
      )}
      <span className="relative z-10">{icon}</span>
      <span className="relative z-10">{label}</span>
    </button>
  );
}
