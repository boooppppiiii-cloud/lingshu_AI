import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Play, Sparkles, FileText, Layout as LayoutIcon,
  TrendingUp, Clock, Globe, ChevronDown, X, Loader2,
  Check, Copy, ArrowRight, Zap, LayoutGrid, List, ArrowUp,
  Lightbulb, Tag, Flame, BarChart2, ChevronRight, Film, Download, Plus,
} from 'lucide-react';
import { studioApi } from '../lib/studioApi';

// 0627 mock 视频的指定脚本分析（点击「生成脚本」直接输出）
const SCRIPT_0627 = `【分析摘要】
指定画风：真人 3D 写实风格
核心情绪：治愈、惊喜
竞品识别：Spatula applicator；KoGarden（唇膏制作设备品牌）；Louis Vuitton（手袋图案参考，非产品合作）

【分镜脚本】
[0.2s] 特写；固定镜头；女性（Aylen Park）手持一支浅色粉底液管，正用刮刀状工具将产品轻刮至右脸颊；字幕："perfect formula for your skin… just look at that shade match 😍"；她面带微笑，眼神专注；背景为厨房环境，光线明亮自然。

[1.0s] 中景；轻微推近；她继续用刮刀在脸颊上轻抹，同时转向镜头说话；字幕续："It's like I'm wearing anything, nothing 😌"；手指甲为法式延长甲，涂白色亮面；表情轻松愉悦。

[2.0s] 近景；固定；她放下刮刀，拿起粉底液管展示正面；字幕："soo see I'm wearing anything. There, a foundation that comes with a built in spatula applicator 🥄"；她用拇指推开管盖，露出内置刮刀结构；动作流畅自信。

[4.0s] 特写；微晃动；她抽出内置刮刀，展示其木质手柄与金属刮片；字幕续："This ensures you always get an even application without looking cakey 🎂"；刮刀尖端沾有少量粉底；她眯眼笑，强调"even application"。

[7.0s] 中景；固定；她将刮刀蘸取粉底后，在左脸颊由内向外轻推涂抹；字幕："an even application without looking cakey 🎂"；皮肤呈现自然光泽感；动作轻柔，无拉扯痕迹。

[10.0s] 近景；固定；她展示已上妆的双颊对比（左未涂/右已涂），手指轻点右脸；字幕："always get an even application without looking cakey 🎂"；表情满意，略点头。

[11.0s] 中景；镜头下移；她双手举起一个黑色圆柱形设备，顶部有银色旋盖；字幕："4. This custom lipstick making device 🔴"；设备印有白色 KoGarden 字样；她笑容扩大，眼神兴奋。

[13.0s] 特写；手持旋转；她打开设备顶盖，露出内部卡槽结构；字幕："There are tons of cartridges that you can insert to create your perfect custom lip and blush shade 💋"；她用指尖轻触卡槽边缘。

[14.0s] 近景；快速切换；她左手持设备，右手持三支红色系唇膏胶囊（红、粉红、深红），依次插入设备卡槽；字幕续："to create your perfect custom lip and blush shade 💋"；动作精准，胶囊卡入时发出轻微"咔"声（音效模拟）。`;

// ── Cover images via glob ─────────────────────────────────────────────────────
const _mods = import.meta.glob('../assets/covers/mock-*.png', {
  eager: true,
}) as Record<string, { default: string }>;
const C = (n: number): string => _mods[`../assets/covers/mock-${n}.png`]?.default ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────
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
  videoUrl?: string;  // 真实视频（有则卡片直接播放）
}

interface StructureStep { time: string; label: string; desc: string }
interface ScriptAnalysis {
  videoType: string;
  hookType: string;
  hookLine: string;
  hookStrategy: string;
  structure: StructureStep[];
  whyTrending: string[];
  productFit: string[];
  adaptTip: string;
  viralScore: number;
  emotion: string;
  infoSpeed: string;
}

// ── Platform meta ─────────────────────────────────────────────────────────────
const PLATFORM_META: Record<Exclude<Platform, 'all'>, { label: string; color: string; bg: string }> = {
  tiktok:    { label: 'TikTok',    color: '#fff', bg: '#010101' },
  instagram: { label: 'Instagram', color: '#fff', bg: '#c13584' },
  youtube:   { label: 'YouTube',   color: '#fff', bg: '#ff0000' },
  facebook:  { label: 'Facebook',  color: '#fff', bg: '#1877f2' },
  pinterest: { label: 'Pinterest', color: '#fff', bg: '#e60023' },
};

const PLATFORM_FILTERS: { id: Platform; label: string }[] = [
  { id: 'all',       label: '全部平台' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'facebook',  label: 'Facebook' },
  { id: 'pinterest', label: 'Pinterest' },
];

const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' }, { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' }, { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },   { code: 'ko', label: '한국어' },
];

