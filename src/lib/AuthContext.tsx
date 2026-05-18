import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import { pb } from './pb';
import {
  persistRoleLocally,
  readRoleFromRecord,
  USER_ROLE_PB_FIELD,
  userRoleToPbValue,
} from './userRoles';
import type { UserRole } from '../types';

const USERS = 'users';

/**
 * PocketBase `users` 需有 Select 字段 `userRole`：design | placement。
 * 无字段或空值的已有账号在前端视为 design（设计专员）。
 */

export interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  photoURL?: string;
  /** 设计专员 / 投放专员；旧账号无字段时为 design */
  role: UserRole;
}

export interface SignUpInput {
  email: string;
  password: string;
  passwordConfirm: string;
  name?: string;
  userRole: UserRole;
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
    role: readRoleFromRecord(record),
  };
}

/** 登录后拉取完整 users 记录（auth 响应里常缺少自定义字段 userRole） */
async function hydrateAuthRecord(): Promise<void> {
  const token = pb.authStore.token;
  const model = pb.authStore.record;
  if (!token || !model?.id || model.collectionName !== USERS) return;
  try {
    const full = await pb.collection(USERS).getOne(model.id);
    pb.authStore.save(token, full);
  } catch (e) {
    console.warn('hydrateAuthRecord failed', e);
  }
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
          await hydrateAuthRecord();
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
    await hydrateAuthRecord();
    applyAuthRecord();
  }, [applyAuthRecord]);

  const signUp = useCallback(async (input: SignUpInput) => {
    const email = input.email.trim();
    const pbRole = userRoleToPbValue(input.userRole);
    const body: Record<string, unknown> = {
      email,
      password: input.password,
      passwordConfirm: input.passwordConfirm,
      [USER_ROLE_PB_FIELD]: pbRole,
    };
    const name = input.name?.trim();
    if (name) body.name = name;

    await pb.collection(USERS).create(body);
    await pb.collection(USERS).authWithPassword(email, input.password);
    await hydrateAuthRecord();

    const uid = pb.authStore.record?.id;
    if (!uid) return;

    const saved = readRoleFromRecord(pb.authStore.record ?? { id: uid });
    if (saved !== input.userRole) {
      try {
        await pb.collection(USERS).update(uid, { [USER_ROLE_PB_FIELD]: pbRole });
        await hydrateAuthRecord();
      } catch (e) {
        console.warn('userRole update after signup failed, using local fallback', e);
        persistRoleLocally(uid, input.userRole);
      }
    } else {
      persistRoleLocally(uid, input.userRole);
    }
    applyAuthRecord();
  }, [applyAuthRecord]);

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
