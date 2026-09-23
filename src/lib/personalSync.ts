import type { CaseItem, CustomAssociationRule, WorkDataset, WorkRecord } from '../types';

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function textContent(record: WorkRecord) {
  return record.steps.filter(step => step.kind === 'text').map(step => step.text || '').join('|');
}

function identityKey(record: WorkRecord) {
  return [record.date, normalize(record.title), normalize(record.originalCategory)].join('|');
}

function titleSimilarity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const leftGrams = new Set(Array.from({ length: Math.max(0, a.length - 1) }, (_, index) => a.slice(index, index + 2)));
  const rightGrams = new Set(Array.from({ length: Math.max(0, b.length - 1) }, (_, index) => b.slice(index, index + 2)));
  const intersection = [...leftGrams].filter(item => rightGrams.has(item)).length;
  const union = new Set([...leftGrams, ...rightGrams]).size;
  return union ? intersection / union : 0;
}

function matchScore(oldRecord: WorkRecord, newRecord: WorkRecord) {
  const titleScore = titleSimilarity(oldRecord.title, newRecord.title);
  const oldText = normalize(textContent(oldRecord));
  const newText = normalize(textContent(newRecord));
  let score = 0;
  if (oldRecord.sourceRow === newRecord.sourceRow) score += 45;
  if (oldRecord.date === newRecord.date) score += 30;
  if (titleScore === 1) score += 35;
  else score += Math.round(titleScore * 25);
  if (oldRecord.originalCategory === newRecord.originalCategory) score += 10;
  if (oldText && oldText === newText) score += 15;
  return { score, titleScore };
}

function chooseCandidate(oldRecord: WorkRecord, candidates: WorkRecord[], used: Set<string>) {
  const available = candidates.filter(candidate => !used.has(candidate.id));
  if (!available.length) return undefined;
  const ranked = available
    .map(candidate => ({ candidate, ...matchScore(oldRecord, candidate) }))
    .sort((left, right) => right.score - left.score || left.candidate.sourceRow - right.candidate.sourceRow);
  const best = ranked[0];
  if (!best) return undefined;
  const sameRow = oldRecord.sourceRow === best.candidate.sourceRow;
  const sameDate = oldRecord.date === best.candidate.date;
  const similarTitle = best.titleScore >= 0.48;
  // A row number is the strongest fallback when the user edits a row in WPS.
  // Without a row/date/title signal, never guess and risk attaching a case to
  // an unrelated record.
  if (best.score < 45 || (!sameRow && !sameDate && !similarTitle)) return undefined;
  return best.candidate;
}

/**
 * Reconcile one refreshed personal WPS workbook with its previous local copy.
 *
 * WPS updates can change the generated record id when a row's text changes.
 * This keeps manually confirmed case/project links attached to the matching
 * new records instead of sending those rows back to suggestions.
 */
export function reconcilePersonalDataset(previous: WorkDataset, imported: WorkDataset): WorkDataset {
  const oldRecords = previous.records;
  const newRecords = imported.records;
  const newById = new Map(newRecords.map(record => [record.id, record]));
  const newBySignature = new Map<string, WorkRecord[]>();
  const newByIdentity = new Map<string, WorkRecord[]>();
  newRecords.forEach(record => {
    if (record.sourceSignature) newBySignature.set(record.sourceSignature, [...(newBySignature.get(record.sourceSignature) || []), record]);
    newByIdentity.set(identityKey(record), [...(newByIdentity.get(identityKey(record)) || []), record]);
  });

  const oldToNew = new Map<string, string>();
  const used = new Set<string>();
  const attach = (oldRecord: WorkRecord, newRecord?: WorkRecord) => {
    if (!newRecord || used.has(newRecord.id)) return false;
    oldToNew.set(oldRecord.id, newRecord.id);
    used.add(newRecord.id);
    return true;
  };

  oldRecords.forEach(oldRecord => attach(oldRecord, newById.get(oldRecord.id)));
  oldRecords.filter(record => !oldToNew.has(record.id)).forEach(oldRecord => {
    attach(oldRecord, chooseCandidate(oldRecord, newBySignature.get(oldRecord.sourceSignature) || [], used));
  });
  oldRecords.filter(record => !oldToNew.has(record.id)).forEach(oldRecord => {
    attach(oldRecord, chooseCandidate(oldRecord, newByIdentity.get(identityKey(oldRecord)) || [], used));
  });
  oldRecords.filter(record => !oldToNew.has(record.id)).forEach(oldRecord => {
    attach(oldRecord, chooseCandidate(oldRecord, newRecords, used));
  });

  const mapRecordIds = (recordIds: string[]) => [...new Set(recordIds.map(id => oldToNew.get(id)).filter((id): id is string => Boolean(id)))];
  const cases: CaseItem[] = previous.cases
    .map(item => ({ ...item, recordIds: mapRecordIds(item.recordIds) }))
    .filter(item => item.recordIds.length > 0);
  const customAssociations: CustomAssociationRule[] = (previous.meta.customAssociations || [])
    .map(rule => ({ ...rule, recordIds: mapRecordIds(rule.recordIds) }))
    .filter(rule => rule.recordIds.length > 0);
  const caseByRecord = new Map(cases.flatMap(item => item.recordIds.map(recordId => [recordId, item] as const)));
  const records = imported.records.map(record => {
    const item = caseByRecord.get(record.id);
    return item
      ? { ...record, caseId: item.id, effectiveCategory: item.categoryOverride || record.originalCategory }
      : record;
  });
  const meta = {
    ...imported.meta,
    ...(previous.meta.displayName ? { displayName: previous.meta.displayName } : {}),
    ...(previous.meta.categoryGroups ? { categoryGroups: previous.meta.categoryGroups } : {}),
    ...(customAssociations.length ? { customAssociations } : {}),
    ...(previous.meta.associationExclusions ? { associationExclusions: previous.meta.associationExclusions } : {})
  };
  return { ...imported, records, cases, meta };
}
