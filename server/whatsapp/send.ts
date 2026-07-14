import { decryptSecret, getTenantPlatformApp } from '../lib/tenantPlatformApps.js';
import { sendWhatsAppTemplate, sendWhatsAppText, type WhatsAppConfig } from '../integrations/whatsapp.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function getTenantWhatsAppConfig(tenantId: string): Promise<WhatsAppConfig> {
  const app = await getTenantPlatformApp(tenantId, 'meta');
  const phoneNumberId = text(app?.phone_number_id);
  const accessToken = decryptSecret(app?.access_token);
  const verifyToken = text(app?.webhook_verify_token);

  if (!app || !phoneNumberId || !accessToken) {
    throw new Error('tenant_whatsapp_not_configured');
  }

  return { phoneNumberId, accessToken, verifyToken };
}

export async function sendTenantWhatsAppText(tenantId: string, to: string, body: string): Promise<void> {
  const waNumber = text(to);
  const content = text(body);
  if (!waNumber || !content) throw new Error('whatsapp_to_and_body_required');
  const config = await getTenantWhatsAppConfig(tenantId);
  await sendWhatsAppText(config, waNumber, content);
}

export async function sendTenantWhatsAppTemplate(input: {
  tenantId: string;
  to: string;
  templateName: string;
  languageCode?: string;
  variables?: string[];
}): Promise<void> {
  const to = text(input.to);
  const templateName = text(input.templateName);
  if (!to || !templateName) throw new Error('whatsapp_template_target_required');

  const components = input.variables?.length
    ? [{
        type: 'body',
        parameters: input.variables.map(value => ({ type: 'text', text: String(value || '') })),
      }]
    : [];

  const config = await getTenantWhatsAppConfig(input.tenantId);
  await sendWhatsAppTemplate(config, to, templateName, input.languageCode || 'en_US', components);
}
