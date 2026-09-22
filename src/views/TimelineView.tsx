import { Search, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RecordCard } from '../components/RecordCard';
import type { WorkDataset } from '../types';

export function TimelineView({ dataset, onOpenImage }: { dataset: WorkDataset; onOpenImage: (url: string, title: string) => void }) {
  const [query, setQuery] = useState(''); const [category, setCategory] = useState('全部'); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [visible, setVisible] = useState(30);
  const groups = dataset.meta.categoryGroups ?? {};
  const groupFor = (category: string) => Object.entries(groups).find(([, members]) => members.includes(category))?.[0] || '未分组';
  const categoryLabel = (record: typeof dataset.records[number]) => `${groupFor(record.originalCategory)} - ${record.originalCategory}`;
  const categories = [...new Set(dataset.records.map(record => record.effectiveCategory))].sort((a,b) => a.localeCompare(b,'zh-CN'));
  const filtered = useMemo(() => dataset.records.filter(record => {
    if (category !== '全部' && record.effectiveCategory !== category) return false;
    if (from && record.date < from) return false; if (to && record.date > to) return false;
    if (query && ![record.title, record.caseId, ...record.steps.map(step => step.text)].join(' ').toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }).sort((a,b) => b.date.localeCompare(a.date) || b.sourceRow - a.sourceRow), [dataset, query, category, from, to]);
  return <section className="workspace-view"><div className="view-heading"><div><h2>工作时间线</h2><p>搜索事项、跟进内容或编号，并按日期和分类筛选。</p></div><span>{filtered.length} 条记录</span></div><div className="filter-bar"><label className="filter-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索事项、跟进或编号"/></label><label><span>分类</span><select value={category} onChange={event => setCategory(event.target.value)}><option>全部</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label><label><span>开始</span><input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label><span>结束</span><input type="date" value={to} onChange={event => setTo(event.target.value)}/></label><button className="filter-reset" onClick={() => {setQuery('');setCategory('全部');setFrom('');setTo('');}}><SlidersHorizontal size={16}/>清除筛选</button></div><div className="record-list">{filtered.slice(0,visible).map(record => <RecordCard key={record.id} record={record} categoryLabel={categoryLabel(record)} onOpenImage={onOpenImage}/>)}</div>{visible < filtered.length && <button className="load-more" onClick={() => setVisible(value => value + 30)}>再显示 30 条</button>}</section>;
}