// ── 50 mock videos ────────────────────────────────────────────────────────────
const MOCK_VIDEOS: TrendVideo[] = [
  // ── TikTok (9:16) ──────────────────────────────────────────────────────────
  { id: 'mock0627', platform: 'tiktok', thumbnail: '', videoUrl: '/demo/mock-0627.mp4', duration: 16, views: '1.2M', trend: 'hot', tags: ['beauty', 'foundation', 'makeup'], title: '粉底内置刮刀 + 定制唇膏机 · 真人3D种草' },
  { id: '1',  platform: 'tiktok',    thumbnail: C(5),  duration: 47,  views: '2.4M', trend: 'hot',    tags: ['travel', 'lifestyle', 'hack'],          title: 'How I packed 2 weeks into a carry-on — minimalist travel hack' },
  { id: '4',  platform: 'tiktok',    thumbnail: C(6),  duration: 32,  views: '3.7M', trend: 'hot',    tags: ['organization', 'workspace'],             title: 'This $12 organizer changed my entire desk setup' },
  { id: '9',  platform: 'tiktok',    thumbnail: C(7),  duration: 28,  views: '1.8M', trend: 'rising', tags: ['tech', 'travel', 'charging'],            title: 'Portable charger that saved my road trip' },
  { id: '11', platform: 'tiktok',    thumbnail: C(9),  duration: 54,  views: '5.1M', trend: 'hot',    tags: ['skincare', 'beauty', 'routine'],         title: 'Morning skincare is costing you more than you think' },
  { id: '12', platform: 'tiktok',    thumbnail: C(10), duration: 38,  views: '920K', trend: 'rising', tags: ['haircare', 'beauty', 'haul'],            title: 'Hair products I\'d buy again vs never touch again' },
  { id: '13', platform: 'tiktok',    thumbnail: C(11), duration: 22,  views: '6.3M', trend: 'hot',    tags: ['summer', 'gadget', 'viral'],             title: 'This $8 fan changed my summer completely' },
  { id: '14', platform: 'tiktok',    thumbnail: C(12), duration: 31,  views: '4.0M', trend: 'hot',    tags: ['kitchen', 'gadget', 'hack'],             title: 'I chopped 5 cups of onions in 30 seconds — no tears' },
  { id: '15', platform: 'tiktok',    thumbnail: C(14), duration: 43,  views: '1.2M', trend: 'rising', tags: ['sunscreen', 'skincare', 'summer'],       title: 'Sunscreen I will repurchase forever — honest review' },
  { id: '16', platform: 'tiktok',    thumbnail: C(16), duration: 29,  views: '8.9M', trend: 'hot',    tags: ['makeup', 'beauty', 'transformation'],    title: '5 minutes → red lip transformation that turns heads' },
  { id: '17', platform: 'tiktok',    thumbnail: C(17), duration: 61,  views: '2.1M', trend: 'rising', tags: ['pets', 'dog', 'accessories'],            title: 'Dog accessories haul — spoiling my golden retriever' },
  { id: '18', platform: 'tiktok',    thumbnail: C(19), duration: 35,  views: '3.3M', trend: 'hot',    tags: ['food', 'healthy', 'recipe'],             title: 'Aesthetic breakfast in 10 minutes or less' },
  { id: '19', platform: 'tiktok',    thumbnail: C(20), duration: 47,  views: '990K', trend: 'stable', tags: ['smallbiz', 'packaging', 'asmr'],         title: 'Packing orders ASMR — small business life' },
  { id: '20', platform: 'tiktok',    thumbnail: C(22), duration: 52,  views: '2.8M', trend: 'hot',    tags: ['organization', 'kitchen', 'hack'],       title: 'How I organized my entire kitchen for under $50' },
  { id: '21', platform: 'tiktok',    thumbnail: C(23), duration: 39,  views: '1.5M', trend: 'rising', tags: ['homefragrance', 'candle', 'review'],     title: 'Ranking every home scent I own from worst to best' },
  { id: '22', platform: 'tiktok',    thumbnail: C(18), duration: 55,  views: '740K', trend: 'stable', tags: ['fashion', 'wardrobe', 'capsule'],        title: 'Capsule wardrobe reveal — 30 outfits, 15 pieces' },

  // ── Instagram (portrait) ───────────────────────────────────────────────────
  { id: '2',  platform: 'instagram', thumbnail: C(3),  duration: 60,  views: '890K', trend: 'hot',    tags: ['skincare', 'beauty', 'budget'],          title: 'Morning skincare routine under $30 total' },
  { id: '6',  platform: 'instagram', thumbnail: C(4),  duration: 45,  views: '720K', trend: 'rising', tags: ['tech', 'setup', 'aesthetic'],            title: 'Aesthetic cable management — hide the mess' },
  { id: '10', platform: 'instagram', thumbnail: C(5),  duration: 55,  views: '450K', trend: 'stable', tags: ['home', 'wellness', 'comparison'],        title: 'Unboxing: $40 diffuser vs $200 diffuser' },
  { id: '23', platform: 'instagram', thumbnail: C(13), duration: 72,  views: '1.1M', trend: 'hot',    tags: ['workspace', 'homeoffice', 'setup'],      title: 'My dream WFH setup — all sources linked' },
  { id: '24', platform: 'instagram', thumbnail: C(15), duration: 48,  views: '830K', trend: 'rising', tags: ['fitness', 'transformation', 'workout'],  title: '90 day fitness check-in — what actually worked' },
  { id: '25', platform: 'instagram', thumbnail: C(21), duration: 63,  views: '560K', trend: 'stable', tags: ['jewelry', 'fashion', 'collection'],      title: 'Full jewelry collection tour — from basics to statement' },
  { id: '26', platform: 'instagram', thumbnail: C(39), duration: 44,  views: '1.4M', trend: 'hot',    tags: ['perfume', 'fragrance', 'luxury'],        title: 'Perfume collection — my top 10 signature scents' },
  { id: '27', platform: 'instagram', thumbnail: C(40), duration: 58,  views: '640K', trend: 'rising', tags: ['bedroom', 'decor', 'transformation'],    title: 'Bedroom transformation — $300 glow-up' },
  { id: '28', platform: 'instagram', thumbnail: C(41), duration: 75,  views: '920K', trend: 'hot',    tags: ['mealprep', 'healthy', 'food'],           title: 'Healthy meal prep Sunday — full week in 2 hours' },
  { id: '29', platform: 'instagram', thumbnail: C(43), duration: 52,  views: '780K', trend: 'rising', tags: ['skincare', 'routine', 'ingredients'],    title: 'Building a skincare routine from scratch in 2024' },
  { id: '30', platform: 'instagram', thumbnail: C(44), duration: 41,  views: '1.0M', trend: 'hot',    tags: ['travel', 'beach', 'packing'],            title: 'Everything I\'m packing for Bali — beach essentials' },
  { id: '31', platform: 'instagram', thumbnail: C(46), duration: 49,  views: '550K', trend: 'stable', tags: ['fashion', 'styling', 'accessories'],     title: 'How I style the same accessories 5 different ways' },
  { id: '32', platform: 'instagram', thumbnail: C(47), duration: 66,  views: '2.2M', trend: 'hot',    tags: ['wellness', 'morning', 'selfcare'],       title: 'Morning routine that changed my mental health' },

  // ── YouTube (16:9) ────────────────────────────────────────────────────────
  { id: '3',  platform: 'youtube',   thumbnail: C(1),  duration: 183, views: '1.1M', trend: 'rising', tags: ['amazon', 'kitchen', 'review'],           title: 'Testing viral Amazon kitchen gadgets so you don\'t have to' },
  { id: '8',  platform: 'youtube',   thumbnail: C(8),  duration: 241, views: '4.2M', trend: 'hot',    tags: ['aliexpress', 'challenge', 'review'],     title: 'I used only aliexpress products for 30 days' },
  { id: '33', platform: 'youtube',   thumbnail: C(24), duration: 312, views: '890K', trend: 'hot',    tags: ['gadgets', 'review', 'viral'],            title: 'I Bought 10 Viral Products — Here\'s What Actually Worked' },
  { id: '34', platform: 'youtube',   thumbnail: C(25), duration: 728, views: '3.6M', trend: 'hot',    tags: ['phone', 'comparison', 'budget'],         title: 'Budget Phone vs Flagship — Is the Extra $500 Worth It?' },
  { id: '35', platform: 'youtube',   thumbnail: C(26), duration: 543, views: '1.4M', trend: 'rising', tags: ['speaker', 'audio', 'review'],            title: 'Best Bluetooth Speakers Under $50 — Full Comparison' },
  { id: '36', platform: 'youtube',   thumbnail: C(27), duration: 392, views: '2.1M', trend: 'hot',    tags: ['amazon', 'haul', 'deals'],               title: 'I Bought $500 Worth of Amazon Deals — Was It Worth It?' },
  { id: '37', platform: 'youtube',   thumbnail: C(28), duration: 617, views: '760K', trend: 'rising', tags: ['airfryer', 'recipe', 'cooking'],         title: 'Every Air Fryer Recipe I\'ve Made This Month (30 recipes)' },
  { id: '38', platform: 'youtube',   thumbnail: C(29), duration: 1089,views: '5.8M', trend: 'hot',    tags: ['viral', 'test', 'honest'],               title: 'Bought It So You Don\'t Have To — 15 Viral Products Tested' },
  { id: '39', platform: 'youtube',   thumbnail: C(30), duration: 445, views: '1.9M', trend: 'rising', tags: ['homeoffice', 'organization', 'before'],  title: 'Home Office Transformation: Before vs After (Satisfying)' },
  { id: '40', platform: 'youtube',   thumbnail: C(31), duration: 521, views: '680K', trend: 'stable', tags: ['travel', 'kit', 'essentials'],           title: 'My Complete Carry-On Travel Kit 2024 (Everything I Need)' },
  { id: '41', platform: 'youtube',   thumbnail: C(32), duration: 893, views: '3.0M', trend: 'hot',    tags: ['skincare', 'dupe', 'comparison'],        title: 'Drugstore Dupe vs High-End Skincare — Brutally Honest Test' },
  { id: '42', platform: 'youtube',   thumbnail: C(33), duration: 668, views: '1.2M', trend: 'rising', tags: ['fitness', 'homegym', 'equipment'],       title: 'Best Home Gym Equipment Under $100 — Full Review' },

  // ── Facebook (16:9) ───────────────────────────────────────────────────────
  { id: '5',  platform: 'facebook',  thumbnail: C(2),  duration: 94,  views: '540K', trend: 'stable', tags: ['kitchen', 'food', 'review'],             title: 'Why everyone in my family is obsessed with this air fryer' },
  { id: '43', platform: 'facebook',  thumbnail: C(34), duration: 178, views: '430K', trend: 'rising', tags: ['car', 'accessories', 'tech'],            title: '5 Car Gadgets Every Driver Needs — Honest Review' },
  { id: '44', platform: 'facebook',  thumbnail: C(35), duration: 246, views: '870K', trend: 'hot',    tags: ['skincare', 'antiaging', 'women'],        title: 'Complete Anti-Aging Skincare Routine for 40+ Women' },
  { id: '45', platform: 'facebook',  thumbnail: C(36), duration: 391, views: '2.4M', trend: 'hot',    tags: ['temu', 'amazon', 'comparison'],          title: 'I Ordered from Temu for the First Time — Brutally Honest Review' },
  { id: '46', platform: 'facebook',  thumbnail: C(37), duration: 213, views: '660K', trend: 'rising', tags: ['kids', 'toys', 'parenting'],             title: 'Best Educational Toys for Toddlers 2024 — Mom-Tested' },
  { id: '47', platform: 'facebook',  thumbnail: C(38), duration: 304, views: '490K', trend: 'stable', tags: ['bedroom', 'decor', 'budget'],            title: 'Bedroom Makeover for Under $200 — Full Transformation' },
  { id: '48', platform: 'facebook',  thumbnail: C(42), duration: 188, views: '1.1M', trend: 'hot',    tags: ['fitness', 'workout', 'noequipment'],     title: '30-Day Home Workout Challenge — No Equipment Needed' },

  // ── Pinterest (3:4) ───────────────────────────────────────────────────────
  { id: '7',  platform: 'pinterest', thumbnail: C(4),  duration: 78,  views: '310K', trend: 'stable', tags: ['wedding', 'diy', 'decor'],               title: 'DIY wedding decoration inspo — under $200 total' },
  { id: '49', platform: 'pinterest', thumbnail: C(45), duration: 92,  views: '250K', trend: 'rising', tags: ['pantry', 'organization', 'kitchen'],     title: 'Pantry Organization That Transforms Your Entire Kitchen' },
  { id: '50', platform: 'pinterest', thumbnail: C(50), duration: 114, views: '190K', trend: 'stable', tags: ['craft', 'diy', 'embroidery'],            title: 'Beginner Embroidery Starter Kit — What You Actually Need' },
];

