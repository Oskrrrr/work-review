import { describe, expect, it } from 'vitest';
import { acceptSuggestion, buildCaseSuggestions, detachCase, updateCaseKind, updateCaseLifecycle } from './cases';
import type { WorkDataset, WorkRecord } from '../types';

function record(id:string,date:string,title:string):WorkRecord { return { id,sourceRow:1,date,weekday:'一',title,originalCategory:'物业管理',effectiveCategory:'物业管理',steps:[],sourceSignature:id }; }

describe('case suggestions', () => {
  it('suggests related records on different days and only numbers them after confirmation', () => {
    const records=[record('a','2026-01-04','楼道杂物清理'),record('b','2026-01-07','楼道杂物处理进展')];
    const suggestions=buildCaseSuggestions(records);
    expect(suggestions).toHaveLength(1);
    const dataset:WorkDataset={meta:{sourceName:'x',sheetName:'Sheet1',year:2026,importedAt:'',sourceMode:'local',imageCount:0,warnings:[]},records,cases:[]};
    const next=acceptSuggestion(dataset,suggestions[0]);
    expect(next.cases[0].id).toBe('W-000001');
    expect(next.cases[0].kind).toBe('periodic');
    expect(next.records.every(item=>item.caseId==='W-000001')).toBe(true);
  });

  it('honors user-provided exclusion keywords without built-in personal terms', () => {
    const records=[record('rest-a','2026-01-04','休息安排'),record('rest-b','2026-01-07','休息安排记录'),record('work','2026-01-08','楼道杂物处理进展')];
    expect(buildCaseSuggestions(records, [], ['休息'])).toHaveLength(0);
  });

  it('can cancel an accidental association without deleting source records', () => {
    const records=[record('a','2026-01-04','事项 A'),record('b','2026-01-07','事项 A 进展')];
    const dataset:WorkDataset={meta:{sourceName:'x',sheetName:'Sheet1',year:2026,importedAt:'',sourceMode:'local',imageCount:0,warnings:[]},records,cases:[{id:'W-000001',title:'事项 A',recordIds:['a','b'],status:'confirmed',createdAt:''}]};
    const next=detachCase({...dataset,records:records.map(item=>({...item,caseId:'W-000001',effectiveCategory:'修改分类'}))},'W-000001');
    expect(next.cases).toHaveLength(0);
    expect(next.records.every(item=>!item.caseId && item.effectiveCategory===item.originalCategory)).toBe(true);
  });

  it('keeps a case reversible while distinguishing periodic work from long-term work', () => {
    const records=[record('a','2026-01-04','阶段工作开始'),record('b','2026-01-07','阶段工作结束')];
    const dataset:WorkDataset={meta:{sourceName:'x',sheetName:'Sheet1',year:2026,importedAt:'',sourceMode:'local',imageCount:0,warnings:[]},records,cases:[{id:'W-000001',title:'阶段工作',recordIds:['a','b'],status:'confirmed',createdAt:''}]};
    const periodic=updateCaseKind(dataset,'W-000001','periodic');
    expect(periodic.cases[0].kind).toBe('periodic');
    const done=updateCaseLifecycle(periodic,'W-000001','completed');
    expect(done.cases[0].lifecycle).toBe('completed');
    expect(done.cases[0].completedAt).toBeTruthy();
    const reopened=updateCaseLifecycle(done,'W-000001','active');
    expect(reopened.cases[0].lifecycle).toBe('active');
    expect(reopened.cases[0].completedAt).toBeUndefined();
  });
});
