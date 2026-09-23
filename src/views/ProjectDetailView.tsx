import { ArrowLeft, CalendarRange, Check, Clock3, FolderKanban, Images, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RecordCard } from '../components/RecordCard';
import type { LongTermProject, WorkDataset, WorkRecord } from '../types';

type ProjectRecord = { record: WorkRecord; dataset: WorkDataset; caseId: string; caseTitle: string; lifecycle: 'active' | 'completed' };

export function ProjectDetailView({ project, datasets, onBack, onOpenImage, onChangeLifecycle, hideContent = false }: { project: LongTermProject; datasets: WorkDataset[]; onBack: () => void; onOpenImage: (url: string, title: string) => void; onChangeLifecycle: (caseId: string, lifecycle: 'active' | 'completed') => void; hideContent?: boolean }) {
  const [yearFilter, setYearFilter] = useState('all');
  const all = useMemo<ProjectRecord[]>(() => datasets.flatMap(dataset => dataset.cases.filter(item => item.longTermProjectId === project.id).flatMap(item => dataset.records.filter(record => item.recordIds.includes(record.id)).map(record => ({ record, dataset, caseId: item.id, caseTitle: item.title, lifecycle: item.lifecycle || 'active' })))), [datasets, project.id]);
  const years = useMemo(() => [...new Set(all.map(item => item.record.date.slice(0, 4)))].sort(), [all]);
  const visible = useMemo(() => all.filter(item => yearFilter === 'all' || item.record.date.startsWith(`${yearFilter}-`)).sort((a, b) => b.record.date.localeCompare(a.record.date) || b.record.sourceRow - a.record.sourceRow), [all, yearFilter]);
  const grouped = useMemo(() => years.filter(year => yearFilter === 'all' || year === yearFilter).map(year => ({ year, records: visible.filter(item => item.record.date.startsWith(`${year}-`)) })).filter(group => group.records.length), [years, yearFilter, visible]);
  const startDate = all.map(item => item.record.date).sort()[0];
  const endDate = all.map(item => item.record.date).sort().at(-1);
  const imageCount = all.reduce((sum, item) => sum + item.record.steps.filter(step => step.kind === 'image').length, 0);
  const completed = all.length > 0 && all.every(item => item.lifecycle === 'completed');
  const firstCase = all[0];
  const categoryLabel = (record: WorkRecord, dataset: WorkDataset) => {
    const groups = dataset.meta.categoryGroups ?? {};
    const group = Object.entries(groups).find(([, members]) => members.includes(record.originalCategory))?.[0] || '未分组';
    return `${group} - ${record.effectiveCategory}`;
  };
  return <section className="workspace-view project-detail-view">
    <div className="project-detail-toolbar"><button className="text-button" onClick={onBack}><ArrowLeft size={16}/>返回长期工作前台</button><span>跨年度项目详情</span></div>
    <article className="panel project-detail-hero"><div className="project-detail-title"><span className="project-detail-icon"><FolderKanban size={24}/></span><div><span className="project-kicker">长期事项主档</span><h2>{project.title}</h2><p>{startDate || '—'} 至 {endDate || '—'} · 覆盖 {years.join('、') || '—'} 年</p></div></div><div className="project-detail-actions"><span className={`project-status-badge${completed ? ' completed' : ''}`}>{completed ? <><Check size={14}/>已办结</> : <><Clock3 size={14}/>进行中</>}</span>{firstCase && <button className={`front-case-status${completed ? ' completed' : ''}`} onClick={() => onChangeLifecycle(firstCase.caseId, completed ? 'active' : 'completed')}>{completed ? <><RotateCcw size={14}/>重新打开</> : <><Check size={14}/>办结整个项目</>}</button>}</div></article>
    <div className="project-detail-kpis"><article className="panel"><CalendarRange size={18}/><div><strong>{years.length}</strong><span>覆盖年度</span></div></article><article className="panel"><FolderKanban size={18}/><div><strong>{all.length}</strong><span>全部记录</span></div></article><article className="panel"><Images size={18}/><div><strong>{imageCount}</strong><span>图片记录</span></div></article></div>
    <div className="project-detail-filter"><strong>查看范围</strong><button className={yearFilter === 'all' ? 'active' : ''} onClick={() => setYearFilter('all')}>全部年度</button>{years.map(year => <button key={year} className={yearFilter === year ? 'active' : ''} onClick={() => setYearFilter(year)}>{year} 年</button>)}</div>
    {grouped.map(group => <section className="project-year-section" key={group.year}><div className="project-year-heading"><h3>{group.year} 年</h3><span>{group.records.length} 条记录</span></div><div className="project-record-list">{group.records.map(item => <div className="project-record-entry" key={`${item.dataset.meta.datasetId || item.dataset.meta.sourceName}-${item.record.id}`}><div className="project-record-context"><span>{item.caseId}</span><small>{item.caseTitle} · {item.dataset.meta.displayName || item.dataset.meta.sourceName}</small></div><RecordCard record={item.record} datasetId={item.dataset.meta.datasetId} categoryLabel={categoryLabel(item.record, item.dataset)} hideContent={hideContent} onOpenImage={onOpenImage}/></div>)}</div></section>)}
    {!grouped.length && <div className="panel large-empty"><FolderKanban size={32}/><h3>这个范围还没有记录</h3><p>可以切换“全部年度”查看项目的完整历史。</p></div>}
  </section>;
}
