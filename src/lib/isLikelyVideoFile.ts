/** 部分系统对本地/拖拽视频给出空 MIME，仅靠扩展名识别 */
export function isLikelyVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  if (file.type === 'application/octet-stream' || file.type === '') {
    return /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg|3gp|ogv)(\?.*)?$/i.test(file.name);
  }
  return false;
}
