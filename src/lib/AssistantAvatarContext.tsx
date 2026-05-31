import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import {
  DEFAULT_ASSISTANT_AVATAR,
  loadAssistantAvatar,
  saveAssistantAvatar,
  type AssistantAvatarCategory,
  type AssistantAvatarConfig,
  type AssistantAvatarOption,
} from './assistantAvatar';

type AssistantAvatarContextValue = {
  avatar: AssistantAvatarConfig;
  setAvatarOption: (key: AssistantAvatarCategory, value: AssistantAvatarOption) => void;
  resetAvatar: () => void;
};

const AssistantAvatarContext = createContext<AssistantAvatarContextValue | null>(null);

export function AssistantAvatarProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [avatar, setAvatar] = useState<AssistantAvatarConfig>(DEFAULT_ASSISTANT_AVATAR);

  useEffect(() => {
    if (user) setAvatar(loadAssistantAvatar(user.uid));
    else setAvatar(DEFAULT_ASSISTANT_AVATAR);
  }, [user?.uid]);

  const persist = useCallback(
    (next: AssistantAvatarConfig) => {
      setAvatar(next);
      if (user) saveAssistantAvatar(user.uid, next);
    },
    [user],
  );

  const setAvatarOption = useCallback(
    (key: AssistantAvatarCategory, value: AssistantAvatarOption) => {
      setAvatar((prev) => {
        const next = { ...prev, [key]: value };
        if (user) saveAssistantAvatar(user.uid, next);
        return next;
      });
    },
    [user],
  );

  const resetAvatar = useCallback(() => {
    persist({ ...DEFAULT_ASSISTANT_AVATAR });
  }, [persist]);

  const value = useMemo(
    () => ({ avatar, setAvatarOption, resetAvatar }),
    [avatar, setAvatarOption, resetAvatar],
  );

  return (
    <AssistantAvatarContext.Provider value={value}>{children}</AssistantAvatarContext.Provider>
  );
}

export function useAssistantAvatar() {
  const ctx = useContext(AssistantAvatarContext);
  if (!ctx) throw new Error('AssistantAvatarProvider required');
  return ctx;
}
