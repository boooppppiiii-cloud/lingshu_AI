import { useEffect, useMemo, useState } from 'react';

function formatTime(timeZone?: string) {
  if (!timeZone) return '未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return '未知';
  }
}

export function LiveLocalTime({ timeZone }: { timeZone?: string }) {
  const initial = useMemo(() => formatTime(timeZone), [timeZone]);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(formatTime(timeZone));
    const timer = window.setInterval(() => setValue(formatTime(timeZone)), 1000);
    return () => window.clearInterval(timer);
  }, [timeZone]);

  return <>{value}</>;
}
