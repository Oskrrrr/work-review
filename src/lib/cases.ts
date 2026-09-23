import type { CaseItem, CaseKind, CaseLifecycle, WorkDataset, WorkRecord } from '../types';

export interface CaseSuggestion {
  id: string;
  left: WorkRecord;
  right: WorkRecord;
  score: number;
  reason: string;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s，。、“”‘’（）()：:；;·,！？!?]/g, '').replace(/(联系|协调|处理|跟进|问题|情况|居民|物业|社区)/g, '');
}

/** A content fingerprint that survives WPS-generated record id changes. */
export function associationRecordKey(record: WorkRecord) {
  const stable = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  return [record.date, stable(record.title), stable(record.originalCategory)].join('|');
}

function workContent(record: WorkRecord) {
  return [record.title, ...record.steps.filter(step => step.kind === 'text' && step.text).map(step => step.text!)].join(' ');
}

// 不写入任何个人业务关键词。需要排除的词由“自定义关联”页面保存到 associationExclusions。
const nonWorkKeywords: string[] = [];
function isNonWorkRecord(record: WorkRecord, excludedKeywords: string[] = []) {
  const searchable = normalize([record.title, record.originalCategory, workContent(record)].join(' '));
  return [...nonWorkKeywords, ...excludedKeywords].some(keyword => searchable.includes(normalize(keyword)));
}

function dayDistance(left: string, right: string) {
  return Math.round(Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86400000);
}

function grams(text: string) {
  const clean = normalize(text);
  const result = new Set<string>();
  for (let index = 0; index < clean.length - 1; index += 1) result.add(clean.slice(index, index + 2));
  return result;
}

