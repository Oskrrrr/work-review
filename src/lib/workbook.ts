import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import type { WorkDataset, WorkRecord, WorkStep } from '../types';

export interface ImportedImage {
  id: string;
  name: string;
  blob: Blob;
}

export interface ImportResult {
  dataset: WorkDataset;
  images: ImportedImage[];
}

const displayImagePattern = /DISPIMG\(\s*["']([^"']+)["']/i;

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Prefer a four-digit year embedded in a workbook name, such as 2025工作记录.xlsx. */
export function inferYearFromFileName(name: string, fallback: number) {
  const matches = [...String(name || '').matchAll(/(?:^|[^\d])((?:19|20|21)\d{2})(?=[^\d]|$)/g)];
  const year = Number(matches.at(-1)?.[1] || 0);
  return year >= 1900 && year <= 2200 ? year : fallback;
}

/** Keep a personal WPS workbook tied to its cloud file rather than the current calendar year. */
export function personalDatasetId(fileId: string, fileName: string, driveId = '') {
  return `personal-${stableHash(`${driveId}|${fileId || fileName}`)}`;
}

export function parseWorkDate(value: unknown, year: number) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 31) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = String(value ?? '').trim().replace(/[年月]/g, '.').replace(/日/g, '').replace(/\/$/, '');
  const match = text.match(/^(?:(\d{4})[.\-/])?(\d{1,2})[.\-/](\d{1,2})$/);
  if (!match) return null;
  const fullYear = Number(match[1] ?? year);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(fullYear, month - 1, day);
  if (date.getFullYear() !== fullYear || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function textOf(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function relationshipMap(xml: string) {
  const map = new Map<string, string>();
  const pattern = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) map.set(match[1], match[2]);
  return map;
}

export function parseCellImageMap(cellImagesXml: string, relationshipsXml: string) {
  const relationships = relationshipMap(relationshipsXml);
  const result = new Map<string, { path: string; name: string }>();
  const blockPattern = /<etc:cellImage>([\s\S]*?)<\/etc:cellImage>/gi;
  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(cellImagesXml))) {
    const name = block[1].match(/<xdr:cNvPr\b[^>]*\bname="([^"]+)"/i)?.[1];
    const description = block[1].match(/<xdr:cNvPr\b[^>]*\bdescr="([^"]*)"/i)?.[1] ?? '';
    const relationshipId = block[1].match(/<a:blip\b[^>]*(?:r:embed|embed)="([^"]+)"/i)?.[1];
    if (!name || !relationshipId) continue;
    const target = relationships.get(relationshipId);
    if (target) result.set(name, { path: `xl/${target.replace(/^\.\.\//, '')}`, name: description || name });
  }
  return result;
}

function mimeFromPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function extractImages(arrayBuffer: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(arrayBuffer));
  const decoder = new TextDecoder('utf-8');
  const cellImages = files['xl/cellimages.xml'];
  const relationships = files['xl/_rels/cellimages.xml.rels'];
  if (!cellImages || !relationships) return { imageIndex: new Map<string, ImportedImage>(), warnings: ['工作簿中没有可读取的 WPS 单元格图片关系表。'] };
  const mapping = parseCellImageMap(decoder.decode(cellImages), decoder.decode(relationships));
  const imageIndex = new Map<string, ImportedImage>();
  const warnings: string[] = [];
  mapping.forEach(({ path, name }, id) => {
    const bytes = files[path];
    if (!bytes) {
      warnings.push(`图片 ${id} 缺少资源文件。`);
      return;
    }
    imageIndex.set(id, { id, name, blob: new Blob([bytes], { type: mimeFromPath(path) }) });
  });
  return { imageIndex, warnings };
}

