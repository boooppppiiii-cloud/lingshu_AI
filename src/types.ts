/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Timestamp {
  seconds: number;
  nanoseconds: number;
}

export interface StoryboardItem {
  time: string;
  shot: string;
  camera: string;
  content: string;
  audio: string;
}

export interface InspirationHighlights {
  theme: string[];
  plot: string[];
  setting: string[];
  hook: string[];
}

export interface CreativeTheme {
  title: string;
  description: string;
}

import type { GameProfileId } from './lib/gameProfiles';

/** 用户职能：设计专员 / 投放专员（PocketBase users.userRole） */
export type UserRole = 'design' | 'placement';

export type ViewState =
  | 'market'
  | 'buying_dashboard'
  | 'workshop'
  | 'assets'
  | 'profile'
  | 'volume_space'
  | 'team_cases';

/** 买量大屏 — 爬榜单 / 找钩子 / 追热梗 / 素材库（投放专员） */
export type BuyingDashboardMode = 'ranking' | 'hooks' | 'trending' | 'material_library';

/** 爬榜单：团队 TOP / 竞品 TOP */
export type BuyingRankingSegment = 'internal_top' | 'competitor_top';

/** 追热梗：版位（上传时可多选） */
export type BuyingTrendingPlacement =
  | 'douyin_portrait_916'
  | 'tencent_landscape_169'
  | 'tencent_portrait_916';

export type BuyingEmotionPoint = { t: number; intensity: number; note?: string };

/** 全片分析：情绪曲线与关键时间点 */
export interface BuyingFullAnalysis {
  totalSeconds: number;
  emotionCurve: BuyingEmotionPoint[];
  /** 0–3 秒窗口内情绪/冲突强度峰值时刻（秒） */
  peak3sSec: number;
  /** 全片情绪/冲突强度峰值时刻（秒） */
  peakFullSec: number;
  /** 卖点首次清晰出现时刻（秒） */
  firstSellingPointSec: number;
}

export interface BuyingHookAnalysis {
  /** 前 3 秒画面呈现 */
  first3sVisual?: string;
  /** 前 3 秒台词/字幕 */
  first3sDialogue?: string;
  /** 前 3 秒钩子类型：福利诱导、悬念反转、痛点暴击、玩法爽点、对比反差、审美视觉、猎奇搞笑、其他 */
  first3sHookType?: string;
  /** 钩子类型为「其他」时，运营在前端补全的具体说明 */
  first3sHookTypeOther?: string;
  /** 全片核心玩法卖点总结 */
  coreGameplaySellingPoints?: string;
  /** 全片核心福利卖点总结 */
  coreWelfareSellingPoints?: string;
  /** 结尾引导语 */
  endingGuidance?: string;
  /** 可复用爆款套路分析 */
  reusableViralPattern?: string;
  fullAnalysis?: BuyingFullAnalysis | null;
  /** @deprecated 旧版字段，仅兼容历史数据 */
  firstFrameVisual?: string;
  first5sCamera?: string;
  first5sAvSync?: string;
  first5sMood?: string;
  conflictOpening?: boolean;
  conflictOpeningNote?: string;
  firstFiveSecondsSummary?: string;
  firstSellingPoint?: {
    approxTimeSec?: number;
    method?: string;
    visualAnalysis?: string;
  };
}

/** 爬榜单竞品 TOP 投放指标（PocketBase buying_videos：bidMethodText、roiBidText 等 *Text 字段） */
export interface BuyingVideoAdMetrics {
  bidMethod: string;
  roi: string;
  miniGameDay1PayRoi: string;
  shallowBid: string;
  ctr: string;
  miniGameRegisterCost: string;
  miniGameDay1PayCost: string;
  day1PayArppu: string;
}

/** PocketBase `buying_videos` 映射后的展示模型 */
export interface BuyingVideoItem {
  id: string;
  userId: string;
  gameProfileId: GameProfileId;
  dashboardMode: BuyingDashboardMode;
  rankingSegment: BuyingRankingSegment | '';
  title: string;
  sourceType: 'internal' | 'external';
  sourceLabel: string;
  runTimeText: string;
  runVolumeText: string;
  /** 竞品 TOP 投放日期（PocketBase runDates JSON 数组，YYYY-MM-DD） */
  runDates: string[];
  /** 追热梗版位 id 或竞品渠道版位（见 buyingPlacements.ts，PocketBase placements） */
  placements: string[];
  scriptTags: string[];
  hookAnalysis: BuyingHookAnalysis | null;
  coverUrl: string;
  previewUrl: string;
  created: string;
  adMetrics: BuyingVideoAdMetrics;
}
export type WorkshopTab = 'flash' | 'iteration' | 'inspiration';
export type AssetType = 'prompt' | 'full_script' | 'storyboard' | 'inspiration' | 'visual_detail';

export interface UserProfile {
  uid: string;
  nickname: string;
  email: string;
  likesReceived: number;
}

export interface Asset {
  id: string;
  userId: string;
  /** 收藏/创建时所在的游戏版本（与侧栏切换一致） */
  gameProfileId: GameProfileId;
  type: AssetType;
  title: string;
  content: string; // The text content or JSON string
  tags?: string[];
  likes?: number;
  likedBy?: string[];
  createdAt: Timestamp; // Server timestamp
}

export interface MarketItem {
  id: string;
  userId: string;
  userNickname: string;
  assetId: string;
  /** 上架时资产所属游戏版本 */
  gameProfileId: GameProfileId;
  type: AssetType;
  title: string;
  content: string;
  tags?: string[];
  likes: number;
  likedBy: string[]; // Array of user IDs who liked this
  createdAt: Timestamp;
}