// ── Script analysis mock data (3 templates + 1 detailed) ─────────────────────
const ANALYSIS_TEMPLATES: Record<string, ScriptAnalysis> = {
  tiktok: {
    videoType: '口播展示型',
    hookType: '认知颠覆型',
    hookLine: '"Stop buying skincare products — you\'ve been using them in the wrong order."',
    hookStrategy: '用否定句打破观众固有认知，激发防御性观看欲望（"为什么我是错的？"）',
    structure: [
      { time: '0–3s',   label: '钩子',    desc: '否定观众现有行为，一句话制造认知冲突' },
      { time: '3–10s',  label: '痛点放大', desc: '展示"用错方法"带来的问题和损失感' },
      { time: '10–38s', label: '干货输出', desc: '5步正确方法，每步3-4秒，节奏紧凑' },
      { time: '38–45s', label: '结果验证', desc: '展示前后对比，或权威数据背书' },
      { time: '45–54s', label: 'CTA',      desc: '"Follow for more skincare science"' },
    ],
    whyTrending: [
      '开头否定句触发防御性观看，完播率极高',
      '干货密度高：每3秒一个信息点，信息价值密度领先同类内容',
      '话题普适性强：美妆护肤跨年龄跨地域共鸣',
      '视觉节奏快：产品特写 + 操作示范交替剪辑',
    ],
    productFit: ['护肤品', '美妆工具', '个护套装', '洁面仪', '精华液'],
    adaptTip: '将"护肤顺序错误"换为你的产品解决的核心问题，保留"否定开头 → 干货输出 → 结果展示"三段结构，关键是让观众在前3秒感到被说中了',
    viralScore: 92,
    emotion: '实用惊喜',
    infoSpeed: '高密度',
  },
  youtube: {
    videoType: '开箱评测型',
    hookType: '悬念测试型',
    hookLine: '"I spent $500 on Amazon deals last month — here\'s what I never expected to find."',
    hookStrategy: '大金额 + 意外发现，引发好奇：到底买到了什么？值不值？',
    structure: [
      { time: '0–15s',   label: '钩子',    desc: '大金额引发好奇 + 预告"意外发现"' },
      { time: '15–45s',  label: '背景铺垫', desc: '建立可信度：为什么要做这个测试' },
      { time: '45s–6m',  label: '逐一评测', desc: '每件产品约30秒：外观→功能→实测→评分' },
      { time: '6m–8m',   label: '对比总结', desc: '性价比排名 + 推荐/不推荐结论' },
      { time: '8m–9m',   label: 'CTA',      desc: '链接在简介 + 订阅 + 问题互动' },
    ],
    whyTrending: [
      '替用户花钱测试，降低购买决策成本，实用价值极高',
      '大金额数字在标题和钩子里制造仪式感',
      '多产品评测增加完播率：看完才知道哪个最好',
      '评分机制量化比较，降低用户自己判断的认知负担',
    ],
    productFit: ['跨境电商商品', '家居好物', '数码配件', '厨房工具', '收纳产品'],
    adaptTip: '用你的产品作为"测试产品之一"出现在评测中，或联系博主置换，让产品在自然对比中脱颖而出',
    viralScore: 87,
    emotion: '替代决策',
    infoSpeed: '中密度',
  },
  instagram: {
    videoType: '生活方式型',
    hookType: '视觉吸引型',
    hookLine: '"This is what my morning routine looks like after I stopped rushing."',
    hookStrategy: '展示理想化生活状态，激发观众想要复制的欲望（FOMO + 向往感）',
    structure: [
      { time: '0–4s',   label: '画面钩子', desc: '精美画面开场，无台词，靠视觉留人' },
      { time: '4–20s',  label: '场景建立', desc: '展示理想化日常场景，建立情绪基调' },
      { time: '20–48s', label: '产品融入', desc: '自然地将产品融入生活场景，非硬广' },
      { time: '48–58s', label: '情绪收尾', desc: '轻松结尾，传达生活质感' },
      { time: '58–66s', label: 'CTA',      desc: '"Link in bio for all my favorites"' },
    ],
    whyTrending: [
      '视觉美学触发保存行为，有机传播率高',
      '生活方式内容引发身份认同：我也想这样生活',
      '产品自然融入，广告感低，互动率高',
      '早晨/日常routine话题具有强周期复利效应',
    ],
    productFit: ['家居装饰', '早餐食品', '美妆护肤', '运动健康', '香薰蜡烛'],
    adaptTip: '将产品拍摄成"理想生活"的一部分，而非产品本身，注重色调统一和光线质感，让产品看起来"属于"这个生活场景',
    viralScore: 79,
    emotion: '向往共鸣',
    infoSpeed: '低密度',
  },
};

