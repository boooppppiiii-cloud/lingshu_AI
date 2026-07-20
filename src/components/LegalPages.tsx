import type { ReactNode } from 'react';
import { ArrowLeft, ShieldCheck, Trash2 } from 'lucide-react';

const SUPPORT_EMAIL = 'support@lingshu.ai';
const UPDATED_AT = '2026年7月13日';

type LegalPageKind = 'privacy' | 'data-deletion';

function PageShell({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-surface-2 px-4 py-8 text-text-primary">
      <div className="mx-auto max-w-4xl">
        <a href="/" className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-bright hover:text-text-primary">
          <ArrowLeft size={16} />
          返回灵枢 AI
        </a>
        <section className="mt-5 rounded-2xl border border-border bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-start">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-glow text-accent">{icon}</div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-text-muted">灵枢 AI</p>
              <h1 className="mt-2 text-2xl font-black text-text-primary md:text-3xl">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{subtitle}</p>
              <p className="mt-3 text-xs text-text-muted">更新日期：{UPDATED_AT}</p>
            </div>
          </div>
          <article className="mt-6 space-y-7 text-sm leading-7 text-text-secondary">{children}</article>
        </section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-black text-text-primary">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <PageShell title="隐私政策" subtitle="本政策说明灵枢 AI 在提供企业出海营销、社媒运营、素材生成、客户跟进和第三方平台授权服务时，如何收集、使用、保存、共享和保护用户数据。" icon={<ShieldCheck size={24} />}>
      <Section title="1. 我们收集的信息">
        <p>在您注册、登录或使用灵枢 AI 时，我们可能收集账号信息、企业资料、产品信息、素材库内容、客户线索、订单记录、社媒账号配置、生成的文案/脚本/图片/视频/字幕/配音、操作日志、设备信息和必要的 Cookie 或本地存储数据。</p>
        <p>当您连接 Meta、Facebook、Instagram、WhatsApp、TikTok、YouTube 等第三方平台时，我们只会在您授权范围内读取或处理必要数据，例如账号 ID、主页信息、授权令牌、内容发布状态、互动数据、评论或消息数据。</p>
      </Section>
      <Section title="2. 我们如何使用信息">
        <p>我们使用相关信息用于账号登录、安全验证、权限管理、企业资料管理、AI 内容生成、素材管理、客户回复草稿、订单与运营分析、社媒账号授权、内容发布、服务统计、错误排查和安全审计。</p>
        <p>我们不会出售您的个人信息，也不会将第三方平台数据用于未经授权的广告定向、数据经纪或与用户授权目的无关的用途。</p>
      </Section>
      <Section title="3. Meta 平台数据说明">
        <p>如果您通过 Meta 授权灵枢 AI，我们可能根据您的授权读取 Facebook Page、Instagram 专业账号、WhatsApp Business 账号、帖子、评论、消息、媒体内容和账号表现数据，用于账号连接、内容发布、客户回复、运营分析和数据复盘。</p>
        <p>我们仅在完成您请求的功能所需范围内处理 Meta 平台数据，并遵守 Meta Platform Terms 和相关开发者政策。</p>
      </Section>
      <Section title="4. 信息共享">
        <p>我们不会向无关第三方出售或出租您的信息。为提供服务，我们可能与云服务、存储、AI 模型、语音合成、短信、邮件、支付、数据分析或第三方平台接口服务商共享必要数据。我们会要求服务提供商仅按授权目的处理数据，并采取合理安全措施。</p>
        <p>在法律法规、法院命令、监管要求、平台合规要求或保护用户与系统安全所必需的情况下，我们可能披露必要信息。</p>
      </Section>
      <Section title="5. 数据保存与安全">
        <p>我们会在实现服务目的所需期间保存数据，并采取访问控制、权限隔离、日志审计、加密传输、备份和安全监控等措施保护数据安全。</p>
        <p>当您删除账号、撤销授权或提出数据删除请求后，我们会在合理期限内删除或匿名化相关数据，法律法规、争议处理、安全审计或合规证明要求保留的除外。</p>
      </Section>
      <Section title="6. 您的权利">
        <p>您可以请求访问、更正、补充、删除个人数据，撤销第三方平台授权，注销账号，或获取关于数据处理的说明。您也可以在 Meta、Facebook、Instagram 或 WhatsApp 的账号设置中移除灵枢 AI 的应用授权。</p>
      </Section>
      <Section title="7. Cookie 与本地存储">
        <p>我们可能使用 Cookie 或类似技术保持登录状态、保存偏好、提升性能、分析访问行为并保障账号安全。您可以通过浏览器设置管理 Cookie，但部分功能可能因此无法正常使用。</p>
      </Section>
      <Section title="8. 未成年人保护">
        <p>灵枢 AI 主要面向企业用户和商业用户。我们不会主动面向未成年人提供服务，也不会故意收集未成年人的个人信息。如您发现未成年人向我们提供了个人信息，请联系我们删除。</p>
      </Section>
      <Section title="9. 联系我们">
        <p>客服邮箱：<a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent">{SUPPORT_EMAIL}</a></p>
      </Section>
    </PageShell>
  );
}

function DataDeletionPage() {
  return (
    <PageShell title="用户数据删除说明" subtitle="本页面用于说明用户如何请求删除灵枢 AI 保存的账号数据、业务数据，以及通过 Meta、Facebook、Instagram、WhatsApp 等第三方平台授权产生的数据。" icon={<Trash2 size={24} />}>
      <Section title="1. 删除范围">
        <p>您可以请求删除灵枢 AI 中与您账号相关的个人信息、企业资料、第三方平台授权数据、素材、文案、脚本、图片、视频、字幕、配音、客户数据、订单数据、操作记录和其他由您上传或生成的内容。</p>
      </Section>
      <Section title="2. 如何提交删除请求">
        <p>请发送邮件至 <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent">{SUPPORT_EMAIL}</a>，邮件标题建议为“灵枢 AI 数据删除请求”。</p>
        <p>请在邮件中提供：注册邮箱、企业名称、需要删除的数据范围、相关第三方平台账号信息，以及便于我们核验身份的必要说明。</p>
      </Section>
      <Section title="3. 处理流程">
        <p>我们收到请求后，会先进行身份核验。核验通过后，我们会在合理期限内删除或匿名化相关数据，并通过邮件告知处理结果。</p>
        <p>如果您的请求涉及 Meta、Facebook、Instagram 或 WhatsApp 授权数据，我们会删除灵枢 AI 本地保存的授权信息、账号关联信息和在授权范围内同步的数据。</p>
      </Section>
      <Section title="4. 无法立即删除的情况">
        <p>如法律法规、监管要求、安全审计、争议处理、平台合规证明或系统备份机制要求保留部分数据，我们可能会在必要期限内保留相关数据，并在不再需要时删除或匿名化。</p>
      </Section>
      <Section title="5. 撤销第三方授权">
        <p>您也可以直接在 Meta、Facebook、Instagram、WhatsApp 或其他第三方平台的账号设置中移除灵枢 AI 应用授权。撤销授权后，我们将无法继续通过该授权访问相关平台数据。</p>
      </Section>
      <Section title="6. 联系方式">
        <p>客服邮箱：<a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent">{SUPPORT_EMAIL}</a></p>
      </Section>
    </PageShell>
  );
}

export default function LegalPages({ kind }: { kind: LegalPageKind }) {
  return kind === 'data-deletion' ? <DataDeletionPage /> : <PrivacyPage />;
}
