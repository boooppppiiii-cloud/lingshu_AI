import axios from 'axios';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  graphVersion?: string;
  webhookUrl?: string;
}

function graphBase(config: WhatsAppConfig) {
  const version = config.graphVersion ?? process.env.META_GRAPH_VERSION ?? 'v25.0';
  return `https://graph.facebook.com/${version}`;
}

export async function sendWhatsAppText(config: WhatsAppConfig, to: string, text: string): Promise<void> {
  await axios.post(
    `${graphBase(config)}/${config.phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
    { headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' } }
  );
}

export async function sendWhatsAppTemplate(
  config: WhatsAppConfig,
  to: string,
  templateName: string,
  languageCode: string,
  components: object[] = []
): Promise<void> {
  await axios.post(
    `${graphBase(config)}/${config.phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode }, components },
    },
    { headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' } }
  );
}

export function verifyWhatsAppWebhook(
  config: WhatsAppConfig,
  mode: string,
  token: string,
  challenge: string
): string | null {
  if (mode === 'subscribe' && token === config.verifyToken) return challenge;
  return null;
}

export async function getPhoneNumberInfo(config: WhatsAppConfig) {
  const res = await axios.get(
    `${graphBase(config)}/${config.phoneNumberId}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } }
  );
  return res.data;
}
