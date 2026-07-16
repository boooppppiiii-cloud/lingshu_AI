import crypto from 'node:crypto';

const MISSING_KEY_MESSAGE =
  'REGISTRATION_CREDENTIAL_KEY or TENANT_PLATFORM_APP_KEY is required in production to protect customer registration passwords.';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function credentialKey(): Buffer {
  const configured =
    text(process.env.REGISTRATION_CREDENTIAL_KEY) ||
    text(process.env.TENANT_PLATFORM_APP_KEY) ||
    text(process.env.OAUTH_STATE_SECRET);
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error(MISSING_KEY_MESSAGE);
  }
  return crypto.createHash('sha256')
    .update(configured || 'lingshu-local-registration-credential-key')
    .digest();
}

export function encryptRegistrationPassword(value: string): string {
  const plain = String(value || '');
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptRegistrationPassword(value?: string): string {
  const raw = text(value);
  if (!raw) return '';
  if (!raw.startsWith('v1:')) return raw;
  try {
    const [, ivRaw, tagRaw, encryptedRaw] = raw.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      credentialKey(),
      Buffer.from(ivRaw, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}
