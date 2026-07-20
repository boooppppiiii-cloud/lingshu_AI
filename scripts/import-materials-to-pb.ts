import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { adminFetch } from '../server/storage/pb.js';

const collection = 'materials';
const taxonomy = JSON.parse(fs.readFileSync(new URL('../data/material-tag-taxonomy.json', import.meta.url), 'utf8')) as Record<string, { industry: string; shotFunction: string; applicability: string; tags: string }>;
const inputs = [
  ['13065486_1080_1920_30fps.mp4', '美容院面部护理特写', 'model', '美容,护理,面部,竖屏'],
  ['8131887-uhd_2160_4096_25fps.mp4', '精华液滴落肌肤微距', 'detail', '精华液,护肤,微距,竖屏'],
  ['13242473_2160_3840_30fps.mp4', '美容仪面部护理实拍', 'model', '美容仪,护理,人物,竖屏'],
  ['10215320-uhd_4096_2160_25fps.mp4', '面霜涂抹细节特写', 'detail', '面霜,护肤,手部,横屏'],
  ['9698783-uhd_3840_2160_25fps.mp4', '护肤产品手持展示', 'product', '产品展示,护肤,手持,横屏'],
  ['6445977-hd_1920_1080_25fps.mp4', '滴管精华产品展示', 'product', '滴管,精华,产品,横屏'],
  ['12984266_1920_1080_25fps.mp4', '工厂自动化生产线', 'factory', '工厂,生产线,制造,横屏'],
  ['13032237_2160_3840_25fps.mp4', '激光切割加工现场', 'factory', '激光切割,加工,设备,竖屏'],
  ['12899884_1920_1080_25fps.mp4', '工厂气动设备特写', 'factory', '工厂,设备,生产线,横屏'],
  ['14117632_1080_1920_30fps.mp4', '制造工厂外景', 'factory', '工厂,厂房,外景,竖屏'],
  ['14804690_1080_1920_24fps.mp4', '工人操作装配生产线', 'factory', '工人,装配,生产线,竖屏'],
  ['13382178_3840_2160_50fps.mp4', '服装工厂缝制车间', 'factory', '服装厂,缝纫,车间,横屏'],
  ['13420549_3840_2160_30fps.mp4', '技术工人设备检修', 'factory', '技术员,设备,检修,横屏'],
  ['13439067_3840_2160_50fps.mp4', '工厂包装流水线', 'factory', '包装,流水线,工人,横屏'],
  ['13814683_3840_2160_100fps.mp4', '现代仓储包装中心', 'factory', '仓储,包装,物流,横屏'],
] as const;

async function ensureCollection() {
  const existing = await adminFetch(`/api/collections/${collection}`);
  if (existing.ok) return;
  const fields = [
    { name: 'title', type: 'text', required: true, max: 200 },
    { name: 'folder', type: 'text', required: true, max: 40 },
    { name: 'type', type: 'text', required: true, max: 20 },
    { name: 'duration', type: 'number' },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'sizeBytes', type: 'number' },
    { name: 'sha256', type: 'text', required: true, max: 64 },
    { name: 'tags', type: 'text' },
    { name: 'industry', type: 'text', max: 80 },
    { name: 'shotFunction', type: 'text', max: 200 },
    { name: 'applicability', type: 'text', max: 40 },
    { name: 'scope', type: 'text', required: true, max: 20 },
    { name: 'usage', type: 'text', required: true, max: 30 },
    { name: 'sourceType', type: 'text', max: 30 },
    { name: 'sourceName', type: 'text', max: 255 },
    { name: 'videoFile', type: 'file', required: true, maxSelect: 1, maxSize: 104857600, mimeTypes: ['video/mp4'] },
    { name: 'posterFile', type: 'file', required: true, maxSelect: 1, maxSize: 5242880, mimeTypes: ['image/jpeg'] },
  ];
  const created = await adminFetch('/api/collections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: collection, type: 'base', listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields, indexes: ['CREATE UNIQUE INDEX idx_materials_sha256 ON materials (sha256)'] }),
  });
  if (!created.ok) throw new Error(`create materials collection failed: ${created.status} ${await created.text()}`);
}

function probe(file: string) {
  const result = spawnSync(String(ffmpegStatic), ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const output = String(result.stderr || '');
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const sizeMatch = output.match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b/);
  const duration = durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : 0;
  return { duration, width: Number(sizeMatch?.[1] || 0), height: Number(sizeMatch?.[2] || 0) };
}

async function main() {
  await ensureCollection();
  for (const [filename, title, folder, tags] of inputs) {
    const file = path.join('/Users/julia_chen/Downloads', filename);
    if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
    const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const query = new URLSearchParams({ perPage: '1', filter: `sha256="${sha256}"` });
    const duplicate = await adminFetch(`/api/collections/${collection}/records?${query}`);
    const duplicateJson = duplicate.ok ? await duplicate.json() as { totalItems?: number } : {};
    if (duplicateJson.totalItems) { console.log(`skip duplicate ${filename}`); continue; }
    const meta = probe(file);
    const poster = path.join('/tmp', `lingshu-${sha256.slice(0, 12)}.jpg`);
    execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.min(1, Math.max(0, meta.duration / 3))), '-i', file, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', '-y', poster]);
    const form = new FormData();
    const structured = taxonomy[filename];
    const values = { title, folder, type: 'video', duration: meta.duration, width: meta.width, height: meta.height, sizeBytes: fs.statSync(file).size, sha256, tags: structured?.tags || tags, industry: structured?.industry || '', shotFunction: structured?.shotFunction || '', applicability: structured?.applicability || '', scope: 'shared', usage: 'editable', sourceType: 'licensed_upload', sourceName: filename };
    for (const [key, value] of Object.entries(values)) form.append(key, String(value));
    form.append('videoFile', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), filename);
    form.append('posterFile', new Blob([fs.readFileSync(poster)], { type: 'image/jpeg' }), `${sha256.slice(0, 12)}.jpg`);
    const response = await adminFetch(`/api/collections/${collection}/records`, { method: 'POST', body: form });
    try { fs.unlinkSync(poster); } catch {}
    if (!response.ok) throw new Error(`upload ${filename} failed: ${response.status} ${await response.text()}`);
    console.log(`uploaded ${folder} ${title}`);
  }
}

main().catch(error => { console.error(error); process.exit(1); });
