/** PocketBase `usage_events.event` 取值（创意类含两种不同事件） */
export const USAGE_EVENT = {
  CREATIVE_IDEAS_GENERATED: 'creative.ideas_generated',
  CREATIVE_INSPIRATION_SAVED: 'creative.inspiration_saved',
  SCRIPT_GENERATED: 'script.generated',
  /** 灵光一闪脚本诊断（3s/8s + 情绪曲线）成功写入流水时使用 */
  SCRIPT_DIAGNOSED: 'script.diagnosed',
  MARKET_PUBLISHED: 'market.published',
  LIKE_GIVEN: 'like.given',
  LIKE_RECEIVED: 'like.received',
  GEMINI_CALL: 'gemini.call',
} as const;
