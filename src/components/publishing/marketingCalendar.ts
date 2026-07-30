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

// Fixed lookup tables keep movable holidays on their real calendar dates.
// Islamic festival dates may still be adjusted locally after an official moon sighting.
const LUNAR_NEW_YEAR_DATES: Record<number, [number, number]> = {
  2025: [1, 29], 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3],
};
const DIWALI_DATES: Record<number, [number, number]> = {
  2025: [10, 20], 2026: [11, 8], 2027: [10, 29], 2028: [10, 17], 2029: [11, 5], 2030: [10, 26],
};
const RAMADAN_START_DATES: Record<number, [number, number]> = {
  2025: [3, 1], 2026: [2, 18], 2027: [2, 8], 2028: [1, 28], 2029: [1, 16], 2030: [1, 6],
};
const EID_AL_FITR_DATES: Record<number, [number, number]> = {
  2025: [3, 30], 2026: [3, 20], 2027: [3, 10], 2028: [2, 27], 2029: [2, 15], 2030: [2, 5],
};
const EID_AL_ADHA_DATES: Record<number, [number, number]> = {
  2025: [6, 6], 2026: [5, 27], 2027: [5, 16], 2028: [5, 4], 2029: [4, 23], 2030: [4, 13],
};

function mappedDate(year: number, dates: Record<number, [number, number]>): string | null {
  const value = dates[year];
  return value ? fixedDate(year, value[0], value[1]) : null;
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
  const mothersDay = nthWeekday(year, 4, 0, 2);
  const fathersDay = nthWeekday(year, 5, 0, 3);
  const lunarNewYear = mappedDate(year, LUNAR_NEW_YEAR_DATES);
  const diwali = mappedDate(year, DIWALI_DATES);
  const ramadanStart = mappedDate(year, RAMADAN_START_DATES);
  const eidAlFitr = mappedDate(year, EID_AL_FITR_DATES);
  const eidAlAdha = mappedDate(year, EID_AL_ADHA_DATES);

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
      id: `${year}-valentines-day`,
      date: fixedDate(year, 2, 14),
      name: "Valentine's Day 情人节",
      shortName: '情人节',
      market: 'global',
      prepDays: 35,
      note: '礼赠、美妆、饰品、服装和生活方式品类的重要消费节点。',
      source: '公历固定日期：2 月 14 日',
    },
    {
      id: `${year}-womens-day`,
      date: fixedDate(year, 3, 8),
      name: "International Women's Day 国际妇女节",
      shortName: '妇女节',
      market: 'global',
      prepDays: 28,
      note: '在欧洲、俄罗斯及独联体、亚洲和拉美具有较强礼赠与促销需求。',
      source: '公历固定日期：3 月 8 日',
    },
    {
      id: `${year}-brazil-consumer-day`,
      date: fixedDate(year, 3, 15),
      name: 'Dia do Consumidor 巴西消费者日',
      shortName: '巴西消费者日',
      market: 'latin-america',
      prepDays: 30,
      note: '巴西上半年重要线上促销节点，适合折扣、免运费和再营销。',
      source: '巴西固定电商节点：3 月 15 日',
    },
    {
      id: `${year}-mothers-day`,
      date: localDateKey(mothersDay),
      name: "Mother's Day 母亲节",
      shortName: '母亲节',
      market: 'global',
      prepDays: 45,
      note: '北美、欧洲及多国常用的礼赠、美妆、家居和生活方式消费节点。',
      source: '每年 5 月第二个星期日（主要电商市场口径）',
    },
    {
      id: `${year}-fathers-day`,
      date: localDateKey(fathersDay),
      name: "Father's Day 父亲节",
      shortName: '父亲节',
      market: 'global',
      prepDays: 35,
      note: '适合男士用品、工具、户外、电子与礼赠内容。',
      source: '每年 6 月第三个星期日（主要电商市场口径）',
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
      id: `${year}-sea-99`,
      date: fixedDate(year, 9, 9),
      name: '9.9 Mega Sale 东南亚 9.9 大促',
      shortName: '9.9 大促',
      market: 'southeast-asia',
      prepDays: 35,
      note: '东南亚平台型电商的重要预热节点，适合短视频、直播和优惠组合。',
      source: '固定电商营销节点：9 月 9 日',
    },
    {
      id: `${year}-sea-1010`,
      date: fixedDate(year, 10, 10),
      name: '10.10 Mega Sale 东南亚 10.10 大促',
      shortName: '10.10 大促',
      market: 'southeast-asia',
      prepDays: 35,
      note: '东南亚第四季度大促前哨，适合蓄水、加购和达人素材测试。',
      source: '固定电商营销节点：10 月 10 日',
    },
    {
      id: `${year}-halloween`,
      date: fixedDate(year, 10, 31),
      name: 'Halloween 万圣节',
      shortName: '万圣节',
      market: 'north-america',
      prepDays: 40,
      note: '北美及欧洲的重要主题消费节点，适合装饰、服装、美妆、玩具与派对品类。',
      source: '公历固定日期：10 月 31 日',
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
      id: `${year}-sea-1212`,
      date: fixedDate(year, 12, 12),
      name: '12.12 Mega Sale 东南亚双 12 大促',
      shortName: '12.12 大促',
      market: 'southeast-asia',
      prepDays: 40,
      note: '东南亚年末重点大促，适合清单式内容、直播与礼赠套装。',
      source: '固定电商营销节点：12 月 12 日',
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
    {
      id: `${year}-boxing-day`,
      date: fixedDate(year, 12, 26),
      name: 'Boxing Day 节礼日促销',
      shortName: '节礼日',
      market: 'oceania',
      prepDays: 35,
      note: '英国、加拿大、澳大利亚与新西兰的重要年末清仓节点。',
      source: '公历固定日期：12 月 26 日',
    },
    ...(lunarNewYear ? [{
      id: `${year}-lunar-new-year`,
      date: lunarNewYear,
      name: 'Lunar New Year 农历新年',
      shortName: '农历新年',
      market: 'east-asia' as const,
      prepDays: 60,
      note: '东亚及东南亚重要礼赠、返乡、家居、美妆和年货消费节点。',
      source: '逐年农历日期对照',
    }] : []),
    ...(ramadanStart ? [{
      id: `${year}-ramadan-start`,
      date: ramadanStart,
      name: 'Ramadan 斋月营销季开始',
      shortName: '斋月开始',
      market: 'middle-east' as const,
      prepDays: 60,
      note: '中东、北非及穆斯林市场重要的内容、礼赠、食品和夜间消费周期起点。',
      source: year === 2026 ? '2026 年实际历法日期' : '逐年历法日期（受观月影响可能调整）',
    }] : []),
    ...(eidAlFitr ? [{
      id: `${year}-eid-al-fitr`,
      date: eidAlFitr,
      name: 'Eid al-Fitr 开斋节',
      shortName: '开斋节',
      market: 'middle-east' as const,
      prepDays: 55,
      note: '中东及穆斯林市场的重要礼赠、服饰、美妆、食品和家庭消费节点。',
      source: year === 2026 ? '2026 年官方节期口径' : '逐年历法日期（受观月影响可能调整）',
    }] : []),
    ...(eidAlAdha ? [{
      id: `${year}-eid-al-adha`,
      date: eidAlAdha,
      name: 'Eid al-Adha 宰牲节',
      shortName: '宰牲节',
      market: 'middle-east' as const,
      prepDays: 50,
      note: '中东及穆斯林市场的重要家庭、礼赠、食品和出行消费节点。',
      source: year === 2026 ? '2026 年历法日期' : '逐年历法日期（受观月影响可能调整）',
    }] : []),
    ...(diwali ? [{
      id: `${year}-diwali`,
      date: diwali,
      name: 'Diwali 排灯节',
      shortName: '排灯节',
      market: 'south-asia' as const,
      prepDays: 60,
      note: '印度及南亚市场全年重要的礼赠、家居、服饰、珠宝和电商促销节点。',
      source: year === 2026 ? '印度政府 2026 年节假日日期' : '逐年印度节庆日期对照',
    }] : []),
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
