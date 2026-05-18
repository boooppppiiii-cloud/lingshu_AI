export function readBlobAsBase64Body(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result ?? '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    fr.onerror = () => reject(new Error('读取视频失败'));
    fr.readAsDataURL(blob);
  });
}

export async function fetchUrlAsIterationVideo(url: string): Promise<{
  base64: string;
  mimeType: string;
  size: number;
}> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载预览视频失败（${res.status}）`);
  }
  const blob = await res.blob();
  const base64 = await readBlobAsBase64Body(blob);
  return {
    base64,
    mimeType: blob.type || 'video/mp4',
    size: blob.size,
  };
}