function jaccard(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter(item => right.has(item)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

export function buildCaseSuggestions(records: WorkRecord[], rejectedIds: string[] = [], excludedKeywords: string[] = [], knownCases: CaseItem[] = [], associationHistory: string[] = []) {
  const suggestions: CaseSuggestion[] = [];
  const knownRecordIds = new Set(knownCases.flatMap(item => item.recordIds));
  const recordsById = new Map(records.map(record => [record.id, record]));
  const knownKeys = new Set([
    ...associationHistory,
    ...knownCases.flatMap(item => item.recordIds.map(id => recordsById.get(id)).filter((record): record is WorkRecord => Boolean(record)).map(associationRecordKey))
  ]);
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    const left = sorted[leftIndex];
    if (left.caseId || knownRecordIds.has(left.id) || knownKeys.has(associationRecordKey(left)) || isNonWorkRecord(left, excludedKeywords)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < Math.min(sorted.length, leftIndex + 80); rightIndex += 1) {
      const right = sorted[rightIndex];
      if (right.caseId || knownRecordIds.has(right.id) || knownKeys.has(associationRecordKey(right)) || isNonWorkRecord(right, excludedKeywords) || left.date === right.date) continue;
      const titleScore = jaccard(grams(left.title), grams(right.title));
      const contentScore = jaccard(grams(workContent(left)), grams(workContent(right)));
      const categoryBonus = left.originalCategory === right.originalCategory ? 0.08 : 0;
      const score = Math.min(0.99, titleScore * 0.25 + contentScore * 0.75 + categoryBonus);
      if (score < 0.46) continue;
      const id = [left.id, right.id].sort().join('::');
      if (rejectedIds.includes(id)) continue;
      const distance = dayDistance(left.date, right.date);
      const dateHint = distance <= 7 ? `日期相近，相隔 ${distance} 天；` : '';
      const reason = dateHint + (contentScore >= titleScore + 0.08 ? '工作内容与跟进文本相似' : left.originalCategory === right.originalCategory ? '工作内容相似，且原始分类相同' : '工作内容中的地点、对象或处理过程相似');
      suggestions.push({ id, left, right, score, reason });
    }
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 80);
}

export function nextCaseId(cases: CaseItem[]) {
  const highest = cases.reduce((max, item) => Math.max(max, Number(item.id.match(/\d+/)?.[0] ?? 0)), 0);
  return `W-${String(highest + 1).padStart(6, '0')}`;
}

export function renumberCases(dataset: WorkDataset): WorkDataset {
  const dateByCase = new Map(dataset.cases.map(item => [item.id, dataset.records.filter(record => item.recordIds.includes(record.id)).map(record => record.date).sort()[0] || '9999-12-31']));
  const ordered = [...dataset.cases].sort((a, b) => (dateByCase.get(a.id) || '').localeCompare(dateByCase.get(b.id) || '') || a.id.localeCompare(b.id));
  const ids = new Map(ordered.map((item, index) => [item.id, `W-${String(index + 1).padStart(6, '0')}`]));
  const cases = ordered.map(item => ({ ...item, id: ids.get(item.id)! }));
  const records = dataset.records.map(record => record.caseId && ids.has(record.caseId) ? { ...record, caseId: ids.get(record.caseId) } : record);
  const customAssociations = dataset.meta.customAssociations?.map(rule => ids.has(rule.caseId) ? { ...rule, caseId: ids.get(rule.caseId)! } : rule);
  return { ...dataset, cases, records, meta: customAssociations ? { ...dataset.meta, customAssociations } : dataset.meta };
}

export function acceptSuggestion(dataset: WorkDataset, suggestion: CaseSuggestion): WorkDataset {
  const caseId = nextCaseId(dataset.cases);
  const caseItem: CaseItem = {
    id: caseId,
    title: suggestion.left.title.length <= suggestion.right.title.length ? suggestion.left.title : suggestion.right.title,
    recordIds: [suggestion.left.id, suggestion.right.id],
    status: 'confirmed',
    // New associations start as periodic work.  A user can explicitly
    // promote them to a long-term item from the case table when the work
    // really needs to appear on the long-term work front.
    kind: 'periodic',
    lifecycle: 'active',
    createdAt: new Date().toISOString()
  };
  const recordIds = new Set(caseItem.recordIds);
  const history = [...new Set([...(dataset.meta.associationHistory || []), ...[suggestion.left, suggestion.right].map(associationRecordKey)])];
  return renumberCases({ ...dataset, cases: [...dataset.cases, caseItem], records: dataset.records.map(record => recordIds.has(record.id) ? { ...record, caseId } : record), meta: { ...dataset.meta, associationHistory: history } });
}

export function createManualCase(dataset: WorkDataset, recordIds: string[], title?: string): WorkDataset {
  const selected = dataset.records.filter(record => recordIds.includes(record.id));
  if (selected.length < 2) return dataset;
  const caseId = nextCaseId(dataset.cases);
  const caseTitle = title?.trim() || [...selected].sort((a, b) => a.title.length - b.title.length)[0].title;
  const caseItem: CaseItem = { id: caseId, title: caseTitle, recordIds: selected.map(record => record.id), status: 'confirmed', kind: 'periodic', lifecycle: 'active', createdAt: new Date().toISOString() };
  const selectedIds = new Set(caseItem.recordIds);
  const history = [...new Set([...(dataset.meta.associationHistory || []), ...selected.map(associationRecordKey)])];
  return renumberCases({ ...dataset, cases: [...dataset.cases, caseItem], records: dataset.records.map(record => selectedIds.has(record.id) ? { ...record, caseId } : record), meta: { ...dataset.meta, associationHistory: history } });
}

export function updateCaseKind(dataset: WorkDataset, caseId: string, kind: CaseKind): WorkDataset {
  return { ...dataset, cases: dataset.cases.map(item => item.id === caseId ? { ...item, kind } : item) };
}

export function updateCaseLifecycle(dataset: WorkDataset, caseId: string, lifecycle: CaseLifecycle): WorkDataset {
  return {
    ...dataset,
    cases: dataset.cases.map(item => item.id === caseId
      ? { ...item, lifecycle, ...(lifecycle === 'completed' ? { completedAt: new Date().toISOString() } : { completedAt: undefined }) }
      : item)
  };
}

export function updateCaseCategory(dataset: WorkDataset, caseId: string, categoryOverride: string): WorkDataset {
  return {
    ...dataset,
    cases: dataset.cases.map(item => item.id === caseId ? { ...item, categoryOverride } : item),
    records: dataset.records.map(record => record.caseId === caseId ? { ...record, effectiveCategory: categoryOverride || record.originalCategory } : record)
  };
}

/**
 * Merge several confirmed case numbers into one item.
 *
 * The first selected case is kept as the destination so the user can choose
 * which title/metadata should remain. Records, custom-association rules and
 * cross-year links from the other cases are moved to that destination.
 */
export function mergeCases(dataset: WorkDataset, caseIds: string[]): WorkDataset {
  const ids = [...new Set(caseIds)].filter(Boolean);
  if (ids.length < 2) return dataset;
  const selected = ids.map(id => dataset.cases.find(item => item.id === id)).filter((item): item is CaseItem => Boolean(item));
  if (selected.length < 2) return dataset;
  const destination = selected[0];
  const selectedSet = new Set(selected.map(item => item.id));
  const recordIds = [...new Set(selected.flatMap(item => item.recordIds))];
  const categoryOverride = destination.categoryOverride || selected.find(item => item.categoryOverride)?.categoryOverride;
  const longTermProjectId = destination.longTermProjectId || selected.find(item => item.longTermProjectId)?.longTermProjectId;
  const completed = selected.every(item => item.lifecycle === 'completed');
  const merged: CaseItem = {
    ...destination,
    recordIds,
    title: destination.title || selected.find(item => item.title)?.title || '合并事项',
    ...(categoryOverride ? { categoryOverride } : { categoryOverride: undefined }),
    kind: selected.some(item => item.kind === 'long-term') ? 'long-term' : 'periodic',
    lifecycle: completed ? 'completed' : 'active',
    ...(completed ? { completedAt: selected.map(item => item.completedAt).filter(Boolean).sort().at(-1) || destination.completedAt } : { completedAt: undefined }),
    ...(longTermProjectId ? { longTermProjectId } : { longTermProjectId: undefined }),
    createdAt: selected.map(item => item.createdAt).filter(Boolean).sort()[0] || destination.createdAt
  };
  const records = dataset.records.map(record => {
    if (!selectedSet.has(record.caseId || '') && !recordIds.includes(record.id)) return record;
    return {
      ...record,
      caseId: destination.id,
      effectiveCategory: merged.categoryOverride || record.originalCategory
    };
  });
  const customAssociations = dataset.meta.customAssociations?.map(rule => selectedSet.has(rule.caseId) ? { ...rule, caseId: destination.id } : rule);
  const history = [...new Set([...(dataset.meta.associationHistory || []), ...selected.flatMap(item => item.recordIds.map(id => dataset.records.find(record => record.id === id)).filter((record): record is WorkRecord => Boolean(record)).map(associationRecordKey))])];
  const next = {
    ...dataset,
    cases: [merged, ...dataset.cases.filter(item => !selectedSet.has(item.id))],
    records,
    meta: { ...dataset.meta, ...(customAssociations ? { customAssociations } : {}), associationHistory: history }
  };
  return renumberCases(next);
}

export function detachCase(dataset: WorkDataset, caseId: string): WorkDataset {
  const target = dataset.cases.find(item => item.id === caseId);
  if (!target) return dataset;
  const recordIds = new Set(target.recordIds);
  return renumberCases({
    ...dataset,
    cases: dataset.cases.filter(item => item.id !== caseId),
    records: dataset.records.map(record => recordIds.has(record.id)
      ? { ...record, caseId: undefined, effectiveCategory: record.originalCategory }
      : record)
  });
}

export function detachRecordFromCase(dataset: WorkDataset, caseId: string, recordId: string): WorkDataset {
  const target = dataset.cases.find(item => item.id === caseId);
  if (!target || !target.recordIds.includes(recordId)) return dataset;
  const remainingIds = target.recordIds.filter(id => id !== recordId);
  const nextCases = remainingIds.length ? dataset.cases.map(item => item.id === caseId ? { ...item, recordIds: remainingIds } : item) : dataset.cases.filter(item => item.id !== caseId);
  const nextRecords = dataset.records.map(record => record.id === recordId ? { ...record, caseId: undefined, effectiveCategory: record.originalCategory } : record);
  return renumberCases({ ...dataset, cases: nextCases, records: nextRecords });
}
