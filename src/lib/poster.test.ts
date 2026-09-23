import { describe, expect, it } from 'vitest';
import { buildAnnualPosterSvg, posterFileName } from './poster';
import type { WorkDataset } from '../types';

const dataset: WorkDataset = {
  meta: { sourceName: '2025工作记录.xlsx', displayName: '我的年度记录', sheetName: 'Sheet1', year: 2025, importedAt: '2025-12-31T00:00:00.000Z', sourceMode: 'local', imageCount: 2, warnings: [], categoryGroups: { '日常工作': ['走访'] } },
  cases: [{ id: 'W-000001', title: '社区走访项目', recordIds: ['r1'], status: 'confirmed', createdAt: '2025-01-01T00:00:00.000Z' }],
  records: [{ id: 'r1', sourceRow: 2, date: '2025-01-03', weekday: '星期五', title: '走访准备', originalCategory: '走访', effectiveCategory: '走访', steps: [], caseId: 'W-000001', sourceSignature: 'r1' }],
};

describe('annual poster export', () => {
  it('uses the dataset year and a safe descriptive file name', () => {
    expect(posterFileName(dataset)).toBe('工作脉络-2025-我的年度记录-年度总结海报.png');
    expect(buildAnnualPosterSvg(dataset)).toContain('2025 年工作总结');
  });

  it('masks content names while retaining the summary structure', () => {
    const output = buildAnnualPosterSvg(dataset, { hideContent: true });
    expect(output).not.toContain('社区走访项目');
    expect(output).not.toContain('日常工作 · 走访');
    expect(output).toContain('隐私模式');
    expect(output).toContain('事项记录');
  });
});
