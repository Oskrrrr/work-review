import { describe, expect, it } from 'vitest';
import { buildAiWorklogMarkdown } from './textExport';
import type { WorkDataset } from '../types';

const dataset: WorkDataset = {
  meta: { sourceName: '工作记录.xlsx', sheetName: 'Sheet1', year: 2026, importedAt: '2026-09-22T00:00:00.000Z', sourceMode: 'local', imageCount: 1, warnings: [], categoryGroups: { '基层治理': ['走访'] } },
  cases: [{ id: 'W-000001', title: '社区走访项目', recordIds: ['r1', 'r2'], status: 'confirmed', createdAt: '2026-09-22T00:00:00.000Z' }],
  records: [
    { id: 'r1', sourceRow: 2, date: '2026-01-03', weekday: '星期六', title: '走访准备', originalCategory: '走访', effectiveCategory: '走访', steps: [{ id: 's1', order: 1, kind: 'text', text: '准备材料' }], caseId: 'W-000001', sourceSignature: 'r1' },
    { id: 'r2', sourceRow: 3, date: '2026-01-10', weekday: '星期六', title: '完成走访', originalCategory: '走访', effectiveCategory: '走访', steps: [{ id: 's2', order: 1, kind: 'image', imageId: 'i1' }], caseId: 'W-000001', sourceSignature: 'r2' },
    { id: 'r3', sourceRow: 4, date: '2026-02-01', weekday: '星期日', title: '临时会议', originalCategory: '会议', effectiveCategory: '会议', steps: [], sourceSignature: 'r3' },
  ],
};

describe('buildAiWorklogMarkdown', () => {
  it('includes long-running projects and the complete timeline', () => {
    const output = buildAiWorklogMarkdown(dataset);
    expect(output).toContain('## 二、长期工作项目');
    expect(output).toContain('W-000001｜社区走访项目');
    expect(output).toContain('基层治理-走访');
    expect(output).toContain('持续 8 天');
    expect(output).toContain('## 四、未串联的单项工作');
    expect(output).toContain('临时会议');
    expect(output).toContain('## 五、完整工作时间线');
    expect(output).toContain('图片记录 1 张');
  });

  it('keeps periodic and standalone work when there are no long-term projects', () => {
    const periodicDataset: WorkDataset = {
      ...dataset,
      cases: [{ id: 'W-000002', title: '阶段性检查', recordIds: ['r1', 'r2'], status: 'confirmed', kind: 'periodic', createdAt: '' }],
    };
    const output = buildAiWorklogMarkdown(periodicDataset);

    expect(output).toContain('当前没有已确认的长期工作项目');
    expect(output).toContain('## 三、已确认事项与阶段性工作');
    expect(output).toContain('W-000002｜阶段性检查');
    expect(output).toContain('## 四、未串联的单项工作');
    expect(output).toContain('临时会议');
    expect(output).toContain('## 五、完整工作时间线');
    expect(output.match(/\*\*走访准备\*\*/g)).toHaveLength(2);
  });

  it('exports a complete section structure for an empty dataset', () => {
    const emptyDataset: WorkDataset = {
      meta: { sourceName: '空白.xlsx', sheetName: 'Sheet1', year: 2026, importedAt: '', sourceMode: 'local', imageCount: 0, warnings: [] },
      cases: [],
      records: [],
    };
    const output = buildAiWorklogMarkdown(emptyDataset);

    expect(output).toContain('## 一、数据概览');
    expect(output).toContain('## 二、长期工作项目');
    expect(output).toContain('## 三、已确认事项与阶段性工作');
    expect(output).toContain('## 四、未串联的单项工作');
    expect(output).toContain('## 五、完整工作时间线');
    expect(output).toContain('## 六、给 AI 的写作提示');
    expect(output).toContain('暂无工作记录');
  });

  it('separates long-term, periodic, and standalone records without dropping any timeline entry', () => {
    const mixedDataset: WorkDataset = {
      ...dataset,
      cases: [
        dataset.cases[0],
        { id: 'W-000002', title: '阶段性检查', recordIds: ['r3'], status: 'confirmed', kind: 'periodic', createdAt: '' },
      ],
    };
    const output = buildAiWorklogMarkdown(mixedDataset);

    expect(output).toContain('W-000001｜社区走访项目');
    expect(output).toContain('W-000002｜阶段性检查');
    expect(output).toContain('所有记录都已归入事项编号。');
    expect(output.match(/\*\*临时会议\*\*/g)).toHaveLength(2);
    expect(output.match(/\*\*走访准备\*\*/g)).toHaveLength(2);
  });
});
