import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import { pb } from './pb';

const USERS = 'users';

export interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  photoURL?: string;
}

export interface SignUpInput {
  email: string;
  password: string;
  passwordConfirm: string;
  name?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
}

function mapRecordToUser(record: RecordModel | null): AuthUser | null {
  if (!record || record.collectionName !== USERS) return null;

  const email = String(record.email ?? '');
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const username = typeof record.username === 'string' ? record.username.trim() : '';
  const local = email.includes('@') ? email.split('@')[0] : email;
  const displayName = name || username || local || '用户';

  let photoURL: string | undefined;
  if (typeof record.avatar === 'string' && record.avatar.length > 0) {
    photoURL = pb.files.getURL(record, record.avatar);
  }

  return {
    uid: record.id,
    displayName,
    email,
    emailVerified: Boolean(record.verified),
    photoURL,
  };
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => mapRecordToUser(pb.authStore.record));
  const [loading, setLoading] = useState(true);

  const applyAuthRecord = useCallback(() => {
    setUser(mapRecordToUser(pb.authStore.record));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const finish = () => {
      if (!cancelled) setLoading(false);
    };

    const unsub = pb.authStore.onChange(() => {
      applyAuthRecord();
      finish();
    });

    void (async () => {
      if (pb.authStore.isValid) {
        try {
          await pb.collection(USERS).authRefresh();
        } catch {
          pb.authStore.clear();
        }
      }
      if (!cancelled) {
        applyAuthRecord();
        finish();
      }
    })();

    return () => {
      cancelled = true;
      unsub();
    };
  }, [applyAuthRecord]);

  const signIn = useCallback(async (email: string, password: string) => {
    await pb.collection(USERS).authWithPassword(email.trim(), password);
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const email = input.email.trim();
    const body: Record<string, unknown> = {
      email,
      password: input.password,
      passwordConfirm: input.passwordConfirm,
    };
    const name = input.name?.trim();
    if (name) body.name = name;

    await pb.collection(USERS).create(body);
    await pb.collection(USERS).authWithPassword(email, input.password);
  }, []);

  const signOut = useCallback(async () => {
    pb.authStore.clear();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