// Video 11 gets a specific detailed analysis (the 口播视频 example)
const ANALYSIS_OVERRIDES: Record<string, Partial<ScriptAnalysis>> = {
  '11': {
    hookLine: '"Stop buying skincare products until you watch this — you\'re throwing money away."',
    hookStrategy: '双重否定（stop buying + throwing money）在前3秒同时触发损失厌恶和好奇心',
    structure: [
      { time: '0–3s',   label: '钩子',    desc: '"Stop buying..." 否定句 + 损失感，强迫停止滑动' },
      { time: '3–8s',   label: '问题具体化', desc: '快切3个"错误用法"场景，每个1.5秒，制造共鸣' },
      { time: '8–42s',  label: '正确方法', desc: '7步护肤顺序，每步配产品特写 + 口播解释，节奏精准' },
      { time: '42–50s', label: '结果对比', desc: '"Before my skin was..." vs 现在效果展示' },
      { time: '50–54s', label: 'CTA',      desc: '"Save this, you\'ll thank me in 30 days"' },
    ],
    viralScore: 97,
  },
};

function getAnalysis(video: TrendVideo): ScriptAnalysis {
  const base = ANALYSIS_TEMPLATES[video.platform] ?? ANALYSIS_TEMPLATES.tiktok;
  const override = ANALYSIS_OVERRIDES[video.id] ?? {};
  return { ...base, ...override };
}

