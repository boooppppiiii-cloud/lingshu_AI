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

export type ViewState = 'market' | 'workshop' | 'assets' | 'profile';
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
  type: AssetType;
  title: string;
  content: string;
  tags?: string[];
  likes: number;
  likedBy: string[]; // Array of user IDs who liked this
  createdAt: Timestamp;
}
