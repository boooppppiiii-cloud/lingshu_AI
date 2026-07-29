import type { CustomerProfile } from '../types/customer';

export function createMockCustomers(): CustomerProfile[] {
  return [{
    id: 'mock-customer-conversation', name: 'Emily Carter', avatar: 'E', countryName: '美国', language: 'English', languageLocked: true,
    source: 'whatsapp', product: '', outboundProduct: '', estimatedValue: '待评估',
    stage: 'lead', intentScore: 50, intentSignals: ['待模拟'], handlingMode: 'ai_draft', handlingReason: '等待输入模拟客户的第一句话',
    priority: 70, inboxReason: 'reply', lastActive: '刚刚', localTime: '10:30', orders: [], tags: ['Mock', '回复质量测试'],
    summary: '空白 Mock 客户，用于从第一次对话开始验证智能客服。', nextStep: '在对话框中输入客户可能会说的话', timeline: [],
    hasUnread: false, isReal: false, isMock: true,
  }];
}
