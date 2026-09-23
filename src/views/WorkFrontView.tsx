import { ArrowDownWideNarrow, ArrowRight, ArrowUpNarrowWide, CalendarRange, Check, Clock3, Eye, EyeOff, Filter, FolderKanban, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { LongTermProject, WorkDataset } from '../types';

function daysBetween(start: string, end: string) {
  return Math.max(1, Math.floor((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1);
}

type SortKey = 'code' | 'span' | 'count';

export function WorkFrontView({ dataset, datasets, projects, onOpenCase, onChangeLifecycle, onChange }: { dataset: WorkDataset; datasets: WorkDataset[]; projects: LongTermProject[]; onOpenCase: () => void; onChangeLifecycle: (caseId: string, lifecycle: 'active' | 'completed') => void; onChange: (dataset: WorkDataset) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [descending, setDescending] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [expandedId, setExpandedId] = useState('');
  const [expandedProjectId, setExpandedProjectId] = useState('');
  const groups = dataset.meta.categoryGroups ?? {};
  const groupFor = (category: string) => Object.entries(groups).find(([, members]) => members.includes(category))?.[0] || '未分组';
  const categories = useMemo(() => [...new Set(dataset.records.map(record => record.originalCategory))].sort(), [dataset.records]);
  const availableGroups = useMemo(() => Object.keys(groups).sort().filter(group => !categoryFilter || categories.some(category => category === categoryFilter && groupFor(category) === group)), [groups, categories, categoryFilter]);
  const availableCategories = useMemo(() => categories.filter(category => !groupFilter || groupFor(category) === groupFilter), [categories, groupFilter, groups]);
  const items = useMemo(() => dataset.cases.filter(item => (item.kind || 'long-term') === 'long-term').map(item => {
    const records = dataset.records.filter(record => item.recordIds.includes(record.id)).sort((a, b) => a.date.localeCompare(b.date));
    const first = records[0];
    const last = records.at(-1);
    const itemCategories = [...new Set(records.map(record => record.originalCategory))];
    const itemGroups = [...new Set(itemCategories.map(groupFor))];
    const categoryLabels = [...new Set(itemCategories.map(category => `${groupFor(category)} - ${category}`))];
    return { item, records, first, last, span: first && last ? daysBetween(first.date, last.date) : 0, itemCategories, itemGroups, categoryLabels };
  }).filter(value => value.first && (!categoryFilter || value.itemCategories.includes(categoryFilter)) && (!groupFilter || value.itemGroups.includes(groupFilter)) && (lifecycleFilter === 'all' || (value.item.lifecycle || 'active') === lifecycleFilter)).sort((a, b) => {
    const result = sortKey === 'span' ? a.span - b.span : sortKey === 'count' ? a.records.length - b.records.length : a.item.id.localeCompare(b.item.id, 'en');
    return descending ? -result : result;
  }), [dataset.cases, dataset.records, categoryFilter, groupFilter, lifecycleFilter, sortKey, descending, groups]);
  const projectSummaries = useMemo(() => {
    const source = datasets.length ? datasets : [dataset];
    return new Map(projects.map(project => {
      const linked = source.flatMap(item => item.cases
        .filter(caseItem => caseItem.longTermProjectId === project.id)
        .flatMap(caseItem => item.records.filter(record => caseItem.recordIds.includes(record.id))));
      const dates = linked.map(record => record.date).sort();
      const linkedCases = source.flatMap(item => item.cases.filter(caseItem => caseItem.longTermProjectId === project.id));
      return [project.id, { project, records: linked.sort((a, b) => a.date.localeCompare(b.date)), dates, years: [...new Set(dates.map(date => date.slice(0, 4)))].sort(), cases: linkedCases }] as const;
    }));
  }, [datasets, dataset, projects]);
  const projectEntries = useMemo(() => [...projectSummaries.values()].filter(item => item.records.length).sort((a, b) => (a.dates[0] || '').localeCompare(b.dates[0] || '') || a.project.title.localeCompare(b.project.title, 'zh-CN')), [projectSummaries]);
  const ongoing = items.filter(value => value.span >= 7).length;
  const completed = items.filter(value => value.item.lifecycle === 'completed').length;
  const activeDays = items.reduce((sum, value) => sum + value.span, 0);
  const activeFilters = Number(Boolean(categoryFilter)) + Number(Boolean(groupFilter)) + Number(lifecycleFilter !== 'all');
  const resetFilters = () => { setCategoryFilter(''); setGroupFilter(''); setLifecycleFilter('all'); };
  return <section className="workspace-view work-front-view">
    <div className="view-heading"><div><h2>长期工作前台</h2><p>这里只展示手动标记为“长期事项”的工作；阶段性工作仍保留在事项总表中，不会混入长期项目统计。</p></div><button className="text-button" onClick={onOpenCase}>进入事项管理 <ArrowRight size={15}/></button></div>
    <div className="front-toolbar"><label>排序方式<select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)}><option value="code">事项编号</option><option value="span">持续时间</option><option value="count">记录次数</option></select></label><button className="front-order-button" onClick={() => setDescending(value => !value)} title={descending ? '当前：降序，点击切换为升序' : '当前：升序，点击切换为降序'} aria-label={descending ? '切换为升序' : '切换为降序'}>{descending ? <ArrowDownWideNarrow size={17}/> : <ArrowUpNarrowWide size={17}/>}</button><button className={`front-filter-button${activeFilters ? ' active' : ''}`} onClick={() => setFilterOpen(value => !value)}><Filter size={15}/>筛选{activeFilters ? `（${activeFilters}）` : ''}</button>{activeFilters > 0 && <button className="front-reset-button" onClick={resetFilters}><RotateCcw size={14}/>清除</button>}</div>
    {filterOpen && <div className="panel front-filter-panel"><label>工作状态<select value={lifecycleFilter} onChange={event => setLifecycleFilter(event.target.value as 'all' | 'active' | 'completed')}><option value="all">全部状态</option><option value="active">进行中</option><option value="completed">已办结</option></select></label><label>按自定义大类<select value={groupFilter} onChange={event => { const next = event.target.value; setGroupFilter(next); if (categoryFilter && next && groupFor(categoryFilter) !== next) setCategoryFilter(''); }}><option value="">全部大类</option>{availableGroups.map(group => <option key={group}>{group}</option>)}</select></label><label>按原始小类<select value={categoryFilter} onChange={event => { const next = event.target.value; setCategoryFilter(next); if (groupFilter && next && groupFor(next) !== groupFilter) setGroupFilter(''); }}><option value="">全部小类</option>{availableCategories.map(category => <option key={category}>{category}</option>)}</select></label><span><Check size={14}/>筛选会匹配这组工作里的任意记录</span></div>}
    <div className="front-kpis"><article className="panel front-kpi"><FolderKanban size={19}/><div><strong>{items.length}</strong><span>当前年度长期事项</span></div></article><article className="panel front-kpi"><Clock3 size={19}/><div><strong>{ongoing}</strong><span>持续 7 天以上</span></div></article><article className="panel front-kpi"><Check size={19}/><div><strong>{completed}</strong><span>当前年度已办结</span></div></article><article className="panel front-kpi"><CalendarRange size={19}/><div><strong>{activeDays}</strong><span>当前年度持续天数</span></div></article></div>
    {projectEntries.length > 0 && <article className="panel front-project-index"><div className="panel-header"><div><h2>跨年度长期事项</h2><p>切换年度不会丢失关联项目；这里汇总所有已导入表格中的同一主档。</p></div><span>{projectEntries.length} 个主档</span></div><div className="front-project-list">{projectEntries.map(entry => { const expanded = expandedProjectId === entry.project.id; const completedProject = entry.cases.length > 0 && entry.cases.every(item => item.lifecycle === 'completed'); return <div className={`front-project-item${expanded ? ' expanded' : ''}`} key={entry.project.id}><button className="front-project-summary" onClick={() => setExpandedProjectId(current => current === entry.project.id ? '' : entry.project.id)}><span className="front-project-icon"><FolderKanban size={17}/></span><span className="front-project-main"><strong>{entry.project.title}</strong><small>始于 {entry.dates[0]?.slice(0, 4)} 年 · 覆盖 {entry.years.join('、')} · {entry.records.length} 条记录</small></span><span className={`front-project-state${completedProject ? ' completed' : ''}`}>{completedProject ? '已办结' : '进行中'}</span>{expanded ? <EyeOff size={16}/> : <Eye size={16}/>}</button>{expanded && <div className="front-project-details">{entry.records.map(record => <div key={record.id}><time>{record.date}</time><span>{record.title}</span></div>)}</div>}</div>; })}</div></article>}
    {items.length ? <div className="front-work-list">{items.map(({ item, records, first, last, span, categoryLabels }) => { const isCompleted = item.lifecycle === 'completed'; const projectSummary = item.longTermProjectId ? projectSummaries.get(item.longTermProjectId) : undefined; const expanded = expandedId === item.id; return <article className={`panel front-work-card${span >= 30 ? ' long' : ''}${isCompleted ? ' completed' : ''}${expanded ? ' expanded' : ''}`} key={item.id}><div className="front-work-card-head"><div><span className="front-work-code">{item.id}</span><h3>{item.title}</h3></div><div className="front-card-actions"><strong>{isCompleted ? '已办结' : span === 1 ? '当日事项' : `已持续 ${span} 天`}</strong><button className="front-expand-button" onClick={() => setExpandedId(current => current === item.id ? '' : item.id)}>{expanded ? <><EyeOff size={13}/>收起</> : <><Eye size={13}/>查看详情</>}</button><button className={`front-case-status${isCompleted ? ' completed' : ''}`} onClick={() => onChangeLifecycle(item.id, isCompleted ? 'active' : 'completed')} title={isCompleted ? '重新打开事项' : '标记为已办结'}>{isCompleted ? <><RotateCcw size={13}/>重新打开</> : <><Check size={13}/>办结</>}</button></div></div><div className="front-work-range"><time>{first!.date}</time><span className="front-range-line"><i style={{ width: `${Math.min(100, Math.max(10, span / Math.max(1, daysBetween(items[0].first!.date, last!.date)) * 100))}%` }}/></span><time>{last!.date}</time></div><div className="front-work-meta"><span>类别：{categoryLabels.join('、')}</span><span>{records.length} 次记录</span><span>最近：{records.at(-1)!.title}</span><span>{item.status === 'confirmed' ? '已确认关联' : '待确认'}</span></div>{projectSummary && <div className="front-cross-year"><span>跨年度事项：{projectSummary.project.title}</span><span>始于 {projectSummary.dates[0]?.slice(0, 4) || '—'} 年</span><span>覆盖 {projectSummary.years.join('、')} 年</span><span>累计 {projectSummary.records.length} 条记录</span></div>}<div className="front-mini-timeline">{records.slice(0, 5).map(record => <div key={record.id}><b>{record.date.slice(5)}</b><span>{record.title}</span></div>)}{records.length > 5 && <small>还有 {records.length - 5} 次跟进记录</small>}</div>{expanded && <div className="front-full-timeline">{records.map(record => <div key={record.id}><time>{record.date}</time><div><strong>{record.title}</strong><span>{record.steps.find(step => step.kind === 'text')?.text || '图片处理记录'}</span></div></div>)}</div>}</article>; })}</div> : <div className="panel front-empty"><FolderKanban size={34}/><h3>{activeFilters ? '没有符合筛选条件的工作' : '还没有可展示的长期工作'}</h3><p>{activeFilters ? '可以更换状态、小类或大类，查看其他工作。' : '先在“事项编号总表”中把工作标记为长期事项，再会出现在这里。'}</p><button className="dialog-primary" onClick={activeFilters ? resetFilters : onOpenCase}>{activeFilters ? '清除筛选' : '去查看事项管理'}</button></div>}
  </section>;
}

