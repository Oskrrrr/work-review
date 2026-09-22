import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Heatmap, type HeatmapPeriod } from '../components/Heatmap';
import { RecordCard } from '../components/RecordCard';
import type { WorkDataset } from '../types';
import { restDayForDate } from '../lib/holidays';

function shiftDate(dateKey: string, period: HeatmapPeriod, amount: number) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (period === 'quarter') date.setMonth(date.getMonth() + amount * 3);
  if (period === 'month') date.setMonth(date.getMonth() + amount);
  if (period === 'week') date.setDate(date.getDate() + amount * 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function OverviewView({ dataset, selectedDate, onSelectDate, onOpenImage, onNavigate }: { dataset: WorkDataset; selectedDate: string; onSelectDate: (date: string) => void; onOpenImage: (url: string, title: string) => void; onNavigate: (view: string) => void }) {
  const recordsForDay = dataset.records.filter(record => record.date === selectedDate);
  const groups = dataset.meta.categoryGroups ?? {};
  const groupFor = (category: string) => Object.entries(groups).find(([, members]) => members.includes(category))?.[0] || '未分组';
  const categoryLabel = (record: typeof dataset.records[number]) => `${groupFor(record.originalCategory)} - ${record.originalCategory}`;
  const selectedRestDay = restDayForDate(selectedDate);
  const [heatmapPeriod, setHeatmapPeriod] = useState<HeatmapPeriod>('year');
  const [hideRestDays, setHideRestDays] = useState(false);
  const categoryStats = useMemo(() => {
    const counts = dataset.records.reduce<Record<string, number>>((map, record) => { map[record.effectiveCategory] = (map[record.effectiveCategory] ?? 0) + 1; return map; }, {});
    return Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 6);
  }, [dataset]);
  const activeDays = new Set(dataset.records.map(record => record.date)).size;
  const maxCategory = categoryStats[0]?.[1] ?? 1;
  return <>
    <section className="metrics" aria-label="年度统计">
      <article className="metric primary"><span>已记录工作日</span><strong>{activeDays}<small>天</small></strong><p>当前数据集覆盖 {dataset.records.length} 条记录</p></article>
      <article className="metric"><span>事项记录</span><strong>{dataset.records.length}</strong><p>点击热力图查看当天内容</p></article>
      <article className="metric"><span>事项分类</span><strong>{new Set(dataset.records.map(record => record.originalCategory)).size}</strong><p>保留原始与纠正口径</p></article>
      <article className="metric"><span>处理照片</span><strong>{dataset.meta.imageCount}</strong><p>登录后私密查看</p></article>
    </section>
    <section className="dashboard-grid">
      <div className="main-column"><article className="panel heatmap-panel"><div className="panel-header"><div><h2>工作热力图</h2><p>颜色越深，当天记录的事项越多</p></div><div className="period-controls"><div className="period-switcher" role="group" aria-label="热力图周期"><button className={heatmapPeriod==='year'?'active':''} onClick={() => setHeatmapPeriod('year')}>年</button><button className={heatmapPeriod==='quarter'?'active':''} onClick={() => setHeatmapPeriod('quarter')}>季度</button><button className={heatmapPeriod==='month'?'active':''} onClick={() => setHeatmapPeriod('month')}>月</button><button className={heatmapPeriod==='week'?'active':''} onClick={() => setHeatmapPeriod('week')}>周</button></div><button className={`heatmap-rest-toggle${hideRestDays ? ' active' : ''}`} onClick={() => setHideRestDays(value => !value)}>{hideRestDays ? '显示休息日' : '隐藏休息日'}</button>{heatmapPeriod !== 'year' && <div className="period-arrows"><button onClick={() => onSelectDate(shiftDate(selectedDate, heatmapPeriod, -1))} aria-label="查看上一段时间">‹</button><button onClick={() => onSelectDate(shiftDate(selectedDate, heatmapPeriod, 1))} aria-label="查看下一段时间">›</button></div>}</div></div><Heatmap records={dataset.records} year={dataset.meta.year} selectedDate={selectedDate} period={heatmapPeriod} onSelect={onSelectDate} hideRestDays={hideRestDays}/><div className="heatmap-footer"><span>已选择 {selectedDate}，{recordsForDay.length} 条记录</span><div className="legend">少 <i className="level-0"/><i className="level-1"/><i className="level-2"/><i className="level-3"/><i className="level-4"/> 多</div></div></article>
        <article className="panel timeline-panel"><div className="panel-header"><div><h2>{selectedDate} · 当日全部事项</h2><p>共 {recordsForDay.length} 项，按 WPS 原始行顺序展示；点击任一事项可展开完整跟进。</p></div><button className="text-button" onClick={() => onNavigate('timeline')}>查看完整时间线 <ChevronRight size={15}/></button></div><div className="day-record-toolbar"><span>当天 {recordsForDay.length} 项</span><span>热力图颜色只代表数量，内容以此处为准</span></div>{selectedRestDay && <div className={`holiday-notice ${selectedRestDay.type === 'weekend' ? 'weekend-notice' : ''}`}><span>休息日</span><strong>{selectedRestDay.name}</strong><small>{selectedRestDay.type === 'holiday' ? '法定节假日休息' : '双休日休息'}，若有记录则表示当天仍有工作安排</small></div>}<div className="record-list">{recordsForDay.length ? recordsForDay.sort((a,b) => a.sourceRow - b.sourceRow).map(record => <RecordCard key={record.id} record={record} categoryLabel={categoryLabel(record)} onOpenImage={onOpenImage}/>) : <div className="empty-state"><strong>{selectedRestDay ? `${selectedRestDay.name} · ${selectedRestDay.type === 'holiday' ? '法定节假日' : '双休日'}休息日` : '这一天没有记录'}</strong><p>{selectedRestDay ? '当天没有工作事项记录。' : '可以选择热力图中颜色较深的日期。'}</p></div>}</div></article></div>
      <aside className="side-column"><article className="panel category-panel"><div className="panel-header"><div><h2>分类复盘</h2><p>按有效分类统计</p></div><button className="text-button" onClick={() => onNavigate('categories')}>详情</button></div><div className="category-list">{categoryStats.map(([category,count]) => <div className="category-row" key={category}><div><span>{category}</span><em>{count}</em></div><div className="bar"><i style={{ width: `${Math.max(8, count / maxCategory * 100)}%` }}/></div></div>)}</div></article><article className="panel case-panel"><div className="panel-header"><div><h2>事项编号总表</h2><p>跨日期串联同一件事</p></div><button className="text-button" onClick={() => onNavigate('cases')}>管理</button></div><div className="case-preview">{dataset.cases.slice(0,3).map(item => <div key={item.id}><span>{item.id}</span><strong>{item.title}</strong><p>{item.recordIds.length} 条记录 · {item.status === 'confirmed' ? '已确认' : '待确认'}</p></div>)}{!dataset.cases.length && <div className="empty-mini">尚无已确认编号</div>}<button onClick={() => onNavigate('suggestions')}>查看自动关联建议 <ChevronRight size={15}/></button></div></article></aside>
    </section>
  </>;
}

