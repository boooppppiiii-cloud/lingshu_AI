import axios from 'axios';

export interface TelegramConfig {
  botToken: string;
  defaultChatId?: string;
}

const base = (token: string) => `https://api.telegram.org/bot${token}`;

export async function sendTelegramMessage(config: TelegramConfig, chatId: string, text: string): Promise<void> {
  await axios.post(`${base(config.botToken)}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  });
}

export async function getBotInfo(config: TelegramConfig) {
  const res = await axios.get(`${base(config.botToken)}/getMe`);
  return res.data.result;
}

export async function setWebhook(config: TelegramConfig, webhookUrl: string): Promise<void> {
  await axios.post(`${base(config.botToken)}/setWebhook`, { url: webhookUrl });
}

export async function deleteWebhook(config: TelegramConfig): Promise<void> {
  await axios.post(`${base(config.botToken)}/deleteWebhook`);
}

export async function getUpdates(config: TelegramConfig, offset?: number) {
  const res = await axios.get(`${base(config.botToken)}/getUpdates`, {
    params: { offset, timeout: 0 },
  });
  return res.data.result;
}
