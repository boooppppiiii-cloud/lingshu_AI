import type { RecordModel } from 'pocketbase';
import type { Asset, AssetType, MarketItem, Timestamp } from '../types';

export function pbCreatedToTimestamp(created: string | undefined): Timestamp {
  const ms = created ? new Date(created).getTime() : Date.now();
  return { seconds: Math.floor(ms / 1000), nanoseconds: 0 };
}

/** PocketBase `market` row → app `MarketItem`（时间用系统 `created`，与原先 `createdAt` 展示一致） */
export function recordToMarketItem(r: RecordModel): MarketItem {
  const tags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
  const likedBy = Array.isArray(r.likedBy) ? (r.likedBy as string[]) : [];
  return {
    id: r.id,
    userId: String(r.userId ?? ''),
    userNickname: String(r.userNickname ?? ''),
    assetId: String(r.assetId ?? ''),
    type: (r.type as AssetType) || 'full_script',
    title: String(r.title ?? ''),
    content: String(r.content ?? ''),
    tags,
    likes: Number(r.likes ?? 0),
    likedBy,
    createdAt: pbCreatedToTimestamp(r.created as string | undefined),
  };
}

/** PocketBase `assets` 行 → app `Asset` */
export function recordToAsset(r: RecordModel): Asset {
  const tags = Array.isArray(r.tags) ? (r.tags as string[]) : undefined;
  const likedBy = Array.isArray(r.likedBy) ? (r.likedBy as string[]) : undefined;
  return {
    id: r.id,
    userId: String(r.userId ?? ''),
    type: (r.type as AssetType) || 'prompt',
    title: String(r.title ?? ''),
    content: String(r.content ?? ''),
    tags,
    likes: r.likes != null ? Number(r.likes) : undefined,
    likedBy,
    createdAt: pbCreatedToTimestamp(r.created as string | undefined),
  };
}

/** `assets.create` 请求体（不写 id；时间由 PocketBase `created` 维护） */
export function buildAssetCreateBody(input: {
  userId: string;
  type: AssetType;
  title: string;
  content: string;
  tags?: string[];
  likes?: number;
  likedBy?: string[];
}) {
  return {
    userId: input.userId,
    type: input.type,
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    likes: input.likes ?? 0,
    likedBy: input.likedBy ?? [],
  };
}

/** `market.create` 请求体，与 `recordToMarketItem` 读取字段一致 */
export function buildMarketCreateBody(input: {
  userId: string;
  userNickname: string;
  assetId: string;
  type: AssetType;
  title: string;
  content: string;
  tags?: string[];
  likes?: number;
  likedBy?: string[];
}) {
  return {
    userId: input.userId,
    userNickname: input.userNickname,
    assetId: input.assetId,
    type: input.type,
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    likes: input.likes ?? 0,
    likedBy: input.likedBy ?? [],
  };
}
