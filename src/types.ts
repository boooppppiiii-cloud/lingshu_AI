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

/** 买量大屏 — 爬榜单 / 找钩子 / 追热梗 */
export type BuyingDashboardMode = 'ranking' | 'hooks' | 'trending';

/** 爬榜单：团队 TOP / 竞品 TOP */
export type BuyingRankingSegment = 'internal_top' | 'competitor_top';

/** 追热梗：版位（上传时可多选） */
export type BuyingTrendingPlacement =
  | 'douyin_portrait_916'
  | 'tencent_landscape_169'
  | 'tencent_portrait_916';

export interface BuyingHookAnalysis {
  /** 前 5 秒画面要点 */
  firstFiveSecondsSummary?: string;
  /** 首次卖点：出现时间、呈现方式、画面分析 */
  firstSellingPoint?: {
    approxTimeSec?: number;
    method?: string;
    visualAnalysis?: string;
  };
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
  placements: BuyingTrendingPlacement[];
  scriptTags: string[];
  hookAnalysis: BuyingHookAnalysis | null;
  coverUrl: string;
  previewUrl: string;
  created: string;
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
