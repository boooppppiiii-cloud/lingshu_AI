export type KeywordPlatform = 'instagram' | 'youtube' | 'tiktok' | 'facebook';

export interface KeywordNormalizationResult {
  items: string[];
  serialized: string;
  changes: string[];
  warnings: string[];
  rejected: string[];
}

const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 80;
const STRONG_SEPARATOR = /[\n\r,，;；、|｜•·]+/g;
const URL_PATTERN = /https?:\/\/[^\s,，;；、|｜]+/giu;
const HASHTAG_PATTERN = /#+([\p{L}\p{M}\p{N}_]+)/gu;

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scriptOf(value: string): string {
  if (/\p{Script=Arabic}/u.test(value)) return 'arabic';
  if (/\p{Script=Cyrillic}/u.test(value)) return 'cyrillic';
  if (/\p{Script=Han}/u.test(value)) return 'han';
  if (/\p{Script=Latin}/u.test(value)) return 'latin';
  return 'other';
}

function instagramTagsFromPhrase(value: string): { tags: string[]; splitByLanguage: boolean } {
  const words = value
    .replace(/[“”‘’"'`()[\]{}<>《》【】]/g, ' ')
    .split(/\s+/)
    .map(word => word.replace(/[^\p{L}\p{M}\p{N}_]/gu, ''))
    .filter(Boolean);
  if (!words.length) return { tags: [], splitByLanguage: false };

  const groups: string[][] = [];
  for (const word of words) {
    const current = groups[groups.length - 1];
    if (!current || scriptOf(current[0]) !== scriptOf(word)) groups.push([word]);
    else current.push(word);
  }
  return {
    tags: groups.map(group => `#${group.join('')}`),
    splitByLanguage: groups.length > 1,
  };
}

function cleanUrl(raw: string, platform: KeywordPlatform): { value?: string; rejected?: string; tag?: string } {
  const value = raw.replace(/[)\]}>。，、；;!?！？]+$/u, '');
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const expectedHosts: Record<KeywordPlatform, string[]> = {
      instagram: ['instagram.com'],
      youtube: ['youtube.com', 'youtu.be'],
      tiktok: ['tiktok.com'],
      facebook: ['facebook.com', 'fb.watch'],
    };
    if (!expectedHosts[platform].some(expected => host === expected || host.endsWith(`.${expected}`))) {
      return { rejected: value };
    }
    if (platform === 'instagram') {
      const tagMatch = url.pathname.match(/^\/explore\/tags\/([^/]+)/i);
      if (tagMatch) return { tag: `#${decodeURIComponent(tagMatch[1]).replace(/^#+/, '')}` };
    }
    url.hash = '';
    return { value: url.toString() };
  } catch {
    return { rejected: value };
  }
}

export function normalizeKeywordInput(raw: string, platform: KeywordPlatform): KeywordNormalizationResult {
  const changes = new Set<string>();
  const warnings = new Set<string>();
  const rejected: string[] = [];
  const source = String(raw || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^\s*(关键词|关键字|keywords?|tags?|hashtags?)\s*[:：]\s*/gimu, '')
    .trim();
  if (source !== String(raw || '').trim()) changes.add('已移除隐藏字符和输入标签');

  const urls: string[] = [];
  let text = source.replace(URL_PATTERN, match => {
    const cleaned = cleanUrl(match, platform);
    if (cleaned.rejected) rejected.push(cleaned.rejected);
    if (cleaned.tag) urls.push(cleaned.tag);
    if (cleaned.value) urls.push(cleaned.value);
    return ' ';
  });

  const hashtags: string[] = [];
  text = text.replace(HASHTAG_PATTERN, (_match, tag: string) => {
    hashtags.push(`#${tag.replace(/^#+/, '')}`);
    return ' ';
  });
  if (hashtags.length) changes.add('已识别并拆分井号标签');

  const chunks = text
    .replace(STRONG_SEPARATOR, '\n')
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);

  const plain: string[] = [];
  for (const chunk of chunks) {
    if (platform === 'instagram') {
      const normalized = instagramTagsFromPhrase(chunk);
      plain.push(...normalized.tags);
      if (/\s/.test(chunk)) changes.add('已合并 Instagram 标签中的空格');
      if (normalized.splitByLanguage) changes.add('已按语种拆分混合内容');
    } else {
      const cleaned = chunk
        .replace(/[“”‘’"'`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) plain.push(cleaned);
    }
  }

  if (rejected.length) warnings.add(`已忽略 ${rejected.length} 个非 ${platform} 平台链接`);
  let items = unique([...urls, ...hashtags, ...plain]
    .map(item => item.trim())
    .filter(Boolean));
  if (items.length < urls.length + hashtags.length + plain.length) changes.add('已合并重复关键词');

  const tooLong = items.filter(item => item.length > MAX_KEYWORD_LENGTH);
  if (tooLong.length) {
    warnings.add(`已忽略 ${tooLong.length} 个超过 ${MAX_KEYWORD_LENGTH} 字符的关键词`);
    rejected.push(...tooLong);
    items = items.filter(item => item.length <= MAX_KEYWORD_LENGTH);
  }
  if (items.length > MAX_KEYWORDS) {
    warnings.add(`单次最多使用 ${MAX_KEYWORDS} 个关键词，超出部分已忽略`);
    rejected.push(...items.slice(MAX_KEYWORDS));
    items = items.slice(0, MAX_KEYWORDS);
  }

  if (platform === 'instagram' && items.some(item => item.startsWith('#'))) {
    warnings.add('Instagram 标签将按独立语言圈层分别采集');
  }
  return {
    items,
    serialized: items.join(', '),
    changes: [...changes],
    warnings: [...warnings],
    rejected: unique(rejected),
  };
}
