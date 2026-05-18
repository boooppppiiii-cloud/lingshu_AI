/** 买量大屏 → 创意工坊「创意迭代」跨页传递的视频载荷 */
export type IterationVideoPayload = {
  base64: string;
  mimeType: string;
  size?: number;
  title?: string;
};

export type IterationHandoff = {
  video: IterationVideoPayload;
  autoAnalyze: boolean;
};
