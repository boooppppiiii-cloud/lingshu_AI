import type { AssetType } from '../types';
import { logUsageEvent } from './logUsageEvent';
import { pb } from './pb';
import { buildAssetCreateBody, buildMarketCreateBody } from './recordMappers';
import type { GameProfileId } from './gameProfiles';
import { USAGE_EVENT } from './usageEvents';

function extractContentTags(type: AssetType, content: string): string[] {
  const extraTags: string[] = [];
  const extract = (label: string, category: string) => {
    const regex = new RegExp(`${label}[:：]\\s*([^\\n\\r]+)`, 'i');
    const match = content.match(regex);
    if (match?.[1]) {
      const val = match[1].trim();
      if (val && val !== '未设置' && val !== '无') {
        extraTags.push(`${category}:${val}`);
      }
    }
  };

  if (type === 'storyboard') {
    extract('核心冲突', 'conflict');
    extract('情绪', 'mood');
    extract('景别', 'shot');
    extract('运镜', 'camera');
    extract('画面', 'frame');
    extract('动作', 'action');
    extract('配音', 'audio');
    extract('核心卖点', 'selling_point');
  } else if (type === 'full_script') {
    extract('主题', 'theme');
    extract('钩子', 'hook');
    extract('核心卖点', 'selling_point');
    extract('情绪', 'mood');
  }

  return extraTags;
}

/** 合并工坊标签 + 正文抽取标签（与资产卡片上架逻辑一致） */
export function buildMarketTags(type: AssetType, content: string, baseTags: string[]): string[] {
  const combinedTags = [...baseTags];

  if (type === 'full_script' || type === 'storyboard') {
    for (const t of baseTags) {
      if (t.includes(':')) {
        const [cat, val] = t.split(':');
        if (cat === 'shot_tag') continue;
        const st = `shot_tag:${cat}_${val}`;
        if (!combinedTags.includes(st)) combinedTags.push(st);
      }
    }
  }

  const hasStructured = combinedTags.some((t) => t.includes(':') && !t.startsWith('shot_tag:'));
  if (!hasStructured) {
    for (const et of extractContentTags(type, content)) {
      if (!combinedTags.includes(et)) combinedTags.push(et);
    }
  }

  return combinedTags;
}

/** 创建 assets 记录并上架至灵感市场 market */
export async function publishWorkshopCardToMarket(input: {
  userId: string;
  userNickname: string;
  gameProfileId: GameProfileId;
  type: AssetType;
  title: string;
  content: string;
  baseTags?: string[];
  usageSource?: string;
}): Promise<{ assetId: string; marketId: string }> {
  const title = input.title.trim() || '未命名创意';
  const content = input.content.trim();
  if (!content) {
    throw new Error('内容为空，无法上架');
  }

  const baseTags = [...(input.baseTags ?? []), '创意工坊', 'workshop_like'].filter(Boolean);
  const tags = buildMarketTags(input.type, content, baseTags);

  const assetRecord = await pb.collection('assets').create(
    buildAssetCreateBody({
      userId: input.userId,
      gameProfileId: input.gameProfileId,
      type: input.type,
      title,
      content,
      tags: baseTags,
      likes: 0,
      likedBy: [],
    }),
  );

  const marketRecord = await pb.collection('market').create(
    buildMarketCreateBody({
      userId: input.userId,
      userNickname: input.userNickname,
      assetId: assetRecord.id,
      gameProfileId: input.gameProfileId,
      type: input.type,
      title,
      content,
      tags,
      likes: 0,
      likedBy: [],
    }),
  );

  void logUsageEvent(input.userId, USAGE_EVENT.MARKET_PUBLISHED, {
    source: input.usageSource ?? 'creative_workshop_like',
    refCollection: 'market',
    refId: marketRecord.id,
    meta: { asset_id: assetRecord.id, type: input.type },
  });

  return { assetId: assetRecord.id, marketId: marketRecord.id };
}
