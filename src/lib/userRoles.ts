import type { ViewState, UserRole } from '../types';

/** PocketBase `users` 集合字段：Select，选项 design | placement */
export const USER_ROLE_PB_FIELD = 'userRole';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  design: '设计专员',
  placement: '投放专员',
};

export interface RoleNavItem {
  view: ViewState;
  label: string;
  icon: 'zap' | 'bar-chart' | 'layout-grid' | 'folder-heart' | 'user' | 'rocket' | 'users';
}

const DESIGN_NAV: RoleNavItem[] = [
  { view: 'market', label: '灵感市场', icon: 'zap' },
  { view: 'buying_dashboard', label: '买量大屏', icon: 'bar-chart' },
  { view: 'workshop', label: '创意工坊', icon: 'layout-grid' },
  { view: 'assets', label: '资产卡片', icon: 'folder-heart' },
  { view: 'profile', label: '个人中心', icon: 'user' },
];

const PLACEMENT_NAV: RoleNavItem[] = [
  { view: 'buying_dashboard', label: '买量大屏', icon: 'bar-chart' },
  { view: 'volume_space', label: '起量空间', icon: 'rocket' },
  { view: 'team_cases', label: '团队案例', icon: 'users' },
  { view: 'profile', label: '个人中心', icon: 'user' },
];

const NAV_BY_ROLE: Record<UserRole, RoleNavItem[]> = {
  design: DESIGN_NAV,
  placement: PLACEMENT_NAV,
};

const DEFAULT_VIEW_BY_ROLE: Record<UserRole, ViewState> = {
  design: 'workshop',
  placement: 'buying_dashboard',
};

const ROLE_STORAGE_KEY = 'lingqi-user-role-v1';

/** PocketBase Select 可能用英文或中文选项值 */
export function parseUserRole(raw: unknown): UserRole {
  const s = String(raw ?? '').trim().toLowerCase();
  if (
    s === 'placement' ||
    s === '投放专员' ||
    s === '投放' ||
    s === 'media_buyer' ||
    s === 'buyer'
  ) {
    return 'placement';
  }
  return 'design';
}

/** 注册/更新时写入 PocketBase 的值（与 Admin 里 Select 选项一致） */
export function userRoleToPbValue(role: UserRole): string {
  const design = import.meta.env.VITE_PB_USER_ROLE_DESIGN;
  const placement = import.meta.env.VITE_PB_USER_ROLE_PLACEMENT;
  if (role === 'placement' && typeof placement === 'string' && placement.trim()) {
    return placement.trim();
  }
  if (role === 'design' && typeof design === 'string' && design.trim()) {
    return design.trim();
  }
  return role;
}

export function persistRoleLocally(uid: string, role: UserRole): void {
  try {
    const raw = JSON.parse(localStorage.getItem(ROLE_STORAGE_KEY) ?? '{}') as Record<string, UserRole>;
    raw[uid] = role;
    localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(raw));
  } catch {
    /* ignore */
  }
}

export function readLocalRole(uid: string): UserRole | null {
  try {
    const raw = JSON.parse(localStorage.getItem(ROLE_STORAGE_KEY) ?? '{}') as Record<string, UserRole>;
    const r = raw[uid];
    return r === 'placement' || r === 'design' ? r : null;
  } catch {
    return null;
  }
}

/** 从 PB 记录解析身份；支持 userRole / role 字段及本地注册兜底 */
export function readRoleFromRecord(record: { id: string; [key: string]: unknown }): UserRole {
  const raw =
    record[USER_ROLE_PB_FIELD] ??
    record.role ??
    record.user_role;
  if (raw != null && String(raw).trim() !== '') {
    return parseUserRole(raw);
  }
  return readLocalRole(record.id) ?? 'design';
}

export function getNavItemsForRole(role: UserRole): RoleNavItem[] {
  return NAV_BY_ROLE[role];
}

export function getDefaultViewForRole(role: UserRole): ViewState {
  return DEFAULT_VIEW_BY_ROLE[role];
}

export function isViewAllowedForRole(view: ViewState, role: UserRole): boolean {
  return NAV_BY_ROLE[role].some((item) => item.view === view);
}

/** 访客按设计专员菜单展示（与改造前一致） */
export function resolveEffectiveRole(userRole: UserRole | undefined): UserRole {
  return userRole ?? 'design';
}
