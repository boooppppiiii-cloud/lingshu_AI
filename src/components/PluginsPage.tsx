import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Puzzle, X, CheckCircle, AlertCircle, Settings, Trash2, Plus,
  Star, GitBranch, Copy, Check, ChevronRight, Zap, BookOpen,
  Package, Users, Layers, ExternalLink, Lock, Globe, Brain,
  MessageSquare, Wrench, ShieldCheck, FlaskConical,
} from 'lucide-react';

// ── Plugin types & data ───────────────────────────────────────────────────────
interface Plugin {
  id: string;
  pluginKey: string;
  name: string;
  nameZh: string;
  category: 'ecommerce' | 'social' | 'tool' | 'ai';
  description: string;
  icon: string;
  status: 'installed' | 'not_installed' | 'error';
  config: Record<string, string>;
  installed: boolean;
  installedAt?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  ecommerce: '电商平台',
  social: '社交媒体',
  tool: '工具',
  ai: 'AI 能力',
};

const PLUGIN_FIELDS: Record<string, { key: string; label: string; placeholder: string; secret?: boolean }[]> = {
  shopify: [
    { key: 'storeDomain', label: '店铺域名', placeholder: 'mystore.myshopify.com' },
    { key: 'accessToken', label: 'Admin API Token', placeholder: 'shpat_...', secret: true },
  ],
  tiktok_ads: [
    { key: 'advertiserId', label: 'Advertiser ID', placeholder: '6123456789' },
    { key: 'accessToken', label: 'Access Token', placeholder: 'xxx...', secret: true },
  ],
  whatsapp_business: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '123456789012345' },
    { key: 'accessToken', label: 'Access Token', placeholder: 'EAABxxxxx...', secret: true },
  ],
  google_translate: [
    { key: 'apiKey', label: 'API Key', placeholder: 'AIzaSy...', secret: true },
  ],
  amazon: [
    { key: 'sellerId', label: 'Seller ID', placeholder: 'A1B2C3...' },
    { key: 'accessKey', label: 'Access Key', placeholder: 'AKIA...', secret: true },
    { key: 'secretKey', label: 'Secret Key', placeholder: '...', secret: true },
  ],
  instagram: [
    { key: 'pageId', label: 'Page ID', placeholder: '123456789' },
    { key: 'accessToken', label: 'Page Access Token', placeholder: 'EAABxxxxx...', secret: true },
  ],
  facebook: [
    { key: 'pageId', label: 'Page ID', placeholder: '123456789012345' },
    { key: 'accessToken', label: 'Page Access Token', placeholder: 'EAABxxxxx...', secret: true },
  ],
  pinterest: [
    { key: 'adAccountId', label: 'Ad Account ID', placeholder: '549xxxxxxxxxx' },
    { key: 'accessToken', label: 'Access Token', placeholder: 'pina_...', secret: true },
  ],
};

// ── Skill types & data ────────────────────────────────────────────────────────
type SkillStatus = 'active' | 'placeholder';
type SkillCategory = 'sales' | 'industry' | 'product';

interface SkillVariable { name: string; desc: string; example: string }
interface ConversationStage { id: number; label: string; desc: string }
interface SkillTool { id: string; label: string; desc: string; icon: React.ReactNode }

interface Skill {
  id: string;
  name: string;
  nameZh: string;
  category: SkillCategory;
  status: SkillStatus;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  tagline: string;
  description: string;
  source?: { name: string; author: string; url: string; license: string; stars: string; version: string };
  model?: string;
  temperature?: number;
  maxTokens?: number;
  prompt?: string;
  variables?: SkillVariable[];
  stages?: ConversationStage[];
  tools?: SkillTool[];
}

const SALESGPT_PROMPT = `Never forget your name is {salesperson_name}. You work as a {salesperson_role}.
You work at company named {company_name}. {company_name}'s business is the following: {company_business}.
Company values are the following. {company_values}
You are contacting a potential prospect in order to {conversation_purpose}
Your means of contacting the prospect is {conversation_type}

If you're asked about where you got the user's contact information, say that you got it from public records.
Keep your responses in short length to retain the user's attention. Never produce lists, just answers.
You must respond according to the previous conversation history and the stage of the conversation you are at.
Only generate one response at a time! When you are done generating, end with '<END_OF_TURN>' to give the user a chance to respond.

Example:
Conversation history:
{salesperson_name}: Hey, how are you? This is {salesperson_name} calling from {company_name}. Do you have a minute? <END_OF_TURN>
User: I am well, and yes, why are you calling? <END_OF_TURN>
{salesperson_name}:
End of example.

Current conversation stage:
{conversation_stage}

Conversation history:
{conversation_history}
{salesperson_name}:`;

