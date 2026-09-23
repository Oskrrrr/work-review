// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { importWorkbook, inferYearFromFileName, parseCellImageMap, parseWorkDate, personalDatasetId } from './workbook';

describe('workbook importer', () => {
  it('infers a data year from a workbook name and keeps a stable personal file id', () => {
    expect(inferYearFromFileName('2025工作记录.xlsx', 2026)).toBe(2025);
    expect(inferYearFromFileName('工作记录-2024-备份.xlsx', 2026)).toBe(2024);
    expect(inferYearFromFileName('工作记录.xlsx', 2026)).toBe(2026);
    expect(personalDatasetId('file-123', '2025工作记录.xlsx')).toBe(personalDatasetId('file-123', '改名后的工作记录.xlsx'));
  });

  it('parses month-day values with an explicit source year', () => {
    expect(parseWorkDate('1.4', 2026)).toBe('2026-01-04');
    expect(parseWorkDate(1.6, 2026)).toBe('2026-01-06');
    expect(parseWorkDate('2027/12/31', 2026)).toBe('2027-12-31');
    expect(parseWorkDate('2.30', 2026)).toBeNull();
  });

  it('maps WPS cell image IDs to media paths', () => {
    const cells = '<etc:cellImages><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr name="ID_A" descr="现场照片"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage></etc:cellImages>';
    const rels = '<Relationships><Relationship Id="rId1" Target="media/image1.png"/></Relationships>';
    expect(parseCellImageMap(cells, rels).get('ID_A')).toEqual({ path: 'xl/media/image1.png', name: '现场照片' });
  });

  it('forward-fills merged dates and preserves step order', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['日期','星期','具体事项','分类','跟进1','跟进2'],
      ['1.4','日','第一件事','日常管理','步骤一','步骤二'],
      [null,null,'第二件事','物业管理','完成处理',null]
    ]);
    sheet['!merges'] = [XLSX.utils.decode_range('A2:A3'), XLSX.utils.decode_range('B2:B3')];
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([bytes], 'test.xlsx');
    const result = await importWorkbook(file, 2026);
    expect(result.dataset.records).toHaveLength(2);
    expect(result.dataset.records[1].date).toBe('2026-01-04');
    expect(result.dataset.records[0].steps.map(step => step.text)).toEqual(['步骤一','步骤二']);
  });

  it('detects equivalent headers even when column order changes and weekday is absent', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['分类', '工作日期', '事项名称', '处理记录'],
      ['设备维护', '2027-02-03', '更换门禁电池', '已完成更换']
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, '记录');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const result = await importWorkbook(new File([bytes], '2027工作记录.xlsx'), 2027, 'Sheet1');
    expect(result.dataset.records).toHaveLength(1);
    expect(result.dataset.records[0].date).toBe('2027-02-03');
    expect(result.dataset.records[0].title).toBe('更换门禁电池');
    expect(result.dataset.records[0].originalCategory).toBe('设备维护');
    expect(result.dataset.records[0].steps.map(step => step.text)).toEqual(['已完成更换']);
  });
});

const samplePath = process.env.SAMPLE_WORKBOOK;
(samplePath ? describe : describe.skip)('provided workbook regression', () => {
  it('imports the supplied 2026 workbook structure', async () => {
    const bytes = await readFile(samplePath!);
    const file = new File([bytes], '2026工作记录.xlsx');
    const result = await importWorkbook(file, 2026);
    expect(result.dataset.records).toHaveLength(873);
    expect(new Set(result.dataset.records.map(record => record.originalCategory).filter(category => category !== '未分类')).size).toBe(25);
    expect(result.dataset.records.filter(record => record.originalCategory === '未分类')).toHaveLength(1);
    expect(result.dataset.meta.imageCount).toBe(296);
    expect(result.dataset.records.some(record => record.steps.length >= 10)).toBe(true);
  }, 30000);
});
