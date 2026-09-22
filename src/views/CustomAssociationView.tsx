import { Edit3, FolderKanban, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createManualCase, detachCase, nextCaseId } from '../lib/cases';
import type { CustomAssociationRule, WorkDataset } from '../types';

export function CustomAssociationView({ dataset, onChange }: { dataset: WorkDataset; onChange: (dataset: WorkDataset) => void }) {
  const [manualSearch, setManualSearch] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualMonth, setManualMonth] = useState('');
  const [manualKeyword, setManualKeyword] = useState('');
  const [showSelected, setShowSelected] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingRuleId, setEditingRuleId] = useState<string>();
  const [newExclusion, setNewExclusion] = useState('');
  const [showSavedGroups, setShowSavedGroups] = useState(false);
  const rules = dataset.meta.customAssociations ?? [];
  const exclusions = dataset.meta.associationExclusions ?? [];
  const dateOptions = useMemo(() => [...new Set(dataset.records.map(record => record.date))].sort(), [dataset.records]);
  const monthOptions = useMemo(() => [...new Set(dateOptions.map(date => date.slice(0, 7)))].sort(), [dateOptions]);
  const visibleDateOptions = useMemo(() => manualMonth ? dateOptions.filter(date => date.startsWith(manualMonth)) : [], [dateOptions, manualMonth]);
  const keywordParts = manualKeyword.toLowerCase().split(/[\s,，、]+/).map(value => value.trim()).filter(Boolean);
  const available = useMemo(() => dataset.records.filter(record => {
    if (record.caseId) return false;
    const searchable = [record.date, record.title, record.originalCategory, ...record.steps.map(step => step.text || '')].join(' ').toLowerCase();
    return searchable.includes(manualSearch.toLowerCase()) && keywordParts.every(keyword => searchable.includes(keyword)) && (!manualDate || record.date === manualDate) && (!manualMonth || record.date.startsWith(manualMonth)) && (!showSelected || selectedIds.includes(record.id));
  }), [dataset.records, manualSearch, manualKeyword, manualDate, manualMonth, showSelected, selectedIds]);
  const keywordMatches = available.filter(record => keywordParts.length > 0 && keywordParts.every(keyword => [record.date, record.title, record.originalCategory, ...record.steps.map(step => step.text || '')].join(' ').toLowerCase().includes(keyword)));
  const keywordIds = keywordMatches.map(record => record.id);
  const allKeywordSelected = keywordIds.length > 0 && keywordIds.every(id => selectedIds.includes(id));
  const selectedRecords = dataset.records.filter(record => selectedIds.includes(record.id));
  const selectByKeyword = () => setSelectedIds(current => allKeywordSelected ? current.filter(id => !keywordIds.includes(id)) : [...new Set([...current, ...keywordIds])]);
  const resetEditor = () => { setSelectedIds([]); setManualTitle(''); setManualKeyword(''); setManualSearch(''); setManualDate(''); setManualMonth(''); setShowSelected(false); setEditingRuleId(undefined); };
  const submit = () => {
    if (selectedIds.length < 2) return;
    const next = createManualCase(dataset, selectedIds, manualTitle);
    const caseId = next.cases.find(item => selectedIds.every(id => item.recordIds.includes(id)))?.id ?? nextCaseId(next.cases);
    const rule: CustomAssociationRule = { id: editingRuleId ?? crypto.randomUUID(), caseId, title: manualTitle.trim() || selectedRecords[0]?.title || '自定义事项', keywords: keywordParts, recordIds: selectedIds, createdAt: new Date().toISOString() };
    const nextRules = editingRuleId ? rules.map(item => item.id === editingRuleId ? rule : item) : [...rules, rule];
    onChange({ ...next, meta: { ...next.meta, customAssociations: nextRules } });
    resetEditor();
  };
  const editRule = (rule: CustomAssociationRule) => {
    const targetCase = dataset.cases.find(item => item.id === rule.caseId);
    if (targetCase) onChange(detachCase(dataset, targetCase.id));
    setEditingRuleId(rule.id); setManualTitle(rule.title); setManualKeyword(rule.keywords.join(' ')); setSelectedIds(rule.recordIds); setShowSelected(false); setManualSearch(''); setManualDate(''); setManualMonth('');
  };
  const cancelRule = (rule: CustomAssociationRule) => {
    if (!window.confirm(`确定取消“${rule.title}”的关联吗？原始工作记录会保留，关键词记录也会删除。`)) return;
    const targetCase = dataset.cases.find(item => item.id === rule.caseId);
    const base = targetCase ? detachCase(dataset, targetCase.id) : dataset;
    onChange({ ...base, meta: { ...base.meta, customAssociations: rules.filter(item => item.id !== rule.id) } });
    if (editingRuleId === rule.id) resetEditor();
  };
  const addExclusion = () => { const keyword = newExclusion.trim(); if (!keyword || exclusions.includes(keyword)) return; onChange({ ...dataset, meta: { ...dataset.meta, associationExclusions: [...exclusions, keyword] } }); setNewExclusion(''); };
  const removeExclusion = (keyword: string) => onChange({ ...dataset, meta: { ...dataset.meta, associationExclusions: exclusions.filter(item => item !== keyword) } });

  return <section className="workspace-view">
    <div className="view-heading"><div><h2>把同一件工作放在一起</h2><p>只需要选中同一件工作的记录，保存后它们就会显示在同一个事项里。</p></div><span>{dataset.records.filter(record => !record.caseId).length} 条还没归类</span></div>
    <article className="panel association-howto"><div className="panel-header"><div><h3>怎么用？只要三步</h3><p>不确定时，先用关键词找，再检查右边选中的记录，最后保存。</p></div></div><div className="association-steps"><span><b>1</b>输入工作内容里的关键词</span><span><b>2</b>点击“选中这些记录”</span><span><b>3</b>点击“保存这组工作”</span></div></article>
    <article className="panel association-exclusions"><div className="panel-header"><div><h3>有些内容永远不要自动关联？</h3><p>这里默认是空的，只有你自己添加的词才会生效。</p></div><span>{exclusions.length} 个已设置</span></div><div className="association-exclusion-form"><input value={newExclusion} onChange={event => setNewExclusion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addExclusion(); }} placeholder="输入不需要自动关联的词"/><button className="primary-small" onClick={addExclusion}>添加这个词</button></div>{exclusions.length > 0 && <div className="association-exclusion-list">{exclusions.map(keyword => <span key={keyword}>{keyword}<button onClick={() => removeExclusion(keyword)} aria-label={`删除 ${keyword}`}>×</button></span>)}</div>}</article>
    {rules.length > 0 && <article className={`panel association-rules${showSavedGroups ? ' expanded' : ''}`}><div className="panel-header"><div><h3>我已经保存的工作组</h3><p>这里是维护区，不影响新建工作。需要修改或取消时再打开。</p></div><button className="association-toggle" onClick={() => setShowSavedGroups(value => !value)}>{showSavedGroups ? '隐藏工作组' : `查看已保存的 ${rules.length} 组`}</button></div>{showSavedGroups && <div className="association-rule-list">{rules.map(rule => <div className="association-rule" key={rule.id}><div className="association-rule-main"><strong>{rule.title}</strong><small>{rule.keywords.length ? `查找词：${rule.keywords.join('、')}` : '没有填写查找词'} · {rule.recordIds.length} 条记录</small></div><div className="association-rule-actions"><button className="icon-button" onClick={() => editRule(rule)} title="修改这一组" aria-label={`修改 ${rule.title}`}><Edit3 size={15}/></button><button className="icon-button danger" onClick={() => cancelRule(rule)} title="取消这一组" aria-label={`取消 ${rule.title} 的关联`}><Trash2 size={15}/></button></div></div>)}</div>}</article>}
    <div className="custom-association-page"><article className="panel custom-association-tools"><div className="dialog-icon"><FolderKanban size={24}/></div><h3>{editingRuleId ? '修改这一组工作' : '新建一组工作'}</h3><p>从你的真实工作记录中选择，不需要提前填写固定名称。</p><label className="manual-title-field">给这一组起个名字（可不填）<input value={manualTitle} onChange={event => setManualTitle(event.target.value)} placeholder="例如：一组需要持续跟进的工作"/></label><div className="keyword-match-box"><label>先输入工作内容关键词<input value={manualKeyword} onChange={event => setManualKeyword(event.target.value)} placeholder="例如：入户 / 维修 / 材料"/></label><button className="dialog-secondary" disabled={!keywordMatches.length} onClick={selectByKeyword}>{allKeywordSelected ? `取消选择 ${keywordMatches.length} 条` : `选中这些记录（${keywordMatches.length} 条）`}</button><small>'多个词用空格、逗号或顿号隔开，所有词都出现才会选中；再点一次可以取消。'</small></div><div className="manual-selection-summary"><strong>目前选了 {selectedIds.length} 条</strong><button className={showSelected ? 'active' : ''} onClick={() => setShowSelected(value => !value)}>{showSelected ? '查看全部记录' : '只看已选记录'}</button><div>{selectedRecords.map(record => <span key={record.id}>{record.date} · {record.title}</span>)}</div></div><div className="association-form-actions"><button className="dialog-secondary" onClick={resetEditor}>重新开始</button><button className="dialog-primary association-submit" disabled={selectedIds.length < 2} onClick={submit}>{editingRuleId ? '保存修改' : '保存这组工作'}</button></div></article><article className="panel custom-association-records"><div className="manual-record-filters"><label className="manual-search-field">按内容找<input value={manualSearch} onChange={event => setManualSearch(event.target.value)} placeholder="输入工作内容或分类"/></label><label className="manual-month-field">先选月份<select value={manualMonth} onChange={event => { setManualMonth(event.target.value); setManualDate(''); }}><option value="">全部月份</option>{monthOptions.map(month => <option key={month} value={month}>{month.replace('-', '年') + '月'}</option>)}</select></label><label className="manual-date-field">再选日期<select value={manualDate} disabled={!manualMonth} onChange={event => setManualDate(event.target.value)}><option value="">{manualMonth ? '这个月的全部日期' : '请先选月份'}</option>{visibleDateOptions.map(date => <option key={date} value={date}>{date.slice(8)} 日</option>)}</select></label></div><div className="manual-filter-hint">{manualDate ? `正在看 ${manualDate} 的记录` : manualMonth ? `正在看 ${manualMonth} 的记录` : '先选月份，日期列表会自动缩小'}</div><div className="manual-record-list">{available.map(record => <label key={record.id} className={`manual-record-option${selectedIds.includes(record.id) ? ' checked' : ''}`}><input type="checkbox" checked={selectedIds.includes(record.id)} onChange={() => setSelectedIds(current => current.includes(record.id) ? current.filter(id => id !== record.id) : [...current, record.id])}/><span><strong>{record.title}</strong><small>{record.date} · {record.originalCategory} · {record.steps.filter(step => step.kind === 'text').length} 条跟进</small></span></label>)}{!available.length && <div className="empty-state">没有找到还没归类的记录。</div>}</div></article></div>
  </section>;
}



