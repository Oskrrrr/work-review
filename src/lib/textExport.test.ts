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
    expect(output).toContain('## 三、未串联的单项工作');
    expect(output).toContain('临时会议');
    expect(output).toContain('## 四、完整工作时间线');
    expect(output).toContain('图片记录 1 张');
  });
});

