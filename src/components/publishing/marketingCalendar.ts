export type MarketId =
  | 'global'
  | 'north-america'
  | 'europe'
  | 'middle-east'
  | 'southeast-asia'
  | 'central-asia'
  | 'south-asia'
  | 'east-asia'
  | 'latin-america'
  | 'africa'
  | 'oceania'
  | 'cis';

export type MarketingEvent = {
  id: string;
  date: string;
  name: string;
  shortName: string;
  market: Exclude<MarketId, 'global'> | 'global';
  prepDays: number;
  note: string;
  source: string;
};

export const MARKET_OPTIONS: Array<{
  id: MarketId;
  label: string;
  timeZone: string;
  timeZoneLabel: string;
}> = [
  { id: 'global', label: '综合市场', timeZone: 'UTC', timeZoneLabel: 'UTC' },
  { id: 'north-america', label: '北美', timeZone: 'America/New_York', timeZoneLabel: '纽约时间' },
  { id: 'europe', label: '欧洲', timeZone: 'Europe/Berlin', timeZoneLabel: '柏林时间' },
  { id: 'middle-east', label: '中东', timeZone: 'Asia/Dubai', timeZoneLabel: '迪拜时间' },
  { id: 'southeast-asia', label: '东南亚', timeZone: 'Asia/Singapore', timeZoneLabel: '新加坡时间' },
  { id: 'central-asia', label: '中亚', timeZone: 'Asia/Almaty', timeZoneLabel: '阿拉木图时间' },
  { id: 'south-asia', label: '南亚', timeZone: 'Asia/Kolkata', timeZoneLabel: '印度时间' },
  { id: 'east-asia', label: '东亚', timeZone: 'Asia/Tokyo', timeZoneLabel: '东京时间' },
  { id: 'latin-america', label: '拉美', timeZone: 'America/Sao_Paulo', timeZoneLabel: '圣保罗时间' },
  { id: 'africa', label: '非洲', timeZone: 'Africa/Johannesburg', timeZoneLabel: '约翰内斯堡时间' },
  { id: 'oceania', label: '大洋洲', timeZone: 'Australia/Sydney', timeZoneLabel: '悉尼时间' },
  { id: 'cis', label: '俄罗斯及独联体', timeZone: 'Europe/Moscow', timeZoneLabel: '莫斯科时间' },
];

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fixedDate(year: number, month: number, day: number): string {
  return localDateKey(new Date(year, month - 1, day));
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  const first = new Date(year, month, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + shift + (nth - 1) * 7);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function eventsForYear(year: number): MarketingEvent[] {
  const laborDay = nthWeekday(year, 8, 1, 1);
  const thanksgiving = nthWeekday(year, 10, 4, 4);
  const blackFriday = addDays(thanksgiving, 1);
  const cyberMonday = addDays(thanksgiving, 4);

  return [
    {
      id: `${year}-new-year`,
      date: fixedDate(year, 1, 1),
      name: 'New Year 元旦营销',
      shortName: '元旦营销',
      market: 'global',
      prepDays: 35,
      note: '适合年度新品、年度采购计划与客户感谢内容。',
      source: '固定日期营销节点',
    },
    {
      id: `${year}-us-independence`,
      date: fixedDate(year, 7, 4),
      name: 'US Independence Day 美国独立日',
      shortName: '美国独立日',
      market: 'north-america',
      prepDays: 28,
      note: '适合夏季、户外、派对及红白蓝主题内容，需提前确认表达合规。',
      source: '美国固定日期节日',
    },
    {
      id: `${year}-indonesia-independence`,
      date: fixedDate(year, 8, 17),
      name: 'Indonesia Independence Day 印尼独立日',
      shortName: '印尼独立日',
      market: 'southeast-asia',
      prepDays: 30,
      note: '适合红白视觉、本地化标签、礼赠套装和 TikTok 内容预热。',
      source: '印度尼西亚固定日期节日',
    },
    {
      id: `${year}-us-labor-day`,
      date: localDateKey(laborDay),
      name: 'Labor Day 美国劳动节',
      shortName: '美国劳动节',
      market: 'north-america',
      prepDays: 30,
      note: '适合夏末促销、返校季和秋季采购内容。',
      source: '每年九月第一个星期一',
    },
    {
      id: `${year}-saudi-national-day`,
      date: fixedDate(year, 9, 23),
      name: 'Saudi National Day 沙特国庆日',
      shortName: '沙特国庆日',
      market: 'middle-east',
      prepDays: 35,
      note: '适合绿色视觉、礼赠套装和阿拉伯语/英语双语内容。',
      source: '沙特阿拉伯固定日期节日',
    },
    {
      id: `${year}-german-unity`,
      date: fixedDate(year, 10, 3),
      name: 'German Unity Day 德国统一日',
      shortName: '德国统一日',
      market: 'europe',
      prepDays: 21,
      note: '适合德国市场品牌露出、合规资质和秋季采购内容。',
      source: '德国固定日期节日',
    },
    {
      id: `${year}-singles-day`,
      date: fixedDate(year, 11, 11),
      name: "Singles' Day 双11跨境节点",
      shortName: '双11',
      market: 'global',
      prepDays: 45,
      note: '适合价格带、组合装、直播素材和多平台预热。',
      source: '固定日期电商营销节点',
    },
    {
      id: `${year}-black-friday`,
      date: localDateKey(blackFriday),
      name: 'Black Friday 黑色星期五',
      shortName: '黑五',
      market: 'global',
      prepDays: 60,
      note: '重点准备优惠结构、库存、素材矩阵和客户分层触达。',
      source: '美国感恩节后第一个星期五',
    },
    {
      id: `${year}-cyber-monday`,
      date: localDateKey(cyberMonday),
      name: 'Cyber Monday 网络星期一',
      shortName: '网一',
      market: 'global',
      prepDays: 50,
      note: '适合线上专属优惠、再营销和黑五未转化客户追投。',
      source: '美国感恩节后的星期一',
    },
    {
      id: `${year}-uae-national-day`,
      date: fixedDate(year, 12, 2),
      name: 'UAE National Day 阿联酋国庆日',
      shortName: '阿联酋国庆日',
      market: 'middle-east',
      prepDays: 35,
      note: '适合礼赠、套装和阿拉伯语/英语双语上新内容。',
      source: '阿联酋固定日期节日',
    },
    {
      id: `${year}-christmas`,
      date: fixedDate(year, 12, 25),
      name: 'Christmas Day 圣诞节',
      shortName: '圣诞节',
      market: 'global',
      prepDays: 60,
      note: '礼盒、年末促销和客户感谢节点，需提前准备交付与物流说明。',
      source: '固定日期国际节日',
    },
  ];
}

export function buildMarketingEvents(anchor: Date): MarketingEvent[] {
  return [anchor.getFullYear() - 1, anchor.getFullYear(), anchor.getFullYear() + 1]
    .flatMap(eventsForYear)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function eventsForMarket(events: MarketingEvent[], market: MarketId): MarketingEvent[] {
  if (market === 'global') return events;
  return events.filter(event => event.market === 'global' || event.market === market);
}

export function dateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function daysBetween(from: Date, to: Date): number {
  const fromStart = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toStart = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((toStart - fromStart) / 86_400_000);
}

export function campaignPhase(event: MarketingEvent, date: Date): {
  label: '准备期' | '预热期' | '冲刺期' | '爆发日';
  days: number;
} | null {
  const days = daysBetween(date, dateFromKey(event.date));
  if (days < 0 || days > event.prepDays) return null;
  if (days === 0) return { label: '爆发日', days };
  if (days <= 3) return { label: '冲刺期', days };
  if (days <= 14) return { label: '预热期', days };
  return { label: '准备期', days };
}

export function timeZoneOffsetHours(timeZone: string, date: Date): number {
  if (timeZone === 'UTC') return 0;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round(((representedAsUtc - date.getTime()) / 3_600_000) * 2) / 2;
}
