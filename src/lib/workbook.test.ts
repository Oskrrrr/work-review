// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { importWorkbook, parseCellImageMap, parseWorkDate } from './workbook';

describe('workbook importer', () => {
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
