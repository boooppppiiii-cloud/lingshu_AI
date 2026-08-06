import assert from 'node:assert/strict';
import { parseExactAnalysisResponse } from './InspirationDashboard.js';

const queued = parseExactAnalysisResponse('{"status":"pending","id":"record-1"}', 202);
assert.deepEqual(queued, {
  error: undefined,
  status: 'pending',
  reused: undefined,
  id: 'record-1',
});

const backendError = parseExactAnalysisResponse('{"error":"Material not found"}', 404);
assert.equal(backendError.error, 'Material not found');

const proxyHtml = parseExactAnalysisResponse('<!doctype html><pre>Cannot POST /api/overseas/videos/material-exact-analysis</pre>', 404);
assert.equal(proxyHtml.error, '全片精确分析接口返回异常（HTTP 404）');

console.log('InspirationDashboard exact-analysis response tests passed');
