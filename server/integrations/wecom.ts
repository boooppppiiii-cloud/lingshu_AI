import crypto from 'node:crypto';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function verifyWeComSignature(input: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypted: string;
  signature: string;
}): boolean {
  const signature = text(input.signature);
  if (!signature) return false;
  const expected = [input.token, input.timestamp, input.nonce, input.encrypted]
    .map(text)
    .sort()
    .join('');
  const digest = crypto.createHash('sha1').update(expected).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function decryptWeComEcho(input: {
  encodingAesKey: string;
  encryptedEcho: string;
  corpId?: string;
}): string {
  const keyRaw = text(input.encodingAesKey);
  if (keyRaw.length !== 43) {
    throw new Error('invalid_wecom_encoding_aes_key');
  }
  const aesKey = Buffer.from(`${keyRaw}=`, 'base64');
  if (aesKey.length !== 32) {
    throw new Error('invalid_wecom_encoding_aes_key');
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(text(input.encryptedEcho), 'base64')),
    decipher.final(),
  ]);
  const pad = decrypted[decrypted.length - 1];
  const plain = decrypted.subarray(0, decrypted.length - pad);
  const messageLength = plain.readUInt32BE(16);
  const message = plain.subarray(20, 20 + messageLength).toString('utf8');
  const corpId = plain.subarray(20 + messageLength).toString('utf8');
  const expectedCorpId = text(input.corpId);
  if (expectedCorpId && corpId && corpId !== expectedCorpId) {
    throw new Error('wecom_corp_id_mismatch');
  }
  return message;
}