const SKILLS: Skill[] = [
  // ── 销冠专家 ───────────────────────────────────────────────────────────────
  {
    id: 'salesgpt',
    name: 'SalesGPT',
    nameZh: '销冠 Skill',
    category: 'sales',
    status: 'active',
    icon: <Zap size={18} />,
    iconBg: 'rgba(217,119,6,0.1)',
    iconColor: '#d97706',
    tagline: '顾问式销售 · SPIN 提问法 · 8 阶段话术引导',
    description: '基于 SalesGPT 开源项目，实现上下文感知的销售对话 Agent。通过阶段识别自动切换话术策略，支持产品知识库接入以减少幻觉。',
    source: {
      name: 'SalesGPT',
      author: 'Filip Michalsky',
      url: 'https://github.com/filip-michalsky/SalesGPT',
      license: 'MIT',
      stars: '2.3k',
      version: 'v0.6.0',
    },
    model: 'claude-sonnet-4-6',
    temperature: 0.7,
    maxTokens: 4096,
    prompt: SALESGPT_PROMPT,
    variables: [
      { name: 'salesperson_name',  desc: '销售人员姓名',   example: 'Alex Zhang' },
      { name: 'salesperson_role',  desc: '销售角色',       example: 'Business Development Representative' },
      { name: 'company_name',      desc: '公司名称',       example: 'SleepHaven' },
      { name: 'company_business',  desc: '公司业务描述',   example: 'SleepHaven is a premium mattress company...' },
      { name: 'company_values',    desc: '公司价值观',     example: 'Quality, comfort, and customer satisfaction.' },
      { name: 'conversation_purpose', desc: '对话目标',   example: 'find out if they are looking to upgrade their current mattress' },
      { name: 'conversation_type', desc: '沟通方式',       example: 'call / chat / email' },
      { name: 'conversation_stage', desc: '当前对话阶段（自动更新）', example: 'Introduction' },
      { name: 'conversation_history', desc: '对话历史（自动拼接）', example: 'User: Hi! <END_OF_TURN>' },
    ],
    stages: [
      { id: 1, label: '自我介绍',     desc: 'Start the conversation by introducing yourself and your company. Be polite and respectful while keeping the tone professional. Greet first—do not pitch.' },
      { id: 2, label: '资格确认',     desc: 'Qualify the prospect by confirming if they are the right person to talk to regarding your product/service. Ensure they have purchasing authority.' },
      { id: 3, label: '价值主张',     desc: 'Briefly explain how your product/service can benefit the prospect. Focus on unique selling points and value proposition.' },
      { id: 4, label: '需求分析',     desc: 'Ask relevant questions to uncover the needs and pain points of the prospect. Listen carefully to their responses and take notes.' },
      { id: 5, label: '解决方案展示', desc: 'Based on the prospect\'s needs, present your product/service as the solution that can address their pain points.' },
      { id: 6, label: '异议处理',     desc: 'Address any objections that the prospect may have. Be prepared to provide evidence or testimonials to support your claims.' },
      { id: 7, label: '推动成交',     desc: 'Ask for the sale by proposing a next step or sign-off. This can be a demo, a trial, or a purchase decision.' },
      { id: 8, label: '结束通话',     desc: 'The prospect has to leave, is not interested, or next steps were already determined by the sales agent.' },
    ],
    tools: [
      { id: 'product_kb', label: '产品知识库查询', desc: '接入当前 Product Skill，查询产品规格、价格、库存',    icon: <Package size={12} /> },
      { id: 'crm',        label: 'CRM 客户档案',   desc: '读取客户历史订单、询盘记录、标签信息',                icon: <Users size={12} /> },
      { id: 'whatsapp',   label: 'WhatsApp 发送',  desc: '在成交阶段自动发送报价单、产品目录到客户 WhatsApp', icon: <MessageSquare size={12} /> },
    ],
  },
  // ── 行业专家 ───────────────────────────────────────────────────────────────
  {
    id: 'ecom_expert',
    name: 'CrossBorderExpert',
    nameZh: '跨境电商专家',
    category: 'industry',
    status: 'active',
    icon: <Globe size={18} />,
    iconBg: 'rgba(8,145,178,0.1)',
    iconColor: '#0891b2',
    tagline: '亚马逊 · TikTok Shop · 独立站 · 选品定价',
    description: '深度理解跨境电商平台规则、选品逻辑、定价策略与物流链路，为运营决策提供行业视角支撑。',
  },
  {
    id: 'supply_chain',
    name: 'SupplyChainExpert',
    nameZh: '供应链专家',
    category: 'industry',
    status: 'active',
    icon: <Layers size={18} />,
    iconBg: 'rgba(79,70,229,0.1)',
    iconColor: '#4f46e5',
    tagline: '工厂对接 · 质检 · 头程物流 · 清关',
    description: '覆盖从工厂源头到海外仓的全链路供应链知识，擅长风险识别、成本优化与供应商谈判策略。',
  },
  // ── 客户产品知识库 ─────────────────────────────────────────────────────────
  {
    id: 'product_kb',
    name: 'ProductKnowledge',
    nameZh: '产品知识库',
    category: 'product',
    status: 'placeholder',
    icon: <Package size={18} />,
    iconBg: 'rgba(22,163,74,0.1)',
    iconColor: '#16a34a',
    tagline: '规格参数 · 竞品对比 · 卖点提炼 · 常见问题',
    description: '上传产品资料（PDF、表格、图册），AI 自动提取结构化产品知识，供销售 Agent 实时查询引用。',
  },
];

