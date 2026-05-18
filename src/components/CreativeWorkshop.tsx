import { useMemo, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Zap, Send, RefreshCw, MessageSquare, ChevronDown, Bookmark, Copy, CheckCircle2, FileText, Lightbulb, Image as ImageIcon, Upload, X, Timer, Mic } from 'lucide-react';
import ContentIteration from './ContentIteration';
import InspirationExtraction from './InspirationExtraction';
import { WorkshopTab, AssetType } from '../types';

type FlashBookmarkId = 'storyboard' | 'voiceover' | 'display';

function isCustomSellingSelection(v: string) {
  return v === '其他' || v === '其他（须填写）';
}

function isCustomStyleSelection(v: string) {
  return v === '其他' || v === '其他（须填写）';
}

function moodsWithoutCustomTokens(moods: string[]) {
  return moods.filter((m) => m !== '其他' && m !== '其他（须填写）');
}

function hasCustomMoodSelection(moods: string[]) {
  return moods.some((m) => m === '其他' || m === '其他（须填写）');
}

const VOICE_IDENTITY_OPTIONS = ['游戏制作人', '普通玩家', '闺蜜', '宝妈', '牛马上班族', '其他'] as const;
const VOICE_SCENE_OPTIONS = ['权威采访', '偷偷泄露内部信息', '姐妹情感共鸣', '其他'] as const;
const VOICE_EMOTION_OPTIONS = ['震惊', '悲愤', '惊喜', '无奈', '焦急', '其他'] as const;
import {
  geminiService,
  FLASH_SCRIPT_DURATION_LABEL,
  FLASH_SCRIPT_DURATION_PRESETS,
  type FlashScriptDiagnosis,
  type FlashScriptDurationPreset,
} from '../services/gemini';
import { useAuth } from '../lib/AuthContext';
import { pb } from '../lib/pb';
import { buildAssetCreateBody } from '../lib/recordMappers';
import Markdown from 'react-markdown';
import FlashScriptDiagnosisPanel from './FlashScriptDiagnosisPanel';

import { useToast } from '../lib/ToastContext';
import { createLeadingDebouncer } from '../lib/leadingDebounce';
import { logUsageEvent } from '../lib/logUsageEvent';
import { USAGE_EVENT } from '../lib/usageEvents';
import { parseDisplayImageMarkdown } from '../lib/parseDisplayImageMarkdown';
import { useGameProfile } from '../lib/GameProfileContext';
import { getGameCreativeProfile } from '../lib/gameProfiles';
import type { IterationHandoff } from '../lib/iterationHandoff';

type CreativeWorkshopProps = {
  iterationHandoff?: IterationHandoff | null;
  onIterationHandoffConsumed?: () => void;
};

