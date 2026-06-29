import crypto from 'crypto';
import axios from 'axios';

export interface WechatConfig {
  appId: string;
  appSecret: string;
  token: string;
  encodingAesKey?: string;
}

// Verify server signature for WeChat webhook
export function verifyWechatSignature(token: string, signature: string, timestamp: string, nonce: string): boolean {
  const sorted = [token, timestamp, nonce].sort().join('');
  const hash = crypto.createHash('sha1').update(sorted).digest('hex');
  return hash === signature;
}

let _accessToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(config: WechatConfig): Promise<string> {
  if (_accessToken && Date.now() < _accessToken.expiresAt) return _accessToken.value;
  const res = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: { grant_type: 'client_credential', appid: config.appId, secret: config.appSecret },
  });
  _accessToken = { value: res.data.access_token, expiresAt: Date.now() + (res.data.expires_in - 60) * 1000 };
  return _accessToken.value;
}

export async function sendWechatTemplateMessage(
  config: WechatConfig,
  openId: string,
  templateId: string,
  data: Record<string, { value: string; color?: string }>,
  url?: string
): Promise<void> {
  const token = await getAccessToken(config);
  await axios.post(
    `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${token}`,
    { touser: openId, template_id: templateId, url, data }
  );
}
