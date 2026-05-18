/**
 * @license SPDX-License-Identifier: Apache-2.0
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { GameProfileId } from './gameProfiles';
import { GAME_PROFILE_STORAGE_KEY } from './gameProfiles';

function readStoredProfile(): GameProfileId {
  try {
    const raw = localStorage.getItem(GAME_PROFILE_STORAGE_KEY);
    if (raw === 'xiyou_card' || raw === 'ace_mecha' || raw === 'flower') return raw;
  } catch {
    /* ignore */
  }
  return 'flower';
}

type GameProfileContextValue = {
  gameProfileId: GameProfileId;
  setGameProfileId: (id: GameProfileId) => void;
};

const GameProfileContext = createContext<GameProfileContextValue | null>(null);

export function GameProfileProvider({ children }: { children: ReactNode }) {
  const [gameProfileId, setState] = useState<GameProfileId>(() =>
    typeof window !== 'undefined' ? readStoredProfile() : 'flower',
  );

  const setGameProfileId = useCallback((id: GameProfileId) => {
    setState(id);
    try {
      localStorage.setItem(GAME_PROFILE_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      gameProfileId,
      setGameProfileId,
    }),
    [gameProfileId, setGameProfileId],
  );

  return <GameProfileContext.Provider value={value}>{children}</GameProfileContext.Provider>;
}

export function useGameProfile(): GameProfileContextValue {
  const ctx = useContext(GameProfileContext);
  if (!ctx) {
    throw new Error('useGameProfile must be used within GameProfileProvider');
  }
  return ctx;
}
