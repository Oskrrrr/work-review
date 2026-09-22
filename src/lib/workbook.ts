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
  if (range.e.c < 3) throw new Error('工作表至少需要“日期、星期、具体事项、分类”四列。');

  const { imageIndex, warnings } = extractImages(arrayBuffer);
  const records: WorkRecord[] = [];
  let currentDateValue: unknown = null;
  let currentWeekday = '';
  let invalidDateRows = 0;
  let imageReferences = 0;

  for (let row = 1; row <= range.e.r; row += 1) {
    const cell = (column: number) => sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    const dateCell = cell(0);
    const weekdayCell = cell(1);
    if (dateCell?.v != null && textOf(dateCell.v)) currentDateValue = dateCell.v;
    if (weekdayCell?.v != null && textOf(weekdayCell.v)) currentWeekday = textOf(weekdayCell.v);
    const title = textOf(cell(2)?.v);
    if (!title) continue;
    const date = parseWorkDate(currentDateValue, year);
    if (!date) {
      invalidDateRows += 1;
      continue;
    }
    const originalCategory = textOf(cell(3)?.v) || '未分类';
    const steps: WorkStep[] = [];
    for (let column = 4; column <= Math.min(15, range.e.c); column += 1) {
      const sourceCell = cell(column);
      if (!sourceCell) continue;
      const formula = textOf(sourceCell.f || sourceCell.v);
      const imageId = formula.match(displayImagePattern)?.[1];
      if (imageId) {
        imageReferences += 1;
        const image = imageIndex.get(imageId);
        steps.push({ id: `${row + 1}-${column + 1}`, order: column - 3, kind: 'image', imageId, imageName: image?.name || imageId });
      } else {
        const text = textOf(sourceCell.v);
        if (text) steps.push({ id: `${row + 1}-${column + 1}`, order: column - 3, kind: 'text', text });
      }
    }
    const signatureInput = JSON.stringify([date, title, originalCategory, steps.map(step => step.kind === 'text' ? step.text : step.imageId)]);
    const sourceSignature = stableHash(signatureInput);
    records.push({
      id: `record-${sourceSignature}-${row + 1}`,
      sourceRow: row + 1,
      date,
      weekday: currentWeekday,
      title,
      originalCategory,
      effectiveCategory: originalCategory,
      steps,
      sourceSignature
    });
  }

  if (!records.length) throw new Error('没有找到可导入的工作记录，请确认具体事项位于 C 列。');
  if (invalidDateRows) warnings.push(`${invalidDateRows} 行因日期无法识别而未导入。`);
  if (imageReferences && !imageIndex.size) warnings.push('发现图片公式，但未能解析图片资源。');

  return {
    dataset: {
      meta: {
        sourceName: file.name,
        sheetName: sheetName in workbook.Sheets ? sheetName : workbook.SheetNames[0],
        year,
        importedAt: new Date().toISOString(),
        sourceMode: 'local',
        imageCount: imageReferences,
        warnings
      },
      records,
      cases: []
    },
    images: [...imageIndex.values()]
  };
}
