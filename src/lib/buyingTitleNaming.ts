/**
 * 买量视频命名：`竞品名称-YYYYMMDD-序号-版位`
 * 例：`织梦森林-20260519-36-微信视频号`
 */
export type BuyingTitleNaming = {
  competitorName: string;
  uploadDate: string;
  sequence: string;
  placement: string;
};

const TITLE_NAMING_RE = /^(.+?)-(\d{8})-(\d+)-(.+)$/;

function formatYmd8(ymd: string): string {
  if (ymd.length !== 8 || !/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function displayOrDash(value: string): string {
  const t = value.trim();
  return t || '—';
}

/** 从视频名称（标题/文件名）解析竞品名称、上传日期、序号、版位 */
export function parseBuyingTitleNaming(title: string): BuyingTitleNaming {
  const raw = title.trim();
  if (!raw) {
    return {
      competitorName: '—',
      uploadDate: '—',
      sequence: '—',
      placement: '—',
    };
  }

  const m = raw.match(TITLE_NAMING_RE);
  if (!m) {
    return {
      competitorName: displayOrDash(raw),
      uploadDate: '—',
      sequence: '—',
      placement: '—',
    };
  }

  const [, competitorName, ymd, sequence, placement] = m;
  return {
    competitorName: displayOrDash(competitorName ?? ''),
    uploadDate: displayOrDash(formatYmd8(ymd ?? '')),
    sequence: displayOrDash(sequence ?? ''),
    placement: displayOrDash(placement ?? ''),
  };
}
