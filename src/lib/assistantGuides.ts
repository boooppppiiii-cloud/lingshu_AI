export type AssistantGuide = {
  title: string;
  message: string;
  agent: 'strategy' | 'traffic' | 'conversion' | 'retention';
};

export const ASSISTANT_GUIDES: Record<string, AssistantGuide> = {
  'strategy-dashboard': {
    title: '看经营数据',
    message: '先扫一眼异常和待办，哪里亮红就先处理哪里。',
    agent: 'strategy',
  },
  'social-inspiration': {
    title: '找内容灵感',
    message: '按平台和热度筛一筛，看到顺眼的就拿去写脚本。',
    agent: 'traffic',
  },
  'analysis-evidence': {
    title: '看素材分析',
    message: '先看证据和分镜，挑能用的亮点，别只看标题。',
    agent: 'traffic',
  },
  'ai-create': {
    title: '用 AI 做素材',
    message: '选好产品和参考素材，脚本、画面和多语版交给我。',
    agent: 'traffic',
  },
  'ai-storyboard': {
    title: '搭配分镜',
    message: '有素材就拖进来，缺镜头就让我帮你补。',
    agent: 'traffic',
  },
  'ai-voice': {
    title: '选择声音',
    message: '先试听，再调语速和情绪，顺耳了再生成。',
    agent: 'traffic',
  },
  'ai-audio-mix': {
    title: '调整音量',
    message: '先保证人声清楚，背景乐别盖住口播就行。',
    agent: 'traffic',
  },
  'publishing-workbench': {
    title: '一键发布',
    message: '加视频、选账号、看文案，没问题就发布或排期。',
    agent: 'traffic',
  },
  'publish-accounts': {
    title: '选择账号',
    message: '只发这条就单选，想省事就把账号应用到全部视频。',
    agent: 'traffic',
  },
  'publish-recommendations': {
    title: '看发布建议',
    message: '先处理“调整后发布”的内容，免得卡在平台审核。',
    agent: 'traffic',
  },
  'publish-mode': {
    title: '现在发还是排期',
    message: '着急就现在发，不着急就先放进日历。',
    agent: 'traffic',
  },
  'content-planner': {
    title: '安排内容',
    message: '上面看已定内容，下面挑未来计划，确认后才进日历。',
    agent: 'traffic',
  },
  'content-calendar': {
    title: '使用内容日历',
    message: '点空日期加内容，点已有内容就能继续编辑。',
    agent: 'traffic',
  },
  'publishing-tide': {
    title: '看发布潮汐',
    message: '曲线越高越适合发，优先挑高点附近的时间。',
    agent: 'traffic',
  },
  'ai-layout': {
    title: '让 AI 帮忙排',
    message: '打开后我先排一版，你可以再拖动调整，不会自动发。',
    agent: 'traffic',
  },
  'future-queue': {
    title: '未来排产',
    message: '拖卡片换日期，满意点确认，不满意就换一版。',
    agent: 'traffic',
  },
  'publishing-rhythm': {
    title: '设置发布节奏',
    message: '先选轻度、标准或高频，我会自动找合适的空档。',
    agent: 'traffic',
  },
  'social-performance': {
    title: '看账号表现',
    message: '先选账号，再看看哪些内容涨粉、互动更好。',
    agent: 'traffic',
  },
  'customer-workbench': {
    title: '跟进客户',
    message: '先处理高意向和待办客户，别让热询盘等太久。',
    agent: 'conversion',
  },
  'customer-knowledge-save': {
    title: '存进知识库',
    message: '确认答案靠谱再保存，之后回复同类问题更省心。',
    agent: 'conversion',
  },
  'orders-workbench': {
    title: '查看订单',
    message: '先看异常和待跟进订单，正常订单不用一条条翻。',
    agent: 'conversion',
  },
  'enterprise-center': {
    title: '完善企业资料',
    message: '产品、市场和报价写得越全，我给的建议就越准。',
    agent: 'strategy',
  },
  'enterprise-autonomy': {
    title: '选择 AI 参与程度',
    message: '不放心就先选“草稿需确认”，看顺手了再放开。',
    agent: 'strategy',
  },
  'enterprise-faq-pack': {
    title: '导入知识包',
    message: '挑最接近你行业的，导入后再过一遍答案。',
    agent: 'strategy',
  },
  'enterprise-order-import': {
    title: '导入订单',
    message: '把订单表传上来，金额、利润和履约会自动整理。',
    agent: 'strategy',
  },
  'enterprise-night-mode': {
    title: '设置夜间接待',
    message: '夜里我先接着，拿不准的会留给你第二天确认。',
    agent: 'strategy',
  },
  'scheduled-tasks': {
    title: '设置定时任务',
    message: '选好要做的事和时间，保存后我会按点执行。',
    agent: 'strategy',
  },
  'channel-connections': {
    title: '连接平台账号',
    message: '选平台后按提示授权，连上了这里会显示状态。',
    agent: 'strategy',
  },
  'assistant-team': {
    title: '找对助手',
    message: '做内容、聊客户、看策略，挑对应的小助手就行。',
    agent: 'strategy',
  },
};