async function readFileBuffer(file: File) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('无法读取文件。'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

export async function importWorkbook(file: File, year: number, sheetName = 'Sheet1'): Promise<ImportResult> {
  const arrayBuffer = await readFileBuffer(file);
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false, cellFormula: true, dense: false });
  const sheet = workbook.Sheets[sheetName] ?? workbook.Sheets[workbook.SheetNames.find(name => !name.startsWith('WpsReserved_')) ?? ''];
  if (!sheet) throw new Error('找不到可读取的工作表。');
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:P1');
  if (range.e.c < 2) throw new Error('工作表至少需要日期、事项和分类等基本列。');

  const normalizeHeader = (value: unknown) => textOf(value).toLowerCase().replace(/[\s_\-：:（）()]/g, '');
  const aliases = {
    date: ['日期', '工作日期', '发生日期', '完成日期', '时间', 'date'],
    weekday: ['星期', '星期几', '周几', 'weekday'],
    title: ['具体事项', '事项名称', '事项', '工作事项', '工作内容', '任务', '任务名称', '标题', '内容', 'title'],
    category: ['分类', '类别', '工作分类', '事项分类', '所属分类', '小类', 'category']
  } as const;
  let headerRow = -1;
  let columns = { date: 0, weekday: 1, title: 2, category: 3 };
  let bestScore = 0;
  for (let candidate = 0; candidate <= Math.min(8, range.e.r); candidate += 1) {
    const values = Array.from({ length: range.e.c + 1 }, (_, column) => normalizeHeader(sheet[XLSX.utils.encode_cell({ r: candidate, c: column })]?.v));
    const find = (names: readonly string[]) => values.findIndex(value => names.includes(value));
    const detected = { date: find(aliases.date), weekday: find(aliases.weekday), title: find(aliases.title), category: find(aliases.category) };
    const score = [detected.date, detected.title, detected.category].filter(value => value >= 0).length;
    if (score > bestScore && detected.title >= 0 && (detected.date >= 0 || detected.category >= 0)) {
      bestScore = score;
      headerRow = candidate;
      columns = { date: detected.date >= 0 ? detected.date : 0, weekday: detected.weekday, title: detected.title, category: detected.category >= 0 ? detected.category : 3 };
    }
  }
  const dataStartRow = headerRow >= 0 ? headerRow + 1 : 1;
  const { imageIndex, warnings } = extractImages(arrayBuffer);
  const records: WorkRecord[] = [];
  let currentDateValue: unknown = null;
  let currentWeekday = '';
  let invalidDateRows = 0;
  let imageReferences = 0;
  const ignoredColumns = new Set([columns.date, columns.weekday, columns.title, columns.category]);

  for (let row = dataStartRow; row <= range.e.r; row += 1) {
    const cell = (column: number) => sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    const dateCell = cell(columns.date);
    const weekdayCell = columns.weekday >= 0 ? cell(columns.weekday) : undefined;
    if (dateCell?.v != null && textOf(dateCell.v)) currentDateValue = dateCell.v;
    if (weekdayCell?.v != null && textOf(weekdayCell.v)) currentWeekday = textOf(weekdayCell.v);
    const title = textOf(cell(columns.title)?.v);
    if (!title) continue;
    const date = parseWorkDate(currentDateValue, year);
    if (!date) {
      invalidDateRows += 1;
      continue;
    }
    const originalCategory = textOf(cell(columns.category)?.v) || '未分类';
    const steps: WorkStep[] = [];
    for (let column = 0; column <= range.e.c; column += 1) {
      if (ignoredColumns.has(column)) continue;
      const sourceCell = cell(column);
      if (!sourceCell) continue;
      const formula = textOf(sourceCell.f || sourceCell.v);
      const imageId = formula.match(displayImagePattern)?.[1];
      if (imageId) {
        imageReferences += 1;
        const image = imageIndex.get(imageId);
        steps.push({ id: `${row + 1}-${column + 1}`, order: column, kind: 'image', imageId, imageName: image?.name || imageId });
      } else {
        const text = textOf(sourceCell.v);
        if (text) steps.push({ id: `${row + 1}-${column + 1}`, order: column, kind: 'text', text });
      }
    }
    const signatureInput = JSON.stringify([date, title, originalCategory, steps.map(step => step.kind === 'text' ? step.text : step.imageId)]);
    const sourceSignature = stableHash(signatureInput);
    records.push({ id: `record-${sourceSignature}-${row + 1}`, sourceRow: row + 1, date, weekday: currentWeekday, title, originalCategory, effectiveCategory: originalCategory, steps, sourceSignature });
  }

  if (!records.length) throw new Error('没有找到可导入的工作记录，请确认表头中包含日期、事项和分类列。');
  if (invalidDateRows) warnings.push(`${invalidDateRows} 行因日期无法识别而未导入。`);
  if (imageReferences && !imageIndex.size) warnings.push('发现图片公式，但未能解析图片资源。');
  if (headerRow >= 0) warnings.push(`已根据表头自动识别日期、事项、分类${columns.weekday >= 0 ? '、星期' : ''}和跟进列。`);
  else warnings.push('未检测到标准表头，已兼容读取 A列日期、B列星期、C列事项、D列分类。');
  // 同一年份再次导入同名工作簿时更新原数据集；不同年份或不同文件名则保留为独立数据集。
  const datasetId = `${year}-${stableHash(file.name)}`;

  return {
    dataset: {
      meta: { datasetId, sourceName: file.name, sheetName: sheetName in workbook.Sheets ? sheetName : workbook.SheetNames[0], year, importedAt: new Date().toISOString(), sourceMode: 'local', imageCount: imageReferences, warnings },
      records,
      cases: []
    },
    images: [...imageIndex.values()]
  };
}
