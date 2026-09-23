import { describe, expect, it } from 'vitest';
import { reconcilePersonalDataset } from './personalSync';
import type { WorkDataset, WorkRecord } from '../types';

function record(id: string, sourceRow: number, title: string, sourceSignature: string): WorkRecord {
  return { id, sourceRow, date: '2026-03-03', weekday: '二', title, originalCategory: '物业管理', effectiveCategory: '物业管理', steps: [], sourceSignature };
}

function dataset(records: WorkRecord[], cases: WorkDataset['cases']): WorkDataset {
  return { meta: { datasetId: 'personal-test', sourceName: '2026工作记录.xlsx', sheetName: 'Sheet1', year: 2026, importedAt: '2026-01-01', sourceMode: 'personal-wps', imageCount: 0, warnings: [] }, records, cases };
}

describe('personal WPS refresh reconciliation', () => {
  it('keeps confirmed case and project links when row content changes', () => {
    const previous = dataset([
      record('old-1', 2, '台山49连建设进展', 'sig-old-1'),
      record('old-2', 3, '台山49连建设现场', 'sig-old-2')
    ], [{ id: 'W-000001', title: '台山49连建设', recordIds: ['old-1', 'old-2'], status: 'confirmed', kind: 'long-term', lifecycle: 'completed', longTermProjectId: 'P-1', createdAt: '2026-01-01' }]);
    const imported = dataset([
      record('new-1', 2, '台山49连建设最新进展', 'sig-new-1'),
      record('new-2', 3, '台山49连建设现场照片', 'sig-new-2'),
      record('new-3', 4, '新增的其他事项', 'sig-new-3')
    ], []);
    const merged = reconcilePersonalDataset(previous, imported);
    expect(merged.cases[0]).toMatchObject({ id: 'W-000001', kind: 'long-term', lifecycle: 'completed', longTermProjectId: 'P-1' });
    expect(merged.cases[0].recordIds).toEqual(['new-1', 'new-2']);
    expect(merged.records.filter(item => item.caseId === 'W-000001').map(item => item.id)).toEqual(['new-1', 'new-2']);
    expect(merged.records.find(item => item.id === 'new-3')?.caseId).toBeUndefined();
  });

  it('uses stable signatures when rows move after an insertion', () => {
    const previous = dataset([record('old-1', 2, '原有事项', 'same-signature')], [{ id: 'W-000001', title: '原有事项', recordIds: ['old-1'], status: 'confirmed', createdAt: '2026-01-01' }]);
    const imported = dataset([record('new-inserted', 2, '新增事项', 'new-signature'), record('new-1', 3, '原有事项', 'same-signature')], []);
    const merged = reconcilePersonalDataset(previous, imported);
    expect(merged.cases[0].recordIds).toEqual(['new-1']);
    expect(merged.records.find(item => item.id === 'new-1')?.caseId).toBe('W-000001');
  });
});
