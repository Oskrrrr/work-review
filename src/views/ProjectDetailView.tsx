import { ArrowLeft, CalendarRange, Check, Clock3, FolderKanban, Images, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RecordCard } from '../components/RecordCard';
import type { LongTermProject, ProjectRecordLink, WorkDataset, WorkRecord } from '../types';

type ProjectRecord = { record: WorkRecord; dataset: WorkDataset; caseId: string; caseTitle: string; lifecycle: 'active' | 'completed'; direct?: boolean };

function datasetIdOf(dataset: WorkDataset) {
  return dataset.meta.datasetId || `${dataset.meta.year}-${dataset.meta.sourceName}`;
}

export function ProjectDetailView({ project, datasets, onBack, onOpenImage, onChangeLifecycle, onAddRecords, onRemoveRecord, hideContent = false }: { project: LongTermProject; datasets: WorkDataset[]; onBack: () => void; onOpenImage: (url: string, title: string) => void; onChangeLifecycle: (caseId: string, lifecycle: 'active' | 'completed') => void; onAddRecords: (projectId: string, links: ProjectRecordLink[]) => void; onRemoveRecord: (projectId: string, link: ProjectRecordLink) => void; hideContent?: boolean }) {
  const [yearFilter, setYearFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [addDatasetId, setAddDatasetId] = useState(() => datasets[0] ? datasetIdOf(datasets[0]) : '');
  const [addSearch, setAddSearch] = useState('');
  const [selectedLinks, setSelectedLinks] = useState<Array<{ datasetId: string; recordId: string }>>([]);
  const all = useMemo<ProjectRecord[]>(() => {
    const caseEntries = datasets.flatMap(dataset => dataset.cases.filter(item => item.longTermProjectId === project.id).flatMap(item => dataset.records.filter(record => item.recordIds.includes(record.id)).map(record => ({ record, dataset, caseId: item.id, caseTitle: item.title, lifecycle: item.lifecycle || 'active' }))));
    const caseKeys = new Set(caseEntries.map(item => `${datasetIdOf(item.dataset)}:${item.record.id}`));
    const directEntries = datasets.flatMap(dataset => (project.recordLinks || [])
      .filter(link => link.datasetId === datasetIdOf(dataset))
      .map(link => { const record = dataset.records.find(candidate => candidate.id === link.recordId || (link.sourceSignature && candidate.sourceSignature === link.sourceSignature) || (link.date === candidate.date && link.title === candidate.title)); return record ? { record, dataset } : undefined; })
      .filter((entry): entry is { record: WorkRecord; dataset: WorkDataset } => Boolean(entry))
      .filter(entry => !caseKeys.has(`${datasetIdOf(entry.dataset)}:${entry.record.id}`))
      .map(({ record, dataset: linkedDataset }) => ({ record, dataset: linkedDataset, caseId: '—', caseTitle: '跨年度单条记录', lifecycle: 'active' as const, direct: true })));
    return [...caseEntries, ...directEntries];
  }, [datasets, project.id, project.recordLinks]);
  const years = useMemo(() => [...new Set(all.map(item => item.record.date.slice(0, 4)))].sort(), [all]);
  // Keep the chronology consistent at both levels: older years first, and
  // older records first within each year.
  const visible = useMemo(() => all.filter(item => yearFilter === 'all' || item.record.date.startsWith(`${yearFilter}-`)).sort((a, b) => a.record.date.localeCompare(b.record.date) || a.record.sourceRow - b.record.sourceRow), [all, yearFilter]);
  const grouped = useMemo(() => years.filter(year => yearFilter === 'all' || year === yearFilter).map(year => ({ year, records: visible.filter(item => item.record.date.startsWith(`${year}-`)) })).filter(group => group.records.length), [years, yearFilter, visible]);
  const startDate = all.map(item => item.record.date).sort()[0];
  const endDate = all.map(item => item.record.date).sort().at(-1);
  const imageCount = all.reduce((sum, item) => sum + item.record.steps.filter(step => step.kind === 'image').length, 0);
  const completed = all.length > 0 && all.every(item => item.lifecycle === 'completed');
  const firstCase = all.find(item => !item.direct);
  const projectDatasets = useMemo(() => [...datasets].sort((a, b) => b.meta.year - a.meta.year || a.meta.sourceName.localeCompare(b.meta.sourceName, 'zh-CN')), [datasets]);
  const linkedKeys = useMemo(() => new Set(all.map(item => `${datasetIdOf(item.dataset)}:${item.record.id}`)), [all]);
  const addDataset = projectDatasets.find(item => datasetIdOf(item) === addDatasetId) || projectDatasets[0];
  const addRecords = useMemo(() => {
    if (!addDataset) return [];
    const keyword = addSearch.trim().toLowerCase();
    return addDataset.records.filter(record => !linkedKeys.has(`${datasetIdOf(addDataset)}:${record.id}`) && (!keyword || [record.date, record.title, record.originalCategory, ...record.steps.map(step => step.text || '')].join(' ').toLowerCase().includes(keyword))).slice(0, 120);
  }, [addDataset, addSearch, linkedKeys]);
  const isSelected = (recordId: string) => selectedLinks.some(link => link.datasetId === datasetIdOf(addDataset) && link.recordId === recordId);
  const toggleRecord = (recordId: string) => {
    if (!addDataset) return;
    const datasetId = datasetIdOf(addDataset);
    setSelectedLinks(current => current.some(link => link.datasetId === datasetId && link.recordId === recordId) ? current.filter(link => !(link.datasetId === datasetId && link.recordId === recordId)) : [...current, { datasetId, recordId }]);
  };
  const openAddDialog = () => { setAddDatasetId(projectDatasets[0] ? datasetIdOf(projectDatasets[0]) : ''); setAddSearch(''); setSelectedLinks([]); setAddOpen(true); };
  const submitAdd = () => {
    if (!selectedLinks.length) return;
    const links = selectedLinks.map(link => {
      const record = datasets.find(item => datasetIdOf(item) === link.datasetId)?.records.find(item => item.id === link.recordId);
      return { ...link, addedAt: new Date().toISOString(), ...(record ? { sourceSignature: record.sourceSignature, date: record.date, title: record.title } : {}) };
    });
    onAddRecords(project.id, links); setAddOpen(false); setSelectedLinks([]);
  };
  const categoryLabel = (record: WorkRecord, dataset: WorkDataset) => {
    const groups = dataset.meta.categoryGroups ?? {};
    const group = Object.entries(groups).find(([, members]) => members.includes(record.originalCategory))?.[0] || '未分组';
    return `${group} - ${record.effectiveCategory}`;
  };
  return <section className="workspace-view project-detail-view">
    <div className="project-detail-toolbar"><button className="text-button" onClick={onBack}><ArrowLeft size={16}/>返回长期工作前台</button><span>跨年度项目详情</span></div>
    <article className="panel project-detail-hero"><div className="project-detail-title"><span className="project-detail-icon"><FolderKanban size={24}/></span><div><span className="project-kicker">长期事项主档</span><h2>{project.title}</h2><p>{startDate || '—'} 至 {endDate || '—'} · 覆盖 {years.join('、') || '—'}</p></div></div><div className="project-detail-actions"><button className="secondary-action" onClick={openAddDialog}><Plus size={15}/>添加历史记录</button><span className={`project-status-badge${completed ? ' completed' : ''}`}>{completed ? <><Check size={14}/>已办结</> : <><Clock3 size={14}/>进行中</>}</span>{firstCase && !firstCase.direct && <button className={`front-case-status${completed ? ' completed' : ''}`} onClick={() => onChangeLifecycle(firstCase.caseId, completed ? 'active' : 'completed')}>{completed ? <><RotateCcw size={14}/>重新打开</> : <><Check size={14}/>办结整个项目</>}</button>}</div></article>
    <div className="project-detail-kpis"><article className="panel"><CalendarRange size={18}/><div><strong>{years.length}</strong><span>覆盖年度</span></div></article><article className="panel"><FolderKanban size={18}/><div><strong>{all.length}</strong><span>全部记录</span></div></article><article className="panel"><Images size={18}/><div><strong>{imageCount}</strong><span>图片记录</span></div></article></div>
    <div className="project-detail-filter"><strong>查看范围</strong><button className={yearFilter === 'all' ? 'active' : ''} onClick={() => setYearFilter('all')}>全部年度</button>{years.map(year => <button key={year} className={yearFilter === year ? 'active' : ''} onClick={() => setYearFilter(year)}>{year} 年</button>)}</div>
    {grouped.map(group => <section className="project-year-section" key={group.year}><div className="project-year-heading"><h3>{group.year} 年</h3><span>{group.records.length} 条记录</span></div><div className="project-record-list">{group.records.map(item => <div className="project-record-entry" key={`${item.dataset.meta.datasetId || item.dataset.meta.sourceName}-${item.record.id}`}><div className="project-record-context"><span>{item.direct ? '主档记录' : item.caseId}</span><small>{item.caseTitle} · {item.dataset.meta.displayName || item.dataset.meta.sourceName}</small>{item.direct && <button className="project-record-remove" onClick={() => onRemoveRecord(project.id, { datasetId: datasetIdOf(item.dataset), recordId: item.record.id, addedAt: '' })}>移出主档</button>}</div><RecordCard record={item.record} datasetId={item.dataset.meta.datasetId} categoryLabel={categoryLabel(item.record, item.dataset)} hideContent={hideContent} onOpenImage={onOpenImage}/></div>)}</div></section>)}
    {!grouped.length && <div className="panel large-empty"><FolderKanban size={32}/><h3>这个范围还没有记录</h3><p>可以切换“全部年度”查看项目的完整历史。</p></div>}
    {addOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && setAddOpen(false)}><div className="dialog project-record-dialog" role="dialog" aria-modal="true" aria-labelledby="add-project-record-title"><button className="dialog-close" onClick={() => setAddOpen(false)} aria-label="关闭"><X size={19}/></button><div className="dialog-icon"><Plus size={22}/></div><h2 id="add-project-record-title">添加历史记录</h2><p>选择任意年度的一条或多条工作记录，直接加入“{project.title}”。即使记录没有事项编号，也可以作为跨年度主档记录保存。</p><label className="project-record-year">数据年度<select value={addDatasetId} onChange={event => { setAddDatasetId(event.target.value); setSelectedLinks([]); }}>{projectDatasets.map(item => <option key={datasetIdOf(item)} value={datasetIdOf(item)}>{item.meta.year} · {item.meta.displayName || item.meta.sourceName}</option>)}</select></label><label className="project-record-search"><Search size={15}/><input autoFocus value={addSearch} onChange={event => setAddSearch(event.target.value)} placeholder="搜索日期、标题、分类或跟进内容"/></label><div className="project-record-picker-list">{addRecords.map(record => <label className={`project-record-picker-item${isSelected(record.id) ? ' selected' : ''}`} key={record.id}><input type="checkbox" checked={isSelected(record.id)} onChange={() => toggleRecord(record.id)}/><span><strong>{record.title}</strong><small>{record.date} · {record.originalCategory} · {record.steps.filter(step => step.kind === 'text').length} 条文字跟进</small></span></label>)}{!addRecords.length && <div className="empty-state">没有找到可添加的记录。可以切换数据年度或修改搜索词。</div>}</div><div className="project-record-dialog-footer"><span>已选择 {selectedLinks.length} 条</span><button className="dialog-secondary" onClick={() => setAddOpen(false)}>取消</button><button className="dialog-primary" disabled={!selectedLinks.length} onClick={submitAdd}>加入主档</button></div></div></div>}
  </section>;
}
