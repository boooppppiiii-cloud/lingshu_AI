import type { ViewState } from '../types';

export const VIEW_MODULE_LABELS: Record<ViewState, string> = {
  market: '灵感市场',
  buying_dashboard: '买量大屏',
  workshop: '创意工坊',
  assets: '资产卡片',
  profile: '个人中心',
  volume_space: '起量空间',
  team_cases: '团队案例',
};

export function viewModuleSuggestions(view: ViewState): string[] {
  switch (view) {
    case 'buying_dashboard':
      return [
        '当前页面你推荐什么样的钩子？',
        '最近卡牌买量有什么新趋势？',
        '福利诱导类开场素材多吗？表现如何？',
      ];
    case 'market':
      return ['这页适合找什么方向的灵感？', '最近卡牌类题材有什么共性？', '怎么把市场灵感用到脚本里？'];
    case 'workshop':
      return ['脚本开头怎么更抓人？', '分镜节奏有什么建议？', '卖点和钩子怎么对齐？'];
    case 'assets':
      return ['资产卡片怎么分类更好找？', '历史爆款有什么可复用点？', '怎么从资产反推新脚本？'];
    case 'volume_space':
      return ['起量素材通常有什么特征？', '哪些钩子适合先小规模测试？', '起量失败常见原因有哪些？'];
    case 'team_cases':
      return ['团队案例里表现最好的是什么类型？', '有哪些可复用的结构？', '和竞品 TOP 差在哪？'];
    case 'profile':
      return ['设计专员和投放专员菜单有什么区别？', '怎么切换当前游戏项目？', '买量大屏数据从哪来？'];
    default:
      return ['这页主要能帮我做什么？', '有什么使用小技巧？'];
  }
}

export function viewModuleWelcome(view: ViewState, hasBuyingData: boolean): string {
  if (view === 'buying_dashboard' && hasBuyingData) {
    return '嗨～我是 SA小三郎！可结合本页素材、联网检索和买量经验，问我钩子、趋势或创意～';
  }
  if (view === 'buying_dashboard') {
    return '嗨～我是 SA小三郎！本页暂无素材时，也可联网查行业动态或聊通用买量思路～';
  }
  const label = VIEW_MODULE_LABELS[view];
  return `嗨～我是 SA小三郎！在「${label}」可聊用法与创意；有列表数据时优先看本页，也会联网补充～`;
}