export default function CreativeWorkshop({
  iterationHandoff = null,
  onIterationHandoffConsumed,
}: CreativeWorkshopProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { gameProfileId } = useGameProfile();
  const [activeTab, setActiveTab] = useState<WorkshopTab>('flash');

  useEffect(() => {
    if (iterationHandoff) {
      setActiveTab('iteration');
    }
  }, [iterationHandoff]);
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
  const [displayPrompt, setDisplayPrompt] = useState('');
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const [displayPreview, setDisplayPreview] = useState<string | null>(null);
  const [displayOutput, setDisplayOutput] = useState('');
  const [displayParsedDescription, setDisplayParsedDescription] = useState('');
  const [displayMotionCards, setDisplayMotionCards] = useState<string[]>([]);
  const [selectedMotionCardIndex, setSelectedMotionCardIndex] = useState<number | null>(null);
  const [displayProductionSeconds, setDisplayProductionSeconds] = useState('');
  const [displayProductionScript, setDisplayProductionScript] = useState('');
  const [isGeneratingDisplayProduction, setIsGeneratingDisplayProduction] = useState(false);
  const [isEditingDisplayProduction, setIsEditingDisplayProduction] = useState(false);
  const [inspirations, setInspirations] = useState<{title: string, concept: string, hook: string}[]>([]);
  const [activeInspirationIndex, setActiveInspirationIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{[key: string]: boolean}>({});
  const [geminiRetryLabel, setGeminiRetryLabel] = useState<string | null>(null);
  const [scriptDurationPreset, setScriptDurationPreset] = useState<FlashScriptDurationPreset>('10-15');
  const [scriptDiagnosis, setScriptDiagnosis] = useState<FlashScriptDiagnosis | null>(null);
  const [scriptDiagnosisLoading, setScriptDiagnosisLoading] = useState(false);
  const [scriptDiagnosisError, setScriptDiagnosisError] = useState<string | null>(null);
  const [flashBookmark, setFlashBookmark] = useState<FlashBookmarkId>('storyboard');
  const [voPrompt, setVoPrompt] = useState('');
  const [voFlowerGame, setVoFlowerGame] = useState(false);
  const [voIdentity, setVoIdentity] = useState('');
  const [voIdentityOther, setVoIdentityOther] = useState('');
  const [voScene, setVoScene] = useState('');
  const [voSceneOther, setVoSceneOther] = useState('');
  const [voEmotion, setVoEmotion] = useState('');
  const [voEmotionOther, setVoEmotionOther] = useState('');
  const [voiceoverScript, setVoiceoverScript] = useState('');

  const creativeProfile = useMemo(() => getGameCreativeProfile(gameProfileId), [gameProfileId]);

  useEffect(() => {
    if (!creativeProfile.supportsVoiceoverFlash && flashBookmark === 'voiceover') {
      setFlashBookmark('storyboard');
    }
  }, [creativeProfile.supportsVoiceoverFlash, flashBookmark]);

  useEffect(() => {
    setSellingPoint('');
    setCustomSellingPoint('');
    setSelectedStyle('');
    setCustomStyle('');
    setSelectedMoods([]);
    setCustomMood('');
    setGeneratedScript('');
    setInspirations([]);
    setActiveInspirationIndex(null);
    setVoiceoverScript('');
    setDisplayOutput('');
    setDisplayParsedDescription('');
    setDisplayMotionCards([]);
    setScriptDiagnosis(null);
  }, [gameProfileId]);

  const geminiOpts = useMemo(
    () => ({
      onRetryAttempt: (n: number, m: number) => setGeminiRetryLabel(`第 ${n} / ${m} 次请求`),
    }),
    [],
  );

  const geminiCallOpts = useMemo(
    () => ({
      ...geminiOpts,
      analyticsUserId: user?.uid,
      gameProfileId,
    }),
    [geminiOpts, user?.uid, gameProfileId],
  );

  const activeFlashScript =
    flashBookmark === 'storyboard'
      ? generatedScript
      : flashBookmark === 'voiceover'
        ? voiceoverScript
        : displayOutput;

  const flashSellingSummary = useMemo(
    () => (isCustomSellingSelection(sellingPoint) ? customSellingPoint : sellingPoint).trim(),
    [sellingPoint, customSellingPoint],
  );

  const SELLING_POINTS = useMemo(() => [...creativeProfile.sellingPoints], [creativeProfile]);
  const STYLES = useMemo(() => [...creativeProfile.styles], [creativeProfile]);
  const MOODS = useMemo(() => [...creativeProfile.moods], [creativeProfile]);
  const flashStoryboardPlaceholder = creativeProfile.flashStoryboardPlaceholder;
  const flashDisplayPlaceholder = creativeProfile.flashDisplayPlaceholder;

  useEffect(() => {
    if (activeTab !== 'flash' || flashBookmark !== 'storyboard') return;
    if (inspirationMode === 'description') {
      setScriptDiagnosis(null);
      setScriptDiagnosisLoading(false);
      setScriptDiagnosisError(null);
      return;
    }
    const text = generatedScript.trim();
    const looksLikeBoardScript =
      text.length >= 60 && /【基本要求】|【分镜脚本】|【分镜标签】|\[00:\d{2}-\d{2}:\d{2}\]/.test(text);
    if (!looksLikeBoardScript) {
      setScriptDiagnosis(null);
      setScriptDiagnosisLoading(false);
      setScriptDiagnosisError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        setScriptDiagnosisLoading(true);
        setScriptDiagnosisError(null);
        try {
          const data = await geminiService.diagnoseFlashScript(
            text,
            flashSellingSummary || undefined,
            geminiCallOpts,
          );
          if (cancelled) return;
          if (!data || !data.emotionCurve?.length) {
            setScriptDiagnosis(null);
            setScriptDiagnosisError('诊断未完成或格式异常，请稍后再试。');
          } else {
            setScriptDiagnosis(data);
            if (user?.uid) {
              void logUsageEvent(user.uid, USAGE_EVENT.SCRIPT_DIAGNOSED, {
                source: 'creative_workshop_flash',
                operatorDisplayName: user.displayName,
                meta: {
                  hook3_status: data.hook3s.status,
                  hook3_score: data.hook3s.score,
                  sell8_status: data.selling8s.status,
                  sell8_score: data.selling8s.score,
                  total_seconds: data.totalSeconds,
                },
              });
            }
          }
        } catch (e) {
          if (cancelled) return;
          setScriptDiagnosis(null);
          setScriptDiagnosisError(e instanceof Error ? e.message : '诊断请求失败');
        } finally {
          if (!cancelled) {
            setScriptDiagnosisLoading(false);
          }
        }
      })();
    }, 720);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setScriptDiagnosisLoading(false);
    };
  }, [activeTab, flashBookmark, inspirationMode, generatedScript, flashSellingSummary, geminiCallOpts, user?.uid, user?.displayName]);

  const handleVoiceoverGenerateImpl = async () => {
    if (!voPrompt.trim()) {
      showToast('请先填写提示词', 'error');
      return;
    }
    const resolveOther = (v: string, other: string) => {
      if (v === '其他') return other.trim();
      return (v || '').trim();
    };
    if (voFlowerGame) {
      if (!voIdentity || (voIdentity === '其他' && !voIdentityOther.trim())) {
        showToast('请选择口播身份，选择「其他」时请填写说明', 'error');
        return;
      }
      if (!voScene || (voScene === '其他' && !voSceneOther.trim())) {
        showToast('请选择场景，选择「其他」时请填写说明', 'error');
        return;
      }
      if (!voEmotion || (voEmotion === '其他' && !voEmotionOther.trim())) {
        showToast('请选择情绪，选择「其他」时请填写说明', 'error');
        return;
      }
    }

    const vi = voFlowerGame ? resolveOther(voIdentity, voIdentityOther) : '';
    const vs = voFlowerGame ? resolveOther(voScene, voSceneOther) : '';
    const ve = voFlowerGame ? resolveOther(voEmotion, voEmotionOther) : '';

    setIsGenerating(true);
    setGeminiRetryLabel(null);
    setVoiceoverScript('');
    setInspirationMode('script');
    setIsEditing(false);
    setScriptDiagnosis(null);
    setScriptDiagnosisError(null);
    setScriptDiagnosisLoading(false);

    try {
      const result = await geminiService.generateVoiceoverScript(
        voPrompt.trim(),
        voFlowerGame,
        vi,
        vs,
        ve,
        geminiCallOpts,
        scriptDurationPreset,
      );
      setVoiceoverScript(result || '');
      if (user?.uid) {
        void logUsageEvent(user.uid, USAGE_EVENT.SCRIPT_GENERATED, {
          source: 'creative_workshop_flash',
          meta: { variant: 'voiceover_mix_cut', durationPreset: scriptDurationPreset, flowerGame: voFlowerGame },
        });
      }
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : '生成失败', 'error');
    } finally {
      setGeminiRetryLabel(null);
      setIsGenerating(false);
    }
  };

  const handleVoiceoverGenerateRef = useRef(handleVoiceoverGenerateImpl);
  handleVoiceoverGenerateRef.current = handleVoiceoverGenerateImpl;

  const handleVoiceoverGenerate = useMemo(
    () => createLeadingDebouncer(500)(() => void handleVoiceoverGenerateRef.current()),
    [],
  );

  const handleDisplayGenerateImpl = async () => {
    if (!displayPrompt.trim() && !displayImage) {
      showToast('请填写提示词或上传参考图', 'error');
      return;
    }
    const finalSellingPoint = isCustomSellingSelection(sellingPoint) ? customSellingPoint : sellingPoint;
    const finalStyle = isCustomStyleSelection(selectedStyle) ? customStyle : selectedStyle;
    const finalMoods = [...moodsWithoutCustomTokens(selectedMoods), ...(hasCustomMoodSelection(selectedMoods) ? [customMood] : [])].join('、');

    setIsGenerating(true);
    setGeminiRetryLabel(null);
    setInspirationMode('description');
    setDisplayOutput('');
    setDisplayParsedDescription('');
    setDisplayMotionCards([]);
    setSelectedMotionCardIndex(null);
    setDisplayProductionSeconds('');
    setDisplayProductionScript('');
    setIsEditingDisplayProduction(false);
    setIsEditing(false);
    setScriptDiagnosis(null);
    setScriptDiagnosisError(null);
    setScriptDiagnosisLoading(false);

    try {
      const result = await geminiService.generateImageDescription(
        displayImage,
        displayPrompt.trim(),
        finalSellingPoint,
        finalStyle,
        finalMoods,
        geminiCallOpts,
      );
      setDisplayOutput(result || '');
      const parsed = parseDisplayImageMarkdown(result || '');
      setDisplayParsedDescription(parsed.description);
      setDisplayMotionCards(parsed.motionCards);
      setSelectedMotionCardIndex(null);
      setDisplayProductionSeconds('');
      setDisplayProductionScript('');
      setIsEditingDisplayProduction(false);
      if (user?.uid) {
        void logUsageEvent(user.uid, USAGE_EVENT.SCRIPT_GENERATED, {
          source: 'creative_workshop_flash',
          meta: { variant: 'display_visual_description', hasImage: Boolean(displayImage) },
        });
      }
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : '生成失败', 'error');
    } finally {
      setGeminiRetryLabel(null);
      setIsGenerating(false);
    }
  };

  const handleDisplayGenerateRef = useRef(handleDisplayGenerateImpl);
  handleDisplayGenerateRef.current = handleDisplayGenerateImpl;

  const handleDisplayGenerate = useMemo(
    () => createLeadingDebouncer(500)(() => void handleDisplayGenerateRef.current()),
    [],
  );

  const handleDisplayProductionGenerateImpl = async () => {
    if (selectedMotionCardIndex === null) {
      showToast('请先点选一条动态口令卡片', 'error');
      return;
    }
    const sec = Math.floor(Number(displayProductionSeconds));
    if (!Number.isFinite(sec) || sec < 1 || sec > 600) {
      showToast('请输入 1～600 之间的期望成片秒数', 'error');
      return;
    }
    const card = displayMotionCards[selectedMotionCardIndex];
    if (!card?.trim()) {
      showToast('所选调口令无效', 'error');
      return;
    }
    const finalSellingPoint = isCustomSellingSelection(sellingPoint) ? customSellingPoint : sellingPoint;
    const finalStyle = isCustomStyleSelection(selectedStyle) ? customStyle : selectedStyle;
    const finalMoods = [...moodsWithoutCustomTokens(selectedMoods), ...(hasCustomMoodSelection(selectedMoods) ? [customMood] : [])].join('、');

    setIsGeneratingDisplayProduction(true);
    setGeminiRetryLabel(null);
    setIsEditingDisplayProduction(false);
    setDisplayProductionScript('');
    try {
      const result = await geminiService.generateDisplayProductionScriptStream(
        card.trim(),
        sec,
        displayParsedDescription.trim(),
        finalSellingPoint,
        finalStyle,
        finalMoods,
        {
          ...geminiCallOpts,
          onDelta: (_delta, accumulated) => {
            setDisplayProductionScript(accumulated);
          },
        },
      );
      const trimmed = (result ?? '').trim();
      setDisplayProductionScript(trimmed);
      if (user?.uid && trimmed) {
        void logUsageEvent(user.uid, USAGE_EVENT.SCRIPT_GENERATED, {
          source: 'creative_workshop_flash',
          meta: {
            variant: 'display_production_script',
            stream: true,
            durationSeconds: sec,
            motionCardIndex: selectedMotionCardIndex,
          },
        });
      }
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : '生成失败', 'error');
    } finally {
      setGeminiRetryLabel(null);
      setIsGeneratingDisplayProduction(false);
    }
  };

  const handleDisplayProductionGenerateRef = useRef(handleDisplayProductionGenerateImpl);
  handleDisplayProductionGenerateRef.current = handleDisplayProductionGenerateImpl;

  const handleDisplayProductionGenerate = useMemo(
    () => createLeadingDebouncer(500)(() => void handleDisplayProductionGenerateRef.current()),
    [],
  );

  const displayProductionAssetTitle = useMemo(() => {
    const sec = displayProductionSeconds.trim() || '?';
    const idx = selectedMotionCardIndex !== null ? selectedMotionCardIndex + 1 : '?';
    return `展示制作_${sec}s_卡${idx}`;
  }, [displayProductionSeconds, selectedMotionCardIndex]);

  const filledMotionCardCount = useMemo(
    () => displayMotionCards.filter((c) => c.trim()).length,
    [displayMotionCards],
  );

  const handleFlashGenerateImpl = async (mode: 'ideas' | 'script') => {
    const finalSellingPoint = isCustomSellingSelection(sellingPoint) ? customSellingPoint : sellingPoint;
    const finalStyle = isCustomStyleSelection(selectedStyle) ? customStyle : selectedStyle;
    const finalMoods = [...moodsWithoutCustomTokens(selectedMoods), ...(hasCustomMoodSelection(selectedMoods) ? [customMood] : [])].join('、');

    if (!prompt.trim()) return;

    setIsGenerating(true);
    setGeminiRetryLabel(null);
    setInspirationMode(mode);
    setGeneratedScript('');
    setInspirations([]);
    setIsEditing(false);
    setActiveInspirationIndex(null);
    setScriptDiagnosis(null);
    setScriptDiagnosisError(null);
    setScriptDiagnosisLoading(false);

    try {
      if (mode === 'ideas') {
        const result = await geminiService.generateInspirationIdeas(
          prompt,
          finalSellingPoint,
          finalStyle,
          finalMoods,
          geminiCallOpts,
        );
        setInspirations(result || []);
        if (user?.uid) {
          void logUsageEvent(user.uid, USAGE_EVENT.CREATIVE_IDEAS_GENERATED, {
            source: 'creative_workshop_flash',
          });
        }
      } else if (mode === 'script') {
        const result = await geminiService.generateFlashInspiration(
          prompt,
          finalSellingPoint,
          finalStyle,
          finalMoods,
          geminiCallOpts,
          scriptDurationPreset,
        );
        setGeneratedScript(result || '');
        if (user?.uid) {
          void logUsageEvent(user.uid, USAGE_EVENT.SCRIPT_GENERATED, {
            source: 'creative_workshop_flash',
            meta: { variant: 'direct_prompt', durationPreset: scriptDurationPreset },
          });
        }
      }
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : '生成失败', 'error');
    } finally {
      setGeminiRetryLabel(null);
      setIsGenerating(false);
    }
  };

  const handleFlashGenerateRef = useRef(handleFlashGenerateImpl);
  handleFlashGenerateRef.current = handleFlashGenerateImpl;

  const handleFlashGenerate = useMemo(
    () => createLeadingDebouncer(500)((mode: 'ideas' | 'script') => void handleFlashGenerateRef.current(mode)),
    [],
  );

  const handleDisplayImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setDisplayImage(base64String);
        setDisplayPreview(base64String);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearDisplayImage = () => {
    setDisplayImage(null);
    setDisplayPreview(null);
  };

  const handleGenerateFromInspirationImpl = async (index: number) => {
     const insp = inspirations[index];
     const finalSellingPoint = isCustomSellingSelection(sellingPoint) ? customSellingPoint : sellingPoint;
     const finalStyle = isCustomStyleSelection(selectedStyle) ? customStyle : selectedStyle;
     const finalMoods = [...moodsWithoutCustomTokens(selectedMoods), ...(hasCustomMoodSelection(selectedMoods) ? [customMood] : [])].join('、');

     setIsGenerating(true);
     setGeminiRetryLabel(null);
     setActiveInspirationIndex(index);
     setGeneratedScript('');
     setIsEditing(false);
     setScriptDiagnosis(null);
     setScriptDiagnosisError(null);
     setScriptDiagnosisLoading(false);

     try {
       const scriptPrompt = `根据创意灵感点生成全文脚本：\n标题：${insp.title}\n核心梗：${insp.concept}\n爆点：${insp.hook}\n原始需求：${prompt}`;
       const result = await geminiService.generateFlashInspiration(
         scriptPrompt,
         finalSellingPoint,
         finalStyle,
         finalMoods,
         geminiCallOpts,
         scriptDurationPreset,
       );
       setGeneratedScript(result || '');
       setInspirationMode('script');
       if (user?.uid) {
         void logUsageEvent(user.uid, USAGE_EVENT.SCRIPT_GENERATED, {
           source: 'creative_workshop_flash',
           meta: { variant: 'from_inspiration', durationPreset: scriptDurationPreset },
         });
       }
     } catch (error) {
       console.error(error);
       showToast(error instanceof Error ? error.message : '生成失败', 'error');
     } finally {
       setGeminiRetryLabel(null);
       setIsGenerating(false);
     }
  };

  const handleGenerateFromInspirationRef = useRef(handleGenerateFromInspirationImpl);
  handleGenerateFromInspirationRef.current = handleGenerateFromInspirationImpl;

  const handleGenerateFromInspiration = useMemo(
    () => createLeadingDebouncer(500)((index: number) => void handleGenerateFromInspirationRef.current(index)),
    [],
  );

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleSaveAsset = async (
    type: AssetType,
    content: string,
    title: string,
    extraTags?: string[],
  ) => {
    if (!user) return alert('请先登录以收藏资产');

    try {
      const record = await pb.collection('assets').create(
        buildAssetCreateBody({
          userId: user.uid,
          gameProfileId,
          type,
          title: title || '未命名资产',
          content,
          tags: [
            ...(extraTags ?? []),
            ...(flashBookmark === 'voiceover' ? ['混剪口播'] : []),
            ...(flashBookmark === 'display' ? ['展示类脚本'] : []),
            sellingPoint,
            selectedStyle,
            ...selectedMoods,
          ].filter(Boolean),
          likes: 0,
          likedBy: [],
        })
      );

      if (type === 'inspiration') {
        void logUsageEvent(user.uid, USAGE_EVENT.CREATIVE_INSPIRATION_SAVED, {
          source: 'creative_workshop_flash',
          refCollection: 'assets',
          refId: record.id,
          meta: { asset_type: type },
        });
      }

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
              className="max-w-6xl mx-auto"
            >
              <div className="flex flex-col lg:flex-row gap-8 lg:items-start">
                <div className="flex-1 min-w-0 space-y-8">
              <div className="glass-card p-10">
                <div className="flex items-center gap-4 mb-10">
                  <div className="p-4 bg-accent-blue/5 rounded-2xl shadow-inner shadow-accent-blue/5">
                    {flashBookmark === 'storyboard' ? (
                      <Zap className="w-8 h-8 text-accent-blue" />
                    ) : flashBookmark === 'voiceover' ? (
                      <Mic className="w-8 h-8 text-accent-blue" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-accent-blue" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold text-primary-blue tracking-tight">灵光一闪</h2>
                    <p className="text-slate-500 text-sm">
                      {flashBookmark === 'storyboard'
                        ? '输入一段文字，AI 助你秒变分镜师'
                        : flashBookmark === 'voiceover'
                          ? '简单提示词与口播设定，生成混剪可用口播台词'
                          : '上传参考图并填写需求，生成画面描述与 5 组动态口令'}
                    </p>
                  </div>
                </div>

                {flashBookmark === 'storyboard' ? (
                <>
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
                        placeholder={flashStoryboardPlaceholder}
                        className="w-full h-40 bg-white border border-slate-200 rounded-[2rem] p-8 pr-20 focus:border-accent-blue outline-none transition-all resize-none leading-relaxed text-slate-700 shadow-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.metaKey) handleFlashGenerate('ideas');
                        }}
                      />

                      <div className="absolute bottom-6 right-6 flex items-center gap-3">
                        <button
                          onClick={() => handleFlashGenerate('ideas')}
                          disabled={isGenerating || !prompt.trim()}
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
                          onClick={() => handleFlashGenerate('script')}
                          disabled={isGenerating || !prompt.trim()}
                          className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold border-2 transition-all disabled:opacity-50 active:scale-95 shadow-xl bg-white text-black border-black ${
                            inspirationMode === 'script'
                              ? 'scale-105 shadow-black/15'
                              : 'hover:bg-slate-50 shadow-slate-200/80'
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
                      {isGenerating && geminiRetryLabel ? (
                        <p className="absolute bottom-2 left-8 text-[10px] text-slate-500">{geminiRetryLabel}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-1">
                      <Timer className="w-4 h-4 text-accent-blue" /> 脚本时长
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {FLASH_SCRIPT_DURATION_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setScriptDurationPreset(preset)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                            scriptDurationPreset === preset
                              ? 'border-accent-blue bg-accent-blue/10 text-primary-blue shadow-sm'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
                          }`}
                        >
                          {FLASH_SCRIPT_DURATION_LABEL[preset]}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 ml-1">
                      {gameProfileId === 'flower'
                        ? '作用于「全文脚本」、从灵感生成脚本及「混剪口播脚本」；「展示类脚本」与灵感列表不受影响。'
                        : '作用于「全文脚本」与从灵感生成脚本；「展示类脚本」与灵感列表不受影响。'}
                    </p>
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
                      isOther={isCustomSellingSelection(sellingPoint)}
                    />
                    <Dropdown 
                      label="画风选择 (选填)" 
                      options={STYLES} 
                      value={selectedStyle} 
                      onSelect={setSelectedStyle} 
                      customValue={customStyle}
                      onCustomChange={setCustomStyle}
                      isOther={isCustomStyleSelection(selectedStyle)}
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
                      isOther={hasCustomMoodSelection(selectedMoods)}
                      isMulti
                    />
                  </div>
                </div>
                </>
                ) : flashBookmark === 'voiceover' && creativeProfile.supportsVoiceoverFlash ? (
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-accent-blue" /> 简单提示词
                      </label>
                      <button
                        type="button"
                        onClick={() => handleSaveAsset('prompt', voPrompt, `vo_${voPrompt.slice(0, 20)}`)}
                        disabled={!voPrompt.trim()}
                        className="text-[10px] font-bold text-accent-blue flex items-center gap-1 hover:brightness-125 disabled:opacity-30 transition-all font-sans"
                      >
                        {saveStatus['prompt' + `vo_${voPrompt.slice(0, 20)}`] ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Bookmark className="w-3 h-3" />
                        )}
                        收藏提示词
                      </button>
                    </div>
                    <textarea
                      value={voPrompt}
                      onChange={(e) => setVoPrompt(e.target.value)}
                      placeholder="举例：游戏卖点（种花送番薯）+游戏玩法（只需要动动手指一键收花一键浇水，花园就能慢慢变漂亮）"
                      className="w-full h-40 bg-white border border-slate-200 rounded-[2rem] p-8 focus:border-accent-blue outline-none transition-all resize-none leading-relaxed text-slate-700 shadow-sm"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 ml-1">
                    <button
                      type="button"
                      aria-pressed={voFlowerGame}
                      onClick={() => setVoFlowerGame((v) => !v)}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 transition-all ${
                        voFlowerGame
                          ? 'border-accent-blue bg-accent-blue text-white shadow-md shadow-accent-blue/20'
                          : 'border-slate-200 bg-white text-slate-300 hover:border-accent-blue/50'
                      }`}
                    >
                      {voFlowerGame ? <CheckCircle2 className="w-5 h-5" /> : null}
                    </button>
                    <span className="text-sm font-bold text-primary-blue">种花游戏</span>
                    <span className="text-xs text-slate-400">勾选后可设定口播身份、场景与情绪</span>
                  </div>
                  {voFlowerGame ? (
                    <div className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50/90 p-6">
                      <VoiceOptionGroup
                        label="口播身份"
                        options={VOICE_IDENTITY_OPTIONS}
                        value={voIdentity}
                        onSelect={setVoIdentity}
                        otherValue={voIdentityOther}
                        onOtherChange={setVoIdentityOther}
                      />
                      <VoiceOptionGroup
                        label="场景选项"
                        options={VOICE_SCENE_OPTIONS}
                        value={voScene}
                        onSelect={setVoScene}
                        otherValue={voSceneOther}
                        onOtherChange={setVoSceneOther}
                      />
                      <VoiceOptionGroup
                        label="情绪"
                        options={VOICE_EMOTION_OPTIONS}
                        value={voEmotion}
                        onSelect={setVoEmotion}
                        otherValue={voEmotionOther}
                        onOtherChange={setVoEmotionOther}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2 ml-1">
                      <Timer className="w-4 h-4 text-accent-blue" /> 脚本时长
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {FLASH_SCRIPT_DURATION_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setScriptDurationPreset(preset)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                            scriptDurationPreset === preset
                              ? 'border-accent-blue bg-accent-blue/10 text-primary-blue shadow-sm'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
                          }`}
                        >
                          {FLASH_SCRIPT_DURATION_LABEL[preset]}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 ml-1">
                      控制口播篇幅，与「全文脚本」时长选项一致。
                    </p>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => void handleVoiceoverGenerate()}
                      disabled={isGenerating || !voPrompt.trim()}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-black bg-white px-8 py-4 font-black text-primary-blue shadow-xl transition-all hover:bg-slate-50 disabled:opacity-50"
                    >
                      {isGenerating && flashBookmark === 'voiceover' ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <Mic className="w-5 h-5" />
                      )}
                      生成口播脚本
                    </button>
                    {isGenerating && geminiRetryLabel ? (
                      <p className="mt-2 text-center text-[10px] text-slate-500">{geminiRetryLabel}</p>
                    ) : null}
                  </div>
                </div>
                ) : (
                <div className="space-y-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-accent-blue" /> 创意描述 / 画面需求
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveAsset('prompt', displayPrompt, `dsp_${displayPrompt.slice(0, 20)}`)
                        }
                        disabled={!displayPrompt.trim()}
                        className="text-[10px] font-bold text-accent-blue flex items-center gap-1 hover:brightness-125 disabled:opacity-30 transition-all font-sans"
                      >
                        {saveStatus['prompt' + `dsp_${displayPrompt.slice(0, 20)}`] ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Bookmark className="w-3 h-3" />
                        )}
                        收藏提示词
                      </button>
                    </div>
                    <div className="relative group">
                      <textarea
                        value={displayPrompt}
                        onChange={(e) => setDisplayPrompt(e.target.value)}
                        placeholder={flashDisplayPlaceholder}
                        className="w-full h-40 bg-white border border-slate-200 rounded-[2rem] p-8 pr-24 focus:border-accent-blue outline-none transition-all resize-none leading-relaxed text-slate-700 shadow-sm"
                      />
                      {displayPreview ? (
                        <div className="absolute top-4 right-4 flex flex-col gap-2">
                          <div className="relative h-20 w-20 overflow-hidden rounded-xl border-2 border-accent-blue shadow-lg group/dp">
                            <img src={displayPreview} alt="" className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={clearDisplayImage}
                              className="absolute right-1 top-1 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity group-hover/dp:opacity-100"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="absolute bottom-6 right-6 flex items-center gap-3">
                        <input
                          type="file"
                          id="display-ref-image"
                          accept="image/*"
                          className="hidden"
                          onChange={handleDisplayImageUpload}
                        />
                        <button
                          type="button"
                          onClick={() => document.getElementById('display-ref-image')?.click()}
                          className="rounded-2xl border-2 border-slate-200 bg-white p-3 text-slate-500 shadow-sm transition-all hover:border-accent-blue hover:text-accent-blue active:scale-95"
                          title="上传参考图"
                        >
                          <Upload className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDisplayGenerate()}
                          disabled={isGenerating || (!displayPrompt.trim() && !displayImage)}
                          className={`flex items-center gap-2 rounded-2xl border-2 px-6 py-3 font-bold shadow-lg transition-all active:scale-95 disabled:opacity-50 ${
                            isGenerating && flashBookmark === 'display'
                              ? 'scale-105 border-purple-600 bg-purple-600 text-white shadow-purple-600/20'
                              : 'border-purple-600 bg-white text-purple-600 hover:bg-purple-50'
                          }`}
                        >
                          {isGenerating && flashBookmark === 'display' ? (
                            <RefreshCw className="h-5 w-5 animate-spin" />
                          ) : (
                            <ImageIcon className="h-5 w-5" />
                          )}
                          生成画面与口令
                        </button>
                      </div>
                      {isGenerating && flashBookmark === 'display' && geminiRetryLabel ? (
                        <p className="absolute bottom-2 left-8 text-[10px] text-slate-500">{geminiRetryLabel}</p>
                      ) : null}
                    </div>
                  </div>

                  {displayOutput.trim() ? (
                    <div className="mt-10 space-y-6 border-t border-slate-100 pt-10">
                      <h3 className="text-primary-blue font-black tracking-tight text-lg">
                        动态口令卡片 · 全文制作脚本
                      </h3>
                      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
                        <div className="min-w-0 space-y-6">
                          <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm open:ring-2 open:ring-accent-blue/10">
                            <summary className="cursor-pointer list-none px-5 py-3 text-xs font-black text-primary-blue marker:content-none [&::-webkit-details-marker]:hidden">
                              画面描述（点击展开）
                            </summary>
                            <div className="max-h-44 overflow-y-auto border-t border-slate-100 px-5 py-4 text-xs leading-relaxed text-slate-600 custom-scrollbar">
                              {displayParsedDescription ||
                                '（未解析到独立段落，请参考下方「原始 Markdown」）'}
                            </div>
                          </details>
                          <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <summary className="cursor-pointer px-5 py-3 text-xs font-black text-slate-600">
                              原始「画面与口令」Markdown
                            </summary>
                            <div className="space-y-3 border-t border-slate-100 p-4">
                              <p className="text-[10px] text-slate-400">
                                可在此复制全文，或点击下方收藏为「画面与口令」资产。
                              </p>
                              <textarea
                                readOnly
                                value={displayOutput}
                                className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[10px] leading-relaxed text-slate-700 outline-none"
                              />
                              <div className="flex flex-wrap gap-2">
                                <ActionButton
                                  onClick={() => handleCopy(displayOutput)}
                                  icon={<Copy className="w-4 h-4" />}
                                  label="复制原文"
                                />
                                <ActionButton
                                  onClick={() =>
                                    void handleSaveAsset(
                                      'visual_detail',
                                      displayOutput,
                                      (displayPrompt.trim().slice(0, 15) || '画面') + '_画面与口令',
                                    )
                                  }
                                  icon={
                                    saveStatus[
                                      'visual_detail' +
                                        (displayPrompt.trim().slice(0, 15) || '画面') +
                                        '_画面与口令'
                                    ] ? (
                                      <CheckCircle2 className="w-4 h-4" />
                                    ) : (
                                      <Bookmark className="w-4 h-4" />
                                    )
                                  }
                                  label="收藏画面与口令"
                                  active={
                                    saveStatus[
                                      'visual_detail' +
                                        (displayPrompt.trim().slice(0, 15) || '画面') +
                                        '_画面与口令'
                                    ]
                                  }
                                />
                              </div>
                            </div>
                          </details>
                          <div className="space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              选择感兴趣的动态口令（共 5 条）
                            </p>
                            <div className="flex w-full min-w-0 flex-col gap-3">
                              {[0, 1, 2, 3, 4].map((i) => {
                                const card = (displayMotionCards[i] ?? '').trim();
                                const has = Boolean(card);
                                return (
                                  <button
                                    key={`motion-card-${i}`}
                                    type="button"
                                    disabled={!has}
                                    onClick={() => has && setSelectedMotionCardIndex(i)}
                                    className={`w-full min-w-0 rounded-2xl border-2 p-4 text-left transition-all ${
                                      !has
                                        ? 'cursor-not-allowed border-dashed border-slate-200 bg-slate-50 text-slate-400'
                                        : selectedMotionCardIndex === i
                                          ? 'border-accent-blue bg-accent-blue/10 ring-2 ring-accent-blue/30 shadow-md'
                                          : 'border-slate-200 bg-white hover:border-accent-blue/40'
                                    }`}
                                  >
                                    <span className="font-black text-accent-blue text-[10px]">口令 {i + 1}</span>
                                    <p className="mt-2 w-full min-w-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">
                                      {has ? card : '（模型未输出此项或格式未识别）'}
                                    </p>
                                  </button>
                                );
                              })}
                            </div>
                            {filledMotionCardCount === 0 ? (
                              <p className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                                未能解析出编号口令。请确认模型输出含「### 动态口令」与「1. …」至「5. …」格式，或直接使用上方原始全文参考。
                              </p>
                            ) : null}
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                              期望成片时长（秒）
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={600}
                              placeholder="例如 15"
                              value={displayProductionSeconds}
                              onChange={(e) => setDisplayProductionSeconds(e.target.value)}
                              className="w-full max-w-[12rem] rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-primary-blue outline-none focus:border-accent-blue"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDisplayProductionGenerate()}
                            disabled={
                              isGeneratingDisplayProduction ||
                              selectedMotionCardIndex === null ||
                              !displayProductionSeconds.trim()
                            }
                            className="flex w-full max-w-md items-center justify-center gap-2 rounded-2xl border-2 border-black bg-white px-6 py-4 font-black text-primary-blue shadow-xl transition-all hover:bg-slate-50 disabled:opacity-50"
                          >
                            {isGeneratingDisplayProduction ? (
                              <RefreshCw className="h-5 w-5 animate-spin" />
                            ) : (
                              <FileText className="h-5 w-5" />
                            )}
                            生成全文脚本
                          </button>
                          {isGeneratingDisplayProduction && geminiRetryLabel ? (
                            <p className="text-[10px] text-slate-500">{geminiRetryLabel}</p>
                          ) : null}
                        </div>
                        <div className="relative flex min-h-[320px] flex-col rounded-[2rem] border border-slate-200 bg-slate-50 p-6 shadow-inner">
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4">
                            <h4 className="text-xs font-black uppercase tracking-widest text-accent-blue">
                              右侧 · 全文制作脚本
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              <ActionButton
                                onClick={() =>
                                  displayProductionScript.trim() &&
                                  setIsEditingDisplayProduction(!isEditingDisplayProduction)
                                }
                                icon={<FileText className="w-4 h-4" />}
                                label={isEditingDisplayProduction ? '预览' : '编辑'}
                                disabled={!displayProductionScript.trim()}
                              />
                              <ActionButton
                                onClick={() =>
                                  displayProductionScript.trim() && handleCopy(displayProductionScript)
                                }
                                icon={<Copy className="w-4 h-4" />}
                                label="复制"
                                disabled={!displayProductionScript.trim()}
                              />
                              <ActionButton
                                onClick={() =>
                                  void handleSaveAsset(
                                    'full_script',
                                    displayProductionScript,
                                    displayProductionAssetTitle,
                                    ['展示制作脚本'],
                                  )
                                }
                                icon={
                                  saveStatus['full_script' + displayProductionAssetTitle] ? (
                                    <CheckCircle2 className="w-4 h-4" />
                                  ) : (
                                    <Bookmark className="w-4 h-4" />
                                  )
                                }
                                label="收藏脚本"
                                active={saveStatus['full_script' + displayProductionAssetTitle]}
                                disabled={!displayProductionScript.trim()}
                              />
                            </div>
                          </div>
                          {!displayProductionScript.trim() ? (
                            <p className="flex-1 text-sm leading-relaxed text-slate-400">
                              左侧点选一条口令卡片，填写期望成片秒数，点击「生成全文脚本」。生成内容将包含运镜、动态细节分镜、环境氛围与配音/音效建议，以自然段为主；末行单独为：【自动根据剧情匹配合适的音效】。
                            </p>
                          ) : isEditingDisplayProduction ? (
                            <textarea
                              value={displayProductionScript}
                              onChange={(e) => setDisplayProductionScript(e.target.value)}
                              className="min-h-[280px] w-full flex-1 resize-none rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 outline-none focus:border-accent-blue/40"
                            />
                          ) : (
                            <div className="markdown-body prose prose-slate prose-sm max-w-none flex-1 overflow-y-auto">
                              <Markdown>{displayProductionScript}</Markdown>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <p className="text-[11px] text-slate-400 ml-1">
                    输出为 Markdown：「画面描述」+ 恰好 5 条互不相同的「动态口令」，适用于 Seedance / Runway 等；要求与此前画面描述能力一致。
                  </p>
                </div>
                )}

                <AnimatePresence>
                  {flashBookmark === 'storyboard' && inspirations.length > 0 && (
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
                            className={`p-6 rounded-[2rem] border transition-all group relative overflow-hidden ${activeInspirationIndex === i ? 'bg-accent-blue/5 border-accent-blue ring-4 ring-accent-blue/5' : 'bg-white border-slate-200 hover:border-accent-blue/30'}`}
                          >
                            {isGenerating && activeInspirationIndex === i ? (
                              <div
                                className="absolute inset-0 z-20 flex items-center justify-center rounded-[2rem] bg-white/85 backdrop-blur-[2px]"
                                aria-live="polite"
                                aria-busy="true"
                              >
                                <p className="text-sm font-black text-primary-blue tracking-tight">脚本生成中...</p>
                              </div>
                            ) : null}
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
                                  type="button"
                                  onClick={() => handleGenerateFromInspiration(i)}
                                  disabled={isGenerating}
                                  title="基于此灵感生成脚本"
                                  className="group/script flex flex-col items-center justify-center gap-0.5 min-w-[3.5rem] px-2 py-1 rounded-xl border border-transparent text-slate-400 transition-all duration-200 hover:scale-105 hover:border-primary-blue hover:bg-primary-blue hover:text-white active:scale-100 disabled:pointer-events-none disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-transparent disabled:hover:border-transparent disabled:hover:text-slate-400"
                                >
                                  <FileText className="w-4 h-4 shrink-0" />
                                  <span className="text-[9px] font-black leading-tight text-center max-h-0 opacity-0 overflow-hidden group-hover/script:max-h-5 group-hover/script:opacity-100 transition-all duration-200">
                                    生成脚本
                                  </span>
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

                  {flashBookmark !== 'display' && activeFlashScript.trim() && (
                    <motion.div
                      key="generated-script-display"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-12 space-y-6 pt-10 border-t border-white/5"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-accent-blue font-black uppercase tracking-widest text-sm flex items-center gap-2">
                          {flashBookmark === 'voiceover' ? (
                            <Mic className="w-4 h-4" />
                          ) : (
                            <Zap className="w-4 h-4" />
                          )}
                          {flashBookmark === 'voiceover' ? 'AI 口播台词：' : 'AI 生成脚本：'}
                        </h3>
                        <div className="flex items-center gap-2">
                          <ActionButton 
                            onClick={() => setIsEditing(!isEditing)} 
                            icon={<FileText className="w-4 h-4" />} 
                            label={isEditing ? '预览' : '人工编辑'} 
                          />
                          <ActionButton 
                            onClick={() => handleCopy(activeFlashScript)} 
                            icon={<Copy className="w-4 h-4" />} 
                            label="脚本复制" 
                          />
                          <ActionButton 
                            onClick={() => {
                              const defaultTitle =
                                flashBookmark === 'voiceover'
                                  ? `口播_${(voPrompt.trim().slice(0, 15) || '脚本')}`
                                  : activeInspirationIndex !== null
                                    ? inspirations[activeInspirationIndex].title + '_脚本'
                                    : prompt.slice(0, 15) + '_全文';
                              handleSaveAsset('full_script', activeFlashScript, defaultTitle);
                            }} 
                            icon={
                              saveStatus[
                                'full_script' +
                                  (flashBookmark === 'voiceover'
                                    ? `口播_${(voPrompt.trim().slice(0, 15) || '脚本')}`
                                    : activeInspirationIndex !== null
                                      ? inspirations[activeInspirationIndex].title + '_脚本'
                                      : prompt.slice(0, 15) + '_全文')
                              ] ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : (
                                <Bookmark className="w-4 h-4" />
                              )
                            } 
                            label="脚本收藏" 
                            active={
                              saveStatus[
                                'full_script' +
                                  (flashBookmark === 'voiceover'
                                    ? `口播_${(voPrompt.trim().slice(0, 15) || '脚本')}`
                                    : activeInspirationIndex !== null
                                      ? inspirations[activeInspirationIndex].title + '_脚本'
                                      : prompt.slice(0, 15) + '_全文')
                              ]
                            }
                          />
                        </div>
                      </div>

                      <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-200 shadow-inner group relative">
                        {isEditing ? (
                          <textarea
                            value={activeFlashScript}
                            onChange={(e) => {
                              if (flashBookmark === 'storyboard') setGeneratedScript(e.target.value);
                              else if (flashBookmark === 'voiceover') setVoiceoverScript(e.target.value);
                              else setDisplayOutput(e.target.value);
                            }}
                            className="w-full min-h-[300px] bg-transparent border-none outline-none resize-none text-slate-700 font-sans leading-relaxed text-lg"
                          />
                        ) : (
                          <div className="markdown-body prose prose-slate prose-blue max-w-none">
                            <Markdown>{activeFlashScript}</Markdown>
                          </div>
                        )}
                      </div>

                      {flashBookmark === 'storyboard' ? (
                        <FlashScriptDiagnosisPanel
                          data={scriptDiagnosis}
                          loading={scriptDiagnosisLoading}
                          error={scriptDiagnosisError}
                        />
                      ) : null}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
                </div>
                <aside className="flex flex-row flex-wrap justify-center gap-2 lg:flex-col lg:items-stretch lg:justify-start lg:w-44 xl:w-48 shrink-0 lg:border-l lg:border-slate-200 lg:pl-6">
                  <p className="hidden lg:block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 w-full">
                    书签
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFlashBookmark('storyboard');
                      setIsEditing(false);
                      setIsEditingDisplayProduction(false);
                    }}
                    className={`flex items-center gap-2 rounded-2xl border-2 px-4 py-3 text-left text-xs font-black transition-all ${
                      flashBookmark === 'storyboard'
                        ? 'border-accent-blue bg-accent-blue/10 text-primary-blue shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
                    }`}
                  >
                    <Bookmark className="w-4 h-4 shrink-0 text-accent-blue" />
                    分镜脚本
                  </button>
                  {creativeProfile.supportsVoiceoverFlash ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFlashBookmark('voiceover');
                        setIsEditing(false);
                        setIsEditingDisplayProduction(false);
                      }}
                      className={`flex items-center gap-2 rounded-2xl border-2 px-4 py-3 text-left text-xs font-black transition-all ${
                        flashBookmark === 'voiceover'
                          ? 'border-accent-blue bg-accent-blue/10 text-primary-blue shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
                      }`}
                    >
                      <Mic className="w-4 h-4 shrink-0 text-accent-blue" />
                      混剪口播脚本
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setFlashBookmark('display');
                      setIsEditing(false);
                      setIsEditingDisplayProduction(false);
                    }}
                    className={`flex items-center gap-2 rounded-2xl border-2 px-4 py-3 text-left text-xs font-black transition-all ${
                      flashBookmark === 'display'
                        ? 'border-accent-blue bg-accent-blue/10 text-primary-blue shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
                    }`}
                  >
                    <ImageIcon className="h-4 w-4 shrink-0 text-accent-blue" />
                    展示类脚本
                  </button>
                </aside>
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
              <ContentIteration
                handoff={iterationHandoff}
                onHandoffConsumed={onIterationHandoffConsumed}
              />
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

function VoiceOptionGroup({
  label,
  options,
  value,
  onSelect,
  otherValue,
  onOtherChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onSelect: (v: string) => void;
  otherValue: string;
  onOtherChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] block">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={`rounded-xl border-2 px-3 py-2 text-xs font-bold transition-all ${
              value === opt
                ? 'border-accent-blue bg-accent-blue/10 text-primary-blue shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      {value === '其他' ? (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="请填写"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-accent-blue/50"
        />
      ) : null}
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
  disabled?: boolean;
}

function ActionButton({ onClick, icon, label, active, disabled }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${active ? 'bg-accent-blue text-white border-accent-blue' : 'bg-white border-slate-200 text-slate-500 hover:text-primary-blue hover:bg-slate-50 hover:border-slate-300'} ${disabled ? 'pointer-events-none opacity-40' : ''}`}
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
