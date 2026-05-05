/** 与前端 `formatUsageDayShanghai` 一致 */
export function formatUsageDayShanghai(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
