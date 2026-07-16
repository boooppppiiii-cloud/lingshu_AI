import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encryptRegistrationPassword } from './registrationCredentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_TENANTS_FILE = path.join(__dirname, '../../data/local-auth-tenants.json');

export interface LocalTenantRecord {
  id: string;
  name: string;
  companyName: string;
  contactName: string;
  contact: string;
  industry: string;
  notes: string;
  inviteCode: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: string | null;
  createdAt: string;
  registeredAt?: string;
  registeredEmail?: string;
  registeredPasswordCipher?: string;
  registrationInviteCode?: string;
}

function readLocalTenants(): LocalTenantRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_TENANTS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalTenants(tenants: LocalTenantRecord[]): void {
  fs.mkdirSync(path.dirname(LOCAL_TENANTS_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_TENANTS_FILE, JSON.stringify(tenants, null, 2), 'utf8');
  try {
    fs.chmodSync(LOCAL_TENANTS_FILE, 0o600);
  } catch {
    // Windows and some containers may ignore POSIX file modes.
  }
}

export function listLocalTenants(): LocalTenantRecord[] {
  return readLocalTenants();
}

export function getLocalTenant(tenantId: string): LocalTenantRecord | null {
  return readLocalTenants().find(tenant => tenant.id === tenantId) ?? null;
}

export function findLocalTenantByInvite(inviteCode: string): LocalTenantRecord | null {
  const code = String(inviteCode || '').trim();
  if (!code) return null;
  return readLocalTenants().find(tenant => tenant.inviteCode === code && !tenant.registeredAt) ?? null;
}

export function findLocalTenantByRegistrationInvite(inviteCode: string): LocalTenantRecord | null {
  const code = String(inviteCode || '').trim();
  if (!code) return null;
  return readLocalTenants().find(tenant => tenant.registrationInviteCode === code) ?? null;
}

export function createLocalInviteTenant(input: {
  companyName: string;
  contactName?: string;
  industry?: string;
  notes?: string;
  inviteCode: string;
}): LocalTenantRecord {
  const companyName = String(input.companyName || '').trim();
  const contactName = String(input.contactName || '').trim();
  const tenant: LocalTenantRecord = {
    id: `local_tenant_customer_${randomUUID().replaceAll('-', '')}`,
    name: companyName,
    companyName,
    contactName,
    contact: contactName,
    industry: String(input.industry || '').trim(),
    notes: String(input.notes || '').trim(),
    inviteCode: String(input.inviteCode || '').trim(),
    subscriptionStatus: 'pending_delivery',
    subscriptionPlan: 'delivery',
    subscriptionExpiresAt: null,
    createdAt: new Date().toISOString(),
  };
  writeLocalTenants([tenant, ...readLocalTenants()]);
  return tenant;
}

export function activateLocalTenantInvite(input: {
  inviteCode: string;
  email: string;
  password: string;
}): LocalTenantRecord | null {
  const tenants = readLocalTenants();
  const index = tenants.findIndex(tenant => tenant.inviteCode === input.inviteCode && !tenant.registeredAt);
  if (index < 0) return null;
  const current = tenants[index];
  tenants[index] = {
    ...current,
    inviteCode: '',
    registrationInviteCode: current.inviteCode,
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
    registeredAt: new Date().toISOString(),
    registeredEmail: String(input.email || '').trim().toLowerCase(),
    registeredPasswordCipher: encryptRegistrationPassword(input.password),
  };
  writeLocalTenants(tenants);
  return tenants[index];
}
