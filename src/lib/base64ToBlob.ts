export function base64ToBlob(base64: string, mimeType: string): Blob {
  const normalized = base64.includes(',') ? base64.split(',')[1]! : base64;
  const bin = atob(normalized);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}
