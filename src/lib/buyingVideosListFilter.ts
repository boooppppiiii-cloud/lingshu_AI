import { gameProfileScopeFilterExpr, type GameProfileId } from './gameProfiles';
import type { BuyingDashboardMode, BuyingRankingSegment } from '../types';

/**
 * - 素材库：ranking + competitor_top
 * - 找钩子：竞品 TOP 全部素材（含 AI 开场分析）+ dashboardMode=hooks 的专项上传
 */
export function buyingVideosListFilter(
  gameProfileId: GameProfileId,
  mode: BuyingDashboardMode,
  rankingSegment: BuyingRankingSegment,
): string {
  const scope = gameProfileScopeFilterExpr('gameProfileId', gameProfileId);
  if (mode === 'material_library') {
    return `(${scope}) && dashboardMode = "ranking" && rankingSegment = "competitor_top"`;
  }
  if (mode === 'hooks') {
    return `(${scope}) && (dashboardMode = "hooks" || (dashboardMode = "ranking" && rankingSegment = "competitor_top"))`;
  }
  const base = `(${scope}) && dashboardMode = ${JSON.stringify(mode)}`;
  if (mode === 'ranking') {
    return `${base} && rankingSegment = ${JSON.stringify(rankingSegment)}`;
  }
  return base;
}