// ── Fallback thumbnail ────────────────────────────────────────────────────────
function VideoThumbnail({ platform, title }: { platform: Exclude<Platform, 'all'>; title: string }) {
  const meta = PLATFORM_META[platform];
  const initials = title.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${meta.bg}22, ${meta.bg}44)` }}>
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: `repeating-linear-gradient(45deg, ${meta.bg} 0, ${meta.bg} 1px, transparent 0, transparent 50%)`, backgroundSize: '12px 12px' }} />
      <span className="relative text-3xl font-black font-display opacity-20 text-white select-none">{initials}</span>
    </div>
  );
}

// ── Analysis Panel ────────────────────────────────────────────────────────────
function AnalysisPanel({ video, onGenerateScript }: { video: TrendVideo; onGenerateScript: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [analysis, setAnalysis] = useState<ScriptAnalysis | null>(null);

  useEffect(() => {
    setLoaded(false);
    setAnalysis(null);
    const t = setTimeout(() => {
      setAnalysis(getAnalysis(video));
      setLoaded(true);
    }, 1600);
    return () => clearTimeout(t);
  }, [video.id]);

  if (!loaded || !analysis) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(22,163,74,0.1)' }}>
          <Loader2 size={18} className="text-accent animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-text-primary">AI 正在分析脚本结构…</p>
          <p className="text-xs text-text-muted">识别钩子类型 · 拆解节奏 · 提取爆款因子</p>
        </div>
        <div className="w-48 h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <motion.div className="h-full rounded-full bg-accent"
            initial={{ width: '5%' }} animate={{ width: '90%' }}
            transition={{ duration: 1.4, ease: 'easeInOut' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-4">

        {/* 爆款评分 */}
        <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-2">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(22,163,74,0.1)' }}>
            <span className="text-lg font-black text-accent">{analysis.viralScore}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-text-primary">爆款指数</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-white"
                style={{ background: 'rgba(22,163,74,0.8)' }}>{analysis.videoType}</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-text-muted">
              <span className="flex items-center gap-1"><Flame size={9} className="text-amber" />{analysis.emotion}</span>
              <span className="flex items-center gap-1"><BarChart2 size={9} className="text-accent" />信息速度 {analysis.infoSpeed}</span>
              <span className="flex items-center gap-1"><TrendingUp size={9} />{video.views} 播放</span>
            </div>
          </div>
        </div>

        {/* 钩子分析 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Zap size={11} className="text-amber" />
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">开头钩子</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-muted">{analysis.hookType}</span>
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2.5 bg-surface-2 border-b border-border">
              <p className="text-xs text-text-primary font-mono leading-relaxed italic">"{analysis.hookLine}"</p>
            </div>
            <div className="px-3 py-2">
              <p className="text-[11px] text-text-secondary leading-relaxed">{analysis.hookStrategy}</p>
            </div>
          </div>
        </div>

        {/* 脚本结构 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <LayoutIcon size={11} style={{ color: '#0891b2' }} />
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">脚本结构拆解</p>
          </div>
          <div className="space-y-1.5">
            {analysis.structure.map((step, i) => (
              <div key={i} className="flex gap-2.5">
                <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                    style={{ background: i === 0 ? '#d97706' : i === analysis.structure.length - 1 ? '#0891b2' : '#16a34a' }}>
                    {i + 1}
                  </div>
                  {i < analysis.structure.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className={`pb-2 ${i === analysis.structure.length - 1 ? '' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-text-muted">{step.time}</span>
                    <span className="text-[10px] font-semibold text-text-primary">{step.label}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 爆款原因 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb size={11} className="text-accent" />
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">爆款核心原因</p>
          </div>
          <div className="space-y-1.5">
            {analysis.whyTrending.map((reason, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border">
                <span className="text-accent font-bold text-[11px] flex-shrink-0 mt-px">0{i + 1}</span>
                <p className="text-[11px] text-text-secondary leading-snug">{reason}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 产品适配 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Tag size={11} style={{ color: '#c13584' }} />
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">产品带货适配</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {analysis.productFit.map(p => (
              <span key={p} className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 border border-border text-text-secondary">
                {p}
              </span>
            ))}
          </div>
        </div>

        {/* 改编建议 */}
        <div className="rounded-xl border border-dashed p-3"
          style={{ borderColor: 'rgba(22,163,74,0.3)', background: 'rgba(22,163,74,0.04)' }}>
          <p className="text-[10px] font-semibold text-accent mb-1.5">改编建议</p>
          <p className="text-[11px] text-text-secondary leading-relaxed">{analysis.adaptTip}</p>
        </div>

        {/* CTA */}
        <button onClick={onGenerateScript}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
          style={{ background: 'var(--color-accent)', boxShadow: '0 4px 12px rgba(22,163,74,0.25)' }}>
          <Sparkles size={14} />
          用此结构生成我的产品脚本
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Script Panel ──────────────────────────────────────────────────────────────
interface ScriptPanelProps { video: TrendVideo; onClose: () => void }

function ScriptPanel({ video, onClose }: ScriptPanelProps) {
  const [activeTab, setActiveTab] = useState<'analysis' | 'generate'>('analysis');
  const [scriptType, setScriptType] = useState<ScriptType>('voiceover');
  const [language, setLanguage] = useState('en');
  const [productInfo, setProductInfo] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const saveToLibrary = async () => {
    setSaveState('saving');
    try {
      const blob = await fetch('/demo/img2video.mp4').then(r => r.blob());
      const dataBase64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob);
      });
      await studioApi.uploadMaterial({ name: '图生视频-0627.mp4', folder: 'upload', type: 'video', duration: 16, dataBase64, mimeType: 'video/mp4' });
      setSaveState('saved');
    } catch { setSaveState('idle'); }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    setShowVideo(false); setSaveState('idle');
    await new Promise(r => setTimeout(r, 1800));
    // 0627 mock 视频：直接输出指定的脚本分析
    if (video.videoUrl) { setResult(SCRIPT_0627); setGenerating(false); return; }
    setResult(scriptType === 'voiceover'
      ? `**[Hook — 认知颠覆型]**\n"你一直以为买贵的才有效——我花了三个月测试才发现，这个不到$30的${video.tags[0]}才是真正的答案。"\n\n**[痛点放大]**\n大多数人购买${video.tags[0]}产品时都在为品牌溢价买单，实际效果相差无几。${video.views} 的人都踩过同样的坑。\n\n**[产品展示]**\n${productInfo || '你的产品'} 改变了这个逻辑——[核心功能点1]，[核心功能点2]，让每分钱都花在刀刃上。\n\n**[结果验证]**\n用了30天之后：[具体效果描述]，[数据或对比结论]。\n\n**[CTA]**\n"链接在简介，库存只有最后200件，上次上架三天就卖完了。"`
      : `**Scene 1** (0–3s)\n景别: 特写 | 运镜: 固定\n画面: 产品正面特写，打光突出质感\n口播: "等等，先别划走——"\n\n**Scene 2** (3–8s)\n景别: 中景 | 运镜: 推镜\n画面: 使用前vs使用后快速切换\n口播: "我测了${video.views}个人推荐的产品，这个赢了"\n\n**Scene 3** (8–20s)\n景别: 近景 | 运镜: 环绕跟拍\n画面: 核心功能演示，突出差异化\n口播: "[产品核心卖点]，普通产品做不到这个"\n\n**Scene 4** (20–28s)\n景别: 全景 | 运镜: 固定\n画面: 使用场景生活化展示\n口播: "链接在简介，大家快去"\n\n**Scene 5** (28–32s)\n画面: 产品正面 + 品牌标识\n口播: "关注我，每周给你找这样的宝藏产品"`
    );
    setGenerating(false);
  };

  const handleCopy = () => {
    if (result) { void navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const selectedLang = LANGUAGES.find(l => l.code === language);

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 32 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 h-full w-[420px] flex flex-col border-l border-border z-50 bg-surface"
      style={{ right: 0 }}>

      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3.5 border-b border-border flex-shrink-0">
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-1">AI 脚本助手</p>
          <h3 className="text-sm font-semibold text-text-primary leading-snug line-clamp-2">{video.title}</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors flex-shrink-0">
          <X size={15} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-4 py-2 border-b border-border flex-shrink-0">
        {([
          { id: 'analysis' as const, icon: <BarChart2 size={12} />, label: '脚本分析' },
          { id: 'generate' as const, icon: <Sparkles size={12} />,  label: '生成脚本' },
        ]).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === tab.id ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
            }`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'analysis' ? (
          <motion.div key="analysis" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <AnalysisPanel key={video.id} video={video} onGenerateScript={() => setActiveTab('generate')} />
          </motion.div>
        ) : (
          <motion.div key="generate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col flex-1 min-h-0 overflow-hidden">

            {/* Script type + language */}
            <div className="px-4 py-3 border-b border-border flex-shrink-0 flex items-center gap-2">
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                {([
                  { type: 'voiceover' as ScriptType, icon: <FileText size={12} />, label: '口播' },
                  { type: 'storyboard' as ScriptType, icon: <LayoutIcon size={12} />, label: '分镜' },
                ] as const).map(({ type, icon, label }) => (
                  <button key={type} onClick={() => setScriptType(type)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      scriptType === type ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                    }`}>
                    {icon}<span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="relative flex-1">
                <button onClick={() => setShowLangDropdown(v => !v)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-text-secondary hover:border-border-bright transition-colors">
                  <Globe size={11} className="text-text-muted flex-shrink-0" />
                  <span className="flex-1 text-left">{selectedLang?.label}</span>
                  <ChevronDown size={11} className={`text-text-muted transition-transform ${showLangDropdown ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {showLangDropdown && (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                      className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border bg-surface z-10 overflow-hidden shadow-lg">
                      <div className="p-1 max-h-44 overflow-y-auto">
                        {LANGUAGES.map(lang => (
                          <button key={lang.code} onClick={() => { setLanguage(lang.code); setShowLangDropdown(false); }}
                            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs hover:bg-surface-2 transition-colors">
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
                <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-2 border border-border">
                    <Sparkles size={18} className="text-text-muted" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-text-primary">基于 "{video.title}" 的脚本结构</p>
                    <p className="text-xs text-text-muted mt-0.5">输入你的产品信息，生成专属脚本</p>
                  </div>
                </div>
              )}
              {generating && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-accent">
                    <Loader2 size={12} className="text-white animate-spin" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {[0, 150, 300].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                    </div>
                  </div>
                </div>
              )}
              {result && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
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
                        {copied ? <><Check size={11} className="text-green" /><span className="text-green">已复制</span></> : <><Copy size={11} /><span>复制</span></>}
                      </button>
                      <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                        <ArrowRight size={11} /><span>保存到脚本库</span>
                      </button>
                    </div>

                    {/* 0627 视频：生成视频 → 一键存入素材库 */}
                    {video.videoUrl && (
                      <div className="mt-3">
                        {!showVideo ? (
                          <button onClick={() => setShowVideo(true)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all active:scale-95"
                            style={{ background: 'var(--color-accent)' }}>
                            <Film size={13} /> 按此脚本生成视频
                          </button>
                        ) : (
                          <div className="rounded-xl border border-border overflow-hidden">
                            <video src="/demo/img2video.mp4" controls playsInline className="w-full aspect-[9/16] object-cover bg-black" />
                            <div className="p-2.5 flex items-center gap-2 border-t border-border">
                              <span className="text-[11px] text-text-muted flex-1 truncate">图生视频.mp4 · AI 生成</span>
                              {saveState === 'saved' ? (
                                <span className="flex items-center gap-1 text-xs font-semibold text-green"><Check size={12} /> 已存入素材库</span>
                              ) : (
                                <button onClick={() => void saveToLibrary()} disabled={saveState === 'saving'}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
                                  style={{ background: 'var(--color-accent)' }}>
                                  {saveState === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                                  一键存入素材库
                                </button>
                              )}
                            </div>
                            {saveState === 'saved' && (
                              <p className="px-2.5 pb-2.5 text-[11px] text-text-muted">已存入「我的上传」，去 流量专家 → AI 生成 → 选素材 即可用它剪辑成片。</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border flex-shrink-0">
              <div className="rounded-2xl border border-border bg-surface-2 overflow-hidden transition-colors focus-within:border-border-bright">
                <textarea value={productInfo} onChange={e => setProductInfo(e.target.value)}
                  placeholder="描述你的产品：名称、核心功能、目标人群、价格区间..."
                  rows={3}
                  className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none" />
                <div className="flex items-center justify-between px-3 pb-3 pt-1">
                  <p className="text-[11px] text-text-muted">{scriptType === 'voiceover' ? '口播脚本' : '分镜脚本'} · {selectedLang?.label}</p>
                  <button onClick={() => void handleGenerate()} disabled={generating}
                    className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
                    style={{ background: 'var(--color-accent)', boxShadow: '0 2px 8px rgba(22,163,74,0.2)' }}>
                    {generating ? <Loader2 size={13} className="text-white animate-spin" /> : <ArrowUp size={13} className="text-white" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Video Card (grid) ─────────────────────────────────────────────────────────
interface VideoCardProps { video: TrendVideo; index: number; isSelected: boolean; onSelect: () => void }

function VideoCard({ video, index, isSelected, onSelect }: VideoCardProps) {
  const meta = PLATFORM_META[video.platform];
  const trendLabel = video.trend === 'hot' ? '🔥 热门' : video.trend === 'rising' ? '↑ 上升' : '— 平稳';
  const trendColor = video.trend === 'hot' ? 'text-amber' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.25 }}
      className={`card overflow-hidden cursor-pointer group ${isSelected ? 'border-accent ring-1 ring-accent/20' : ''}`}
      onClick={onSelect}>
      <div className="relative overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
        {video.videoUrl
          ? <video src={`${video.videoUrl}#t=0.1`} muted playsInline loop preload="metadata" className="w-full aspect-[9/16] object-cover block"
              onMouseEnter={e => { void e.currentTarget.play().catch(() => {}); }}
              onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0.1; }} />
          : video.thumbnail
          ? <img src={video.thumbnail} alt="" className="w-full h-auto block" draggable={false} />
          : <div className="aspect-video"><VideoThumbnail platform={video.platform} title={video.title} /></div>}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button onClick={e => { e.stopPropagation(); onSelect(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: meta.bg, color: meta.color }}>
            <Play size={11} fill="currentColor" />分析脚本
          </button>
        </div>
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-white bg-black/50 backdrop-blur-sm">
          {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
        </div>
        <div className="absolute top-2 left-2">
          <span className="platform-badge text-[10px]" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
        </div>
      </div>
      <div className="p-3">
        <p className="text-xs font-semibold text-text-primary leading-snug line-clamp-2 mb-2">{video.title}</p>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-mono font-bold ${trendColor}`}>{trendLabel}</span>
          <span className="flex items-center gap-1 text-[10px] text-text-muted"><Clock size={9} />{video.views} views</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {video.tags.slice(0, 2).map(tag => <span key={tag} className="tag text-[10px]">#{tag}</span>)}
        </div>
      </div>
    </motion.div>
  );
}

// ── Video List Item ───────────────────────────────────────────────────────────
function VideoListItem({ video, isSelected, onSelect }: { video: TrendVideo; isSelected: boolean; onSelect: () => void }) {
  const meta = PLATFORM_META[video.platform];
  const trendColor = video.trend === 'hot' ? 'text-amber' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const trendLabel = video.trend === 'hot' ? '热门' : video.trend === 'rising' ? '上升' : '平稳';
  return (
    <div className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-all group ${isSelected ? 'bg-accent-glow' : 'hover:bg-surface-2'}`} onClick={onSelect}>
      <div className="w-16 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-border bg-surface-2">
        {video.thumbnail
          ? <img src={video.thumbnail} alt="" className="w-full h-full object-cover" draggable={false} />
          : <VideoThumbnail platform={video.platform} title={video.title} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="platform-badge text-[9px]" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          <span className={`text-[10px] font-semibold ${trendColor}`}>{trendLabel}</span>
        </div>
        <p className="text-sm text-text-primary font-medium truncate">{video.title}</p>
      </div>
      <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
        {video.tags.slice(0, 2).map(tag => <span key={tag} className="tag text-[10px]">#{tag}</span>)}
      </div>
      <div className="flex-shrink-0 text-right min-w-[52px]">
        <p className="text-xs font-mono text-text-secondary">{Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}</p>
        <p className="text-[10px] text-text-muted">{video.views}</p>
      </div>
      <button onClick={e => { e.stopPropagation(); onSelect(); }}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all opacity-0 group-hover:opacity-100"
        style={{ color: 'var(--color-accent)', borderColor: 'rgba(22,163,74,0.25)', background: 'var(--color-accent-glow)' }}>
        <BarChart2 size={11} /><span>分析脚本</span>
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface InspirationDashboardProps {
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
}

export default function InspirationDashboard({ onScriptPanelOpen, onScriptPanelClose }: InspirationDashboardProps) {
  const [platform, setPlatform] = useState<Platform>('all');
  const [search, setSearch] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    if (selectedVideo) { onScriptPanelOpen?.(); }
    else { onScriptPanelClose?.(); }
  }, [selectedVideo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => { onScriptPanelClose?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = MOCK_VIDEOS.filter(v =>
    (platform === 'all' || v.platform === platform) &&
    (search === '' || v.title.toLowerCase().includes(search.toLowerCase()) || v.tags.some(t => t.includes(search.toLowerCase())))
  );

  return (
    <div className="relative">
      <div className={`transition-all duration-300 ${selectedVideo ? 'mr-[420px]' : ''}`}>
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary font-display">灵感大屏</h2>
              <p className="text-sm text-text-muted mt-0.5">追踪全球社媒爆款，AI 脚本分析 + 一键生成口播 / 分镜</p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted">
              <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
              <span>今日已推送 {MOCK_VIDEOS.length} 条</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="relative min-w-48 max-w-64">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="搜索视频标题或标签..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors" />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap flex-1">
              {PLATFORM_FILTERS.map(f => (
                <button key={f.id} onClick={() => setPlatform(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    platform === f.id
                      ? 'bg-accent text-white shadow-[0_2px_8px_rgba(22,163,74,0.25)]'
                      : 'bg-surface border border-border text-text-secondary hover:border-border-bright hover:text-text-primary'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 p-1 rounded-lg bg-surface-2 border border-border flex-shrink-0">
              <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                <LayoutGrid size={13} />
              </button>
              <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                <List size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 mb-4 grid grid-cols-3 gap-3 max-w-xl">
          {[
            { icon: <Zap size={13} />,       label: '热门视频', value: `${MOCK_VIDEOS.filter(v => v.trend === 'hot').length}`,    color: 'text-amber' },
            { icon: <TrendingUp size={13} />, label: '上升趋势', value: `${MOCK_VIDEOS.filter(v => v.trend === 'rising').length}`, color: 'text-green' },
            { icon: <Globe size={13} />,      label: '覆盖平台', value: '5',                                                        color: 'text-accent' },
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

        <div className="px-6 pb-6">
          {viewMode === 'grid' ? (
            <div className="columns-2 lg:columns-3 xl:columns-4 gap-4">
              {filtered.map((video, i) => (
                <div key={video.id} className="break-inside-avoid mb-4">
                  <VideoCard video={video} index={i} isSelected={selectedVideo?.id === video.id}
                    onSelect={() => setSelectedVideo(selectedVideo?.id === video.id ? null : video)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="card overflow-hidden divide-y divide-border">
              {filtered.map(video => (
                <VideoListItem key={video.id} video={video} isSelected={selectedVideo?.id === video.id}
                  onSelect={() => setSelectedVideo(selectedVideo?.id === video.id ? null : video)} />
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

      <AnimatePresence>
        {selectedVideo && <ScriptPanel key={selectedVideo.id} video={selectedVideo} onClose={() => setSelectedVideo(null)} />}
      </AnimatePresence>
    </div>
  );
}
