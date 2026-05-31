import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  buildBuyingPageAssistantContext,
  type BuyingPageAssistantContext,
  type BuyingPageAssistantPageMeta,
} from './buyingPageAssistantContext';
import { GAME_PROFILE_OPTIONS } from './gameProfiles';
import { VIEW_MODULE_LABELS } from './pageAssistantLabels';
import type { BuyingVideoItem, ViewState } from '../types';

type BuyingRegistration = {
  items: BuyingVideoItem[];
  pageMeta: BuyingPageAssistantPageMeta;
};

type PageAssistantContextValue = {
  buying: BuyingRegistration | null;
  setBuying: (reg: BuyingRegistration | null) => void;
};

const PageAssistantContext = createContext<PageAssistantContextValue | null>(null);

export function PageAssistantProvider({ children }: { children: ReactNode }) {
  const [buying, setBuying] = useState<BuyingRegistration | null>(null);
  const value = useMemo(() => ({ buying, setBuying }), [buying]);
  return <PageAssistantContext.Provider value={value}>{children}</PageAssistantContext.Provider>;
}

function usePageAssistantCtx() {
  const ctx = useContext(PageAssistantContext);
  if (!ctx) throw new Error('PageAssistantProvider required');
  return ctx;
}

export function useRegisterBuyingPageAssistant(
  items: BuyingVideoItem[],
  pageMeta: BuyingPageAssistantPageMeta,
  active: boolean,
) {
  const { setBuying } = usePageAssistantCtx();
  useEffect(() => {
    if (!active) {
      setBuying(null);
      return;
    }
    setBuying({ items, pageMeta });
    return () => setBuying(null);
  }, [active, items, pageMeta, setBuying]);
}

export function useResolvedPageAssistantContext(
  activeView: ViewState,
  gameProfileId: string,
): BuyingPageAssistantContext {
  const { buying } = usePageAssistantCtx();
  return useMemo(() => {
    const gameLabel = GAME_PROFILE_OPTIONS.find((g) => g.id === gameProfileId)?.label ?? gameProfileId;
    if (activeView === 'buying_dashboard' && buying) {
      return buildBuyingPageAssistantContext(buying.items, buying.pageMeta);
    }
    const viewLabel = VIEW_MODULE_LABELS[activeView];
    return buildBuyingPageAssistantContext([], {
      mode: 'ranking',
      rankingSegment: '',
      gameProfileLabel: gameLabel,
      scopeNote: `${viewLabel} · 当前页未挂载素材列表，可聊该模块用法与通用创意/买量思路`,
    });
  }, [activeView, buying, gameProfileId]);
}

export function usePageAssistantHasBuyingData(activeView: ViewState): boolean {
  const { buying } = usePageAssistantCtx();
  return activeView === 'buying_dashboard' && (buying?.items.length ?? 0) > 0;
}
