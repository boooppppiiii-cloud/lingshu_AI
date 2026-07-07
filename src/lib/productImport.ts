import * as XLSX from 'xlsx';

export const PRODUCT_SCHEMA_FIELDS = [
  'sku',
  'name',
  'color',
  'size',
  'tagPrice',
  'material',
  'imageUrl',
  'highlights',
] as const;

export type ProductSchemaField = (typeof PRODUCT_SCHEMA_FIELDS)[number];
export type ProductMapping = Record<string, ProductSchemaField | ''>;

export const PRODUCT_FIELD_LABELS: Record<ProductSchemaField, string> = {
  sku: '货号',
  name: '商品名称',
  color: '颜色',
  size: '尺码',
  tagPrice: '吊牌价',
  material: '面料/材质',
  imageUrl: '图片URL',
  highlights: '一句话卖点',
};

export interface ParsedSheet {
  name: string;
  rows: unknown[][];
  rowCount: number;
}

export interface PreparedSheet {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  sampleRows: Record<string, string>[];
  dataRows: Record<string, string>[];
}

const text = (v: unknown) => (v == null ? '' : String(v).trim());

function normalizeRows(rows: unknown[][]): string[][] {
  return rows.map(row => row.map(text));
}

function fillMergedCells(rows: string[][]): string[][] {
  return rows.map(row => {
    let last = '';
    return row.map(cell => {
      if (cell) {
        last = cell;
        return cell;
      }
      return last;
    });
  });
}

function textRatio(row: string[]) {
  const cells = row.filter(Boolean);
  if (!cells.length) return 0;
  return cells.filter(cell => /[\u4e00-\u9fa5a-zA-Z]/.test(cell) && !/^\d+(\.\d+)?$/.test(cell)).length / cells.length;
}

function regularity(rows: string[][], start: number) {
  const sample = rows.slice(start, start + 5).filter(row => row.some(Boolean));
  if (sample.length < 2) return 0;
  const widths = sample.map(row => row.filter(Boolean).length);
  const avg = widths.reduce((sum, width) => sum + width, 0) / widths.length;
  const dev = widths.reduce((sum, width) => sum + Math.abs(width - avg), 0) / widths.length;
  return Math.max(0, avg - dev);
}

export function findLikelyHeaderRow(rows: string[][]) {
  let best = { index: 0, score: -1 };
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const nonEmpty = rows[i]?.filter(Boolean).length ?? 0;
    if (nonEmpty < 2) continue;
    const score = nonEmpty * 0.8 + textRatio(rows[i]!) * 4 + regularity(rows, i + 1);
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

function headersFrom(rows: string[][], headerRowIndex: number) {
  const top = rows[headerRowIndex] ?? [];
  const next = rows[headerRowIndex + 1] ?? [];
  const doubleHeader = textRatio(next) > 0.72 && regularity(rows, headerRowIndex + 2) >= regularity(rows, headerRowIndex + 1);
  const width = Math.max(top.length, doubleHeader ? next.length : 0);
  return Array.from({ length: width }, (_, index) => {
    const a = top[index] || '';
    const b = doubleHeader ? next[index] || '' : '';
    return a && b && a !== b ? `${a}-${b}` : a || b || `未命名列${index + 1}`;
  });
}

function rowsToObjects(rows: string[][], headers: string[], start: number) {
  return rows
    .slice(start)
    .filter(row => row.some(Boolean))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

export async function parseWorkbook(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
    return { name, rows, rowCount: rows.length };
  });
}

export function prepareSheet(sheet: ParsedSheet): PreparedSheet {
  const rows = fillMergedCells(normalizeRows(sheet.rows));
  const headerRowIndex = findLikelyHeaderRow(rows);
  const headers = headersFrom(rows, headerRowIndex);
  const dataStart = headerRowIndex + (headers.some(header => header.includes('-')) ? 2 : 1);
  const dataRows = rowsToObjects(rows, headers, dataStart);
  return {
    sheetName: sheet.name,
    headerRowIndex,
    headers,
    sampleRows: dataRows.slice(0, 5),
    dataRows,
  };
}

const RULES: Array<[ProductSchemaField, RegExp]> = [
  ['sku', /货号|款号|sku|spu|编码|商品编号/i],
  ['name', /品名|名称|商品|标题|product/i],
  ['color', /颜色|色号|color/i],
  ['size', /尺码|规格|尺寸|size|s\/m\/l/i],
  ['tagPrice', /吊牌价|价格|售价|price|金额/i],
  ['material', /面料|材质|成分|material|fabric/i],
  ['imageUrl', /图片|主图|image|photo|url|链接/i],
  ['highlights', /卖点|亮点|描述|description|brief/i],
];

export function heuristicProductMapping(headers: string[]): ProductMapping {
  const mapping: ProductMapping = {};
  const used = new Set<ProductSchemaField>();
  for (const header of headers) {
    const hit = RULES.find(([field, pattern]) => !used.has(field) && pattern.test(header));
    mapping[header] = hit?.[0] ?? '';
    if (hit?.[0]) used.add(hit[0]);
  }
  return mapping;
}

export function mapRowToProduct(row: Record<string, string>, mapping: ProductMapping) {
  const product: Record<string, string> = {};
  for (const [source, target] of Object.entries(mapping)) {
    if (!target) continue;
    const value = row[source]?.trim();
    if (value) product[target] = value;
  }
  if (!product.name && product.sku) product.name = product.sku;
  return product;
}