const CATEGORY_SECTIONS: { id: SkillCategory; label: string; desc: string }[] = [
  { id: 'sales',    label: '销冠专家',      desc: '提升销售转化的核心 Skill，驱动客服与询盘 Agent 表现' },
  { id: 'industry', label: '行业专家',      desc: '垂直领域知识注入，让 Agent 具备行业洞察力' },
  { id: 'product',  label: '客户产品知识库', desc: '结构化产品信息，减少幻觉，提升应答准确率' },
];

// ── Prompt renderer (highlights {variables}) ──────────────────────────────────
function PromptCode({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        part.startsWith('{') && part.endsWith('}')
          ? <span key={i} className="px-1 py-0.5 rounded text-amber-700 bg-amber-50 font-semibold">{part}</span>
          : <span key={i} className="text-gray-700">{part}</span>
      )}
    </pre>
  );
}

// ── Skill detail drawer ───────────────────────────────────────────────────────
type DrawerTab = 'info' | 'prompt' | 'stages' | 'tools';

function SkillDrawer({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [tab, setTab] = useState<DrawerTab>('info');
  const [copied, setCopied] = useState(false);

  const copyPrompt = () => {
    if (skill.prompt) {
      void navigator.clipboard.writeText(skill.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const TABS: { id: DrawerTab; label: string; icon: React.ReactNode }[] = [
    { id: 'info',   label: '基本信息', icon: <BookOpen size={12} /> },
    { id: 'prompt', label: '系统提示词', icon: <Brain size={12} /> },
    { id: 'stages', label: '对话阶段', icon: <Layers size={12} /> },
    { id: 'tools',  label: '工具绑定', icon: <Wrench size={12} /> },
  ];

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed top-0 right-0 h-full w-[480px] bg-white border-l border-gray-200 z-50 flex flex-col shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: skill.iconBg, color: skill.iconColor }}>
          {skill.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{skill.nameZh}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium bg-green-50 text-green-700">已启用</span>
          </div>
          {skill.source && (
            <a href={skill.source.url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors group w-fit">
              <GitBranch size={10} />
              <span>{skill.source.author}/{skill.source.name}</span>
              <span className="flex items-center gap-0.5 ml-1"><Star size={9} />{skill.source.stars}</span>
              <ExternalLink size={9} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex-shrink-0">
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-5 py-2 border-b border-gray-100 flex-shrink-0">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === t.id ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {tab === 'info' && (
            <motion.div key="info" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-5 space-y-5">
              {/* Source card */}
              {skill.source && (
                <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">开源来源</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: '项目名称', value: skill.source.name },
                      { label: '作者', value: skill.source.author },
                      { label: '许可证', value: skill.source.license },
                      { label: '版本', value: skill.source.version },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[10px] text-gray-400">{label}</p>
                        <p className="text-xs font-medium text-gray-800 mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                  <a href={skill.source.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors">
                    <GitBranch size={12} />{skill.source.url}
                    <ExternalLink size={10} />
                  </a>
                </div>
              )}

              {/* Model config */}
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">模型配置</p>
                {[
                  { label: '推理模型', value: skill.model ?? '—' },
                  { label: 'Temperature', value: String(skill.temperature ?? '—') },
                  { label: 'Max Tokens', value: skill.maxTokens ? skill.maxTokens.toLocaleString() : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50">
                    <span className="text-xs text-gray-500">{label}</span>
                    <span className="text-xs font-mono font-medium text-gray-800">{value}</span>
                  </div>
                ))}
              </div>

              {/* Variables */}
              {skill.variables && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">提示词变量</p>
                  <div className="space-y-2">
                    {skill.variables.map(v => (
                      <div key={v.name} className="rounded-lg border border-gray-100 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">{`{${v.name}}`}</code>
                          <span className="text-[11px] text-gray-500">{v.desc}</span>
                        </div>
                        <p className="text-[10px] text-gray-400 font-mono truncate pl-1">示例: {v.example}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {tab === 'prompt' && (
            <motion.div key="prompt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">SALES_AGENT_INCEPTION_PROMPT</p>
                <button onClick={copyPrompt}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors">
                  {copied ? <><Check size={11} className="text-green-500" /><span className="text-green-600">已复制</span></> : <><Copy size={11} />复制</>}
                </button>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 overflow-x-auto">
                <PromptCode text={skill.prompt ?? ''} />
              </div>
              <p className="text-[10px] text-gray-400 mt-3 flex items-center gap-1.5">
                <ShieldCheck size={10} />
                <span>橙色高亮为运行时动态填充的变量，其余为固定系统指令</span>
              </p>
            </motion.div>
          )}

          {tab === 'stages' && (
            <motion.div key="stages" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
                对话阶段 — Stage Analyzer 自动识别当前阶段并切换话术
              </p>
              <div className="space-y-2">
                {(skill.stages ?? []).map((stage, i) => (
                  <div key={stage.id} className="flex gap-3">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                        style={{ background: i === 0 ? '#d97706' : i === (skill.stages!.length - 1) ? '#94a3b8' : '#16a34a' }}>
                        {stage.id}
                      </div>
                      {i < (skill.stages!.length - 1) && <div className="w-px flex-1 bg-gray-100 mt-1" />}
                    </div>
                    <div className={`pb-3 ${i === (skill.stages!.length - 1) ? '' : ''}`}>
                      <p className="text-xs font-semibold text-gray-800">{stage.label}</p>
                      <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{stage.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-100">
                <p className="text-[11px] text-blue-700 leading-relaxed">
                  <strong>Stage Analyzer：</strong>每轮对话结束后，LLM 以独立 prompt 分析当前应处于哪个阶段（只输出数字），主 Agent 据此调整后续话术策略。
                </p>
              </div>
            </motion.div>
          )}

          {tab === 'tools' && (
            <motion.div key="tools" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="p-5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-4">工具绑定 — 调用外部系统增强 Skill 能力</p>
              <div className="space-y-3">
                {(skill.tools ?? []).map(tool => (
                  <div key={tool.id} className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 bg-white">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-100 text-gray-500">
                      {tool.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800">{tool.label}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{tool.desc}</p>
                    </div>
                    <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                      <CheckCircle size={9} />已绑定
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-xl border border-dashed border-gray-200 text-center">
                <p className="text-xs text-gray-400">添加更多工具绑定</p>
                <p className="text-[10px] text-gray-300 mt-0.5">需先在「插件」页完成接入</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Skill card ────────────────────────────────────────────────────────────────
function SkillCard({ skill, onView }: { skill: Skill; onView: () => void }) {
  const isActive = skill.status === 'active';
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-4 transition-all ${isActive ? 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm' : 'border-dashed border-gray-200 bg-gray-50/60'}`}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: skill.iconBg, color: skill.iconColor, opacity: isActive ? 1 : 0.5 }}>
        {skill.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">{skill.nameZh}</p>
              {isActive
                ? <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full font-medium"><CheckCircle size={9} />已启用</span>
                : <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">配置中</span>}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">{skill.tagline}</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1.5 leading-relaxed line-clamp-2">{skill.description}</p>

        {/* Source badge for active skills */}
        {skill.source && (
          <div className="flex items-center gap-3 mt-2.5">
            <a href={skill.source.url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors">
              <GitBranch size={10} />{skill.source.author}/{skill.source.name}
            </a>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Star size={9} />{skill.source.stars}</span>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{skill.source.license}</span>
          </div>
        )}

        <div className="flex gap-2 mt-3">
          {isActive ? (
            <button onClick={onView}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              <BookOpen size={12} />查看配置
            </button>
          ) : (
            <>
              {skill.category === 'product' ? (
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-400 cursor-not-allowed">
                  <Plus size={12} />上传产品资料
                </button>
              ) : (
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-400 cursor-not-allowed">
                  <Lock size={12} />即将开放
                </button>
              )}
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-gray-300 text-gray-400 cursor-not-allowed">
                <FlaskConical size={12} />预览 Demo
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Skills tab ────────────────────────────────────────────────────────────────
function SkillsTab() {
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const grouped = CATEGORY_SECTIONS.map(sec => ({
    ...sec,
    skills: SKILLS.filter(s => s.category === sec.id),
  }));

  return (
    <div className="relative">
      <div className={`transition-all duration-300 ${selectedSkill ? 'mr-[480px]' : ''}`}>
        {/* Stats row */}
        <div className="flex items-center gap-6 mb-6">
          {[
            { label: '已启用 Skill', value: SKILLS.filter(s => s.status === 'active').length, color: 'text-green-600', bg: 'bg-green-50' },
            { label: '待配置', value: SKILLS.filter(s => s.status === 'placeholder').length, color: 'text-gray-500', bg: 'bg-gray-50' },
            { label: '已绑定工具', value: 3, color: 'text-amber-600', bg: 'bg-amber-50' },
          ].map(s => (
            <div key={s.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${s.bg}`}>
              <span className={`text-sm font-bold ${s.color}`}>{s.value}</span>
              <span className="text-xs text-gray-500">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Skill sections */}
        {grouped.map(sec => (
          <div key={sec.id} className="mb-8">
            <div className="flex items-baseline gap-2 mb-1">
              <h2 className="text-sm font-semibold text-gray-800">{sec.label}</h2>
              <span className="text-[11px] text-gray-400">{sec.desc}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 mt-3">
              {sec.skills.map(skill => (
                <SkillCard key={skill.id} skill={skill} onView={() => setSelectedSkill(skill)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Drawer overlay */}
      <AnimatePresence>
        {selectedSkill && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedSkill(null)} />
            <SkillDrawer skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'plugins' | 'skills' | 'auth'>('plugins');
  const [configTarget, setConfigTarget] = useState<Plugin | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => { void fetchPlugins(); }, []);

  async function fetchPlugins() {
    setLoading(true);
    try {
      const r = await fetch('/api/overseas/plugins');
      setPlugins(await r.json() as Plugin[]);
    } finally { setLoading(false); }
  }

  async function install(pluginKey: string) {
    setInstalling(pluginKey);
    try {
      await fetch(`/api/overseas/plugins/${pluginKey}/install`, { method: 'POST' });
      await fetchPlugins();
    } finally { setInstalling(null); }
  }

  async function uninstall(pluginKey: string) {
    await fetch(`/api/overseas/plugins/${pluginKey}`, { method: 'DELETE' });
    await fetchPlugins();
  }

  async function saveConfig(plugin: Plugin) {
    await fetch(`/api/overseas/plugins/${plugin.pluginKey}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configValues),
    });
    await fetchPlugins();
    setConfigTarget(null);
  }

  async function testPlugin(pluginKey: string) {
    setTesting(pluginKey);
    try {
      const r = await fetch(`/api/overseas/plugins/${pluginKey}/test`, { method: 'POST' });
      const data = await r.json() as { ok: boolean; shopName?: string; message?: string; error?: string; rates?: Record<string, number>; source?: string };
      const rateMsg = data.rates
        ? `${data.message ?? '汇率连接成功'}：CNY ${data.rates.CNY} / SAR ${data.rates.SAR} / AED ${data.rates.AED}`
        : null;
      setTestResult(prev => ({
        ...prev,
        [pluginKey]: { ok: data.ok, msg: data.ok ? (rateMsg ?? (data.shopName ? `连接成功：${data.shopName}` : (data.message ?? '连接成功'))) : (data.error ?? '连接失败') },
      }));
      await fetchPlugins();
    } catch {
      setTestResult(prev => ({ ...prev, [pluginKey]: { ok: false, msg: '网络错误' } }));
    } finally { setTesting(null); }
  }

  const grouped = plugins.reduce<Record<string, Plugin[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p); return acc;
  }, {});

  const installedCount = plugins.filter(p => p.installed && p.status === 'installed').length;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">插件市场</h1>
            <p className="text-sm text-gray-500 mt-0.5">连接电商平台、社交媒体和工具，扩展 AI 智能体能力</p>
          </div>
          {installedCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg text-xs text-green-700">
              <CheckCircle size={12} /> {installedCount} 个已连接
            </div>
          )}
        </div>

        <div className="flex gap-1 mt-5">
          {(['plugins', 'skills', 'auth'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'plugins' ? '插件' : tab === 'skills' ? '技能' : '应用授权'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {activeTab === 'skills' && <SkillsTab />}

        {activeTab === 'auth' && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Puzzle size={40} className="mb-3 opacity-40" />
            <p className="text-sm">应用授权功能开发中</p>
          </div>
        )}

        {activeTab === 'plugins' && (
          <>
            {loading && <div className="text-sm text-gray-400 py-12 text-center">加载中...</div>}

            {Object.entries(grouped).map(([cat, catPlugins]) => (
              <div key={cat} className="mb-8">
                <h2 className="text-sm font-semibold text-gray-500 mb-4">{CATEGORY_LABELS[cat] ?? cat}</h2>
                <div className="grid grid-cols-2 gap-3">
                  {catPlugins.map(plugin => {
                    const tr = testResult[plugin.pluginKey];
                    const fields = PLUGIN_FIELDS[plugin.pluginKey] ?? [];
                    return (
                      <div key={plugin.pluginKey} className="border border-gray-200 rounded-xl p-4 flex items-start gap-4">
                        <div className="text-3xl flex-shrink-0 mt-0.5">{plugin.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{plugin.nameZh}</p>
                              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed line-clamp-2">{plugin.description}</p>
                            </div>
                            {plugin.installed && plugin.status === 'installed' && (
                              <span className="flex-shrink-0 flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                <CheckCircle size={10} /> 已接入
                              </span>
                            )}
                            {plugin.installed && plugin.status === 'error' && (
                              <span className="flex-shrink-0 flex items-center gap-1 text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                                <AlertCircle size={10} /> 错误
                              </span>
                            )}
                          </div>

                          {tr && (
                            <div className={`mt-2 text-xs px-2 py-1.5 rounded-lg flex items-center gap-1.5 ${tr.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                              {tr.ok ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                              {tr.msg}
                            </div>
                          )}

                          <div className="flex gap-2 mt-3">
                            {!plugin.installed ? (
                              <button
                                onClick={() => void install(plugin.pluginKey)}
                                disabled={installing === plugin.pluginKey}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium disabled:opacity-50 transition-colors"
                                style={{ background: '#16a34a' }}
                              >
                                <Plus size={12} /> {installing === plugin.pluginKey ? '安装中...' : '安装'}
                              </button>
                            ) : (
                              <>
                                {fields.length > 0 && (
                                  <button
                                    onClick={() => { setConfigTarget(plugin); setConfigValues(plugin.config); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                                  >
                                    <Settings size={12} /> 配置
                                  </button>
                                )}
                                <button
                                  onClick={() => void testPlugin(plugin.pluginKey)}
                                  disabled={testing === plugin.pluginKey}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white disabled:opacity-50 transition-colors"
                                  style={{ background: '#16a34a' }}
                                >
                                  {testing === plugin.pluginKey ? '测试中...' : '测试'}
                                </button>
                                <button
                                  onClick={() => void uninstall(plugin.pluginKey)}
                                  className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-400 hover:text-red-400 hover:border-red-200 transition-colors"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Plugin Config Modal */}
      <AnimatePresence>
        {configTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
            onClick={() => setConfigTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-[460px] p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{configTarget.icon}</span>
                  <h3 className="font-semibold text-gray-900">{configTarget.nameZh} 配置</h3>
                </div>
                <button onClick={() => setConfigTarget(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                {(PLUGIN_FIELDS[configTarget.pluginKey] ?? []).map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{f.label}</label>
                    <input
                      type={f.secret ? 'password' : 'text'}
                      value={configValues[f.key] ?? ''}
                      onChange={e => setConfigValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400 font-mono"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setConfigTarget(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">取消</button>
                <button
                  onClick={() => void saveConfig(configTarget)}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium"
                  style={{ background: '#16a34a' }}
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
