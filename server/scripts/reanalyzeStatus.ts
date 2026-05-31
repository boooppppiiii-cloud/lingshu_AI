/**
 * 打印买量视频全库重分析进度（JSON + 简要中文摘要）
 *
 *   npm run reanalyze:status
 */
import {
  DEFAULT_REANALYZE_PROGRESS_FILE,
  readReanalyzeProgress,
} from '../reanalyzeProgress';

const file = process.env.REANALYZE_PROGRESS_FILE?.trim() || DEFAULT_REANALYZE_PROGRESS_FILE;
const state = readReanalyzeProgress(file);

if (!state) {
  console.log(`暂无进度（文件不存在: ${file}）`);
  console.log('若任务未启动，请执行: npm run reanalyze:buying-videos');
  process.exit(0);
}

console.log(JSON.stringify(state, null, 2));
console.log('');
const running = state.status === 'running';
console.log(
  [
    running ? '▶ 运行中' : state.status === 'done' ? '✓ 已完成' : '✗ 异常',
    `进度 ${state.percent}%（${state.completed}/${state.totalItems}）`,
    `成功 ${state.ingested} · 失败 ${state.failed} · 跳过 ${state.skipped}`,
    `第 ${state.currentPage}/${state.totalPages} 页`,
    state.phase === 'gemini' && state.currentTitle
      ? `正在分析: ${state.currentTitle}`
      : state.lastMessage,
  ].join('\n  '),
);
