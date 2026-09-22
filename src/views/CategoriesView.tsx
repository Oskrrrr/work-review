import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { WorkDataset } from '../types';

type CategoryMode = 'effective' | 'original' | 'group';

type MonthlyPoint = { month: string; monthNumber: string; count: number };

function MonthlyTrend({ monthly, selectedMonth, hoverMonth, setHoverMonth, chooseMonth }: { monthly: MonthlyPoint[]; selectedMonth: string; hoverMonth: string; setHoverMonth: (value: string) => void; chooseMonth: (value: string) => void }) {
  const width = 720;
  const height = 360;
  const margin = { top: 28, right: 24, bottom: 42, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(35, ...monthly.map(item => item.count));
  const tickStep = maxValue <= 140 ? 35 : Math.ceil(maxValue / 4 / 10) * 10;
  const axisMax = Math.ceil(maxValue / tickStep) * tickStep;
  const x = (index: number) => margin.left + (plotWidth * index) / Math.max(monthly.length - 1, 1);
  const y = (value: number) => margin.top + plotHeight - (value / axisMax) * plotHeight;
  const points = monthly.map((item, index) => ({ ...item, cx: x(index), cy: y(item.count) }));
  const path = points.reduce((result, point, index) => {
    if (index === 0) return 'M ' + point.cx + ' ' + point.cy;
    const previous = points[index - 1];
    const middle = (previous.cx + point.cx) / 2;
    return result + ' C ' + middle + ' ' + previous.cy + ', ' + middle + ' ' + point.cy + ', ' + point.cx + ' ' + point.cy;
  }, '');
  const zoneWidth = plotWidth / monthly.length;
  const zoneLeft = (index: number) => Math.min(width - margin.right - zoneWidth, Math.max(margin.left, x(index) - zoneWidth / 2));
  const active = selectedMonth || hoverMonth;
  const activeIndex = monthly.findIndex(item => item.monthNumber === active);
  return <svg className="monthly-trend-svg" viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="月度记录趋势">
    {Array.from({ length: Math.floor(axisMax / tickStep) + 1 }, (_, index) => { const value = index * tickStep; const yy = y(value); return <g key={value}><line x1={margin.left} x2={width - margin.right} y1={yy} y2={yy} className="trend-grid-line"/><text x={margin.left - 10} y={yy + 4} textAnchor="end" className="trend-axis-label">{value}</text></g>; })}
    <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="trend-axis-line"/><line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} className="trend-axis-line"/>
    {activeIndex >= 0 && <rect x={zoneLeft(activeIndex)} y={margin.top} width={zoneWidth} height={plotHeight} className={selectedMonth ? 'trend-hot-zone selected' : 'trend-hot-zone'} />}
    <path d={path} className="trend-line" fill="none" vectorEffect="non-scaling-stroke" />
    {points.map(point => { const isSelected = selectedMonth === point.monthNumber; const isHover = hoverMonth === point.monthNumber; return <g key={point.month}>
      <text x={point.cx} y={point.cy - 12} textAnchor="middle" className={isSelected || isHover ? 'trend-value active' : 'trend-value'}>{point.count}</text>
      <circle cx={point.cx} cy={point.cy} r={isSelected || isHover ? 5 : 3.5} className={isSelected ? 'trend-dot selected' : isHover ? 'trend-dot hover' : 'trend-dot'} />
    </g>; })}
    {monthly.map((item, index) => { const left = zoneLeft(index); return <g key={item.month}>
      <text x={x(index)} y={height - margin.bottom + 18} textAnchor="middle" className="trend-axis-label">{item.month}</text>
      <rect x={left} y={margin.top} width={zoneWidth} height={plotHeight + 28} fill="transparent" className="trend-hit-zone" onMouseEnter={() => setHoverMonth(item.monthNumber)} onMouseLeave={() => { if (!selectedMonth) setHoverMonth(''); }} onClick={() => chooseMonth(item.monthNumber)} aria-label={item.month + '，' + item.count + '条记录'} />
    </g>; })}
  </svg>;
}

export function CategoriesView({ dataset }: { dataset: WorkDataset }) {
  const [mode, setMode] = useState<CategoryMode>('original');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [hoverMonth, setHoverMonth] = useState('');
  const groups = dataset.meta.categoryGroups ?? {};
  const groupFor = (category: string) => Object.entries(groups).find(([, members]) => members.includes(category))?.[0] || '未分组';
  const categoryFor = (record: typeof dataset.records[number]) => mode === 'group' ? groupFor(record.originalCategory) : mode === 'effective' ? record.effectiveCategory : record.originalCategory;
  const stats = useMemo(() => { const map = new Map<string, number>(); dataset.records.forEach(record => { const key = categoryFor(record); map.set(key, (map.get(key) ?? 0) + 1); }); return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); }, [dataset, mode, groups]);
  const detailRecords = useMemo(() => selectedCategory ? dataset.records.filter(record => categoryFor(record) === selectedCategory).sort((a, b) => b.date.localeCompare(a.date)) : [], [dataset, selectedCategory, mode, groups]);
  const monthly = useMemo(() => Array.from({ length: 12 }, (_, index) => ({ month: `${index + 1}月`, monthNumber: String(index + 1).padStart(2, '0'), count: dataset.records.filter(record => Number(record.date.slice(5, 7)) === index + 1).length })), [dataset.records]);
  const selectedMonthRecords = useMemo(() => selectedMonth ? dataset.records.filter(record => record.date.slice(0, 7) === `${dataset.meta.year}-${selectedMonth}`).sort((a, b) => b.date.localeCompare(a.date)) : [], [dataset, selectedMonth]);
  const monthCategoryStats = useMemo(() => { const map = new Map<string, number>(); selectedMonthRecords.forEach(record => { const key = categoryFor(record); map.set(key, (map.get(key) ?? 0) + 1); }); return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); }, [selectedMonthRecords, mode, groups]);
  const chooseBar = (entry: unknown) => { const item = entry as { name?: string } | undefined; if (item?.name) setSelectedCategory(current => current === item.name ? '' : item.name!); };
  const chooseMonth = (month: string) => setSelectedMonth(current => current === month ? '' : month);
  const monthLabels = monthly.map(item => item.month);
  const activeMonthLabel = selectedMonth ? `${Number(selectedMonth)}月` : hoverMonth;
  const activeMonthIndex = monthLabels.indexOf(activeMonthLabel);
  const activeMonthNext = activeMonthIndex >= 0 ? monthLabels[Math.min(activeMonthIndex + 1, monthLabels.length - 1)] : '';
  const monthDot = (props: { cx?: number; cy?: number; payload?: { monthNumber: string } }) => { const cx = props.cx ?? 0; const cy = props.cy ?? 0; const active = props.payload?.monthNumber === selectedMonth; const hovering = props.payload?.monthNumber === hoverMonth; return <g onClick={() => props.payload?.monthNumber && chooseMonth(props.payload.monthNumber)} className="trend-point-hit"><circle cx={cx} cy={cy} r={16} fill="transparent"/><circle cx={cx} cy={cy} r={active || hovering ? 4 : 3} fill={active ? '#0b4f39' : '#fff'} stroke={active || hovering ? '#0b4f39' : '#176b4d'} strokeWidth={active || hovering ? 4 : 3}/></g>; };
  return <section className="workspace-view"><div className="view-heading"><div><h2>分类复盘</h2><p>查看工作投入集中在哪些分类；大类编辑请到左侧“分类大类编辑”。点击柱子或月份可查看具体记录，再次点击可取消选择。</p></div><div className="segmented"><button className={mode === 'effective' ? 'active' : ''} onClick={() => { setMode('effective'); setSelectedCategory(''); setSelectedMonth(''); }}>有效分类</button><button className={mode === 'original' ? 'active' : ''} onClick={() => { setMode('original'); setSelectedCategory(''); setSelectedMonth(''); }}>原始小类</button><button className={mode === 'group' ? 'active' : ''} onClick={() => { setMode('group'); setSelectedCategory(''); setSelectedMonth(''); }}>自定义大类</button></div></div>{mode === 'effective' && <div className="panel category-explanation"><strong>有效分类不会自动变化</strong><span>导入时它等于 Excel 的原始小类；只有你在“事项编号总表”里手动选择新的分类后，它才会改变。</span></div>}<div className="chart-grid"><article className="panel chart-panel"><h3>{mode === 'group' ? '大类事项数' : mode === 'original' ? '原始小类事项数' : '有效分类事项数'}</h3><ResponsiveContainer width="100%" height={360}><BarChart data={stats.slice(0, 12)} layout="vertical" margin={{ left: 18, right: 42 }}><CartesianGrid stroke="#edf1ed" horizontal={false}/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 12 }}/><Bar dataKey="value" radius={[0, 5, 5, 0]} label={{ position: 'right', fill: '#4f6259', fontSize: 11 }} onClick={chooseBar}>{stats.slice(0, 12).map(item => <Cell key={item.name} fill={selectedCategory === item.name ? '#0b4f39' : '#176b4d'} opacity={selectedCategory && selectedCategory !== item.name ? 0.46 : 1}/>)}</Bar></BarChart></ResponsiveContainer></article><article className="panel chart-panel"><h3>月度记录趋势</h3><MonthlyTrend monthly={monthly} selectedMonth={selectedMonth} hoverMonth={hoverMonth} setHoverMonth={setHoverMonth} chooseMonth={chooseMonth}/></article></div>{selectedCategory && <article className="panel category-detail-panel"><div className="panel-header"><div><h3>{selectedCategory} · {detailRecords.length} 条记录</h3><p>当前正在查看这根柱子对应的记录；再次点击高亮柱子可取消。</p></div><button className="text-button" onClick={() => setSelectedCategory('')}>收起详情</button></div><div className="category-detail-list">{detailRecords.slice(0, 80).map(record => <div className="category-detail-item" key={record.id}><time>{record.date}</time><div><strong>{record.title}</strong><small>{record.originalCategory}{record.effectiveCategory !== record.originalCategory ? ` · 有效分类：${record.effectiveCategory}` : ''} · {record.steps.filter(step => step.kind === 'text').length} 条文字跟进</small></div></div>)}{detailRecords.length > 80 && <p className="category-detail-more">还有 {detailRecords.length - 80} 条记录，请使用工作时间线查看完整列表。</p>}</div></article>}{selectedMonth && <article className="panel category-detail-panel month-detail-panel"><div className="panel-header"><div><h3>{dataset.meta.year}年{Number(selectedMonth)}月 · {selectedMonthRecords.length} 条记录</h3><p>当前正在查看这个月的工作概览；再次点击同一个月份可取消。</p></div><button className="text-button" onClick={() => setSelectedMonth('')}>收起详情</button></div><div className="month-category-summary">{monthCategoryStats.map(item => <span key={item.name}>{item.name} <b>{item.value}</b></span>)}</div><div className="category-detail-list">{selectedMonthRecords.slice(0, 80).map(record => <div className="category-detail-item" key={record.id}><time>{record.date}</time><div><strong>{record.title}</strong><small>{categoryFor(record)} · {record.steps.filter(step => step.kind === 'text').length} 条文字跟进</small></div></div>)}{selectedMonthRecords.length > 80 && <p className="category-detail-more">还有 {selectedMonthRecords.length - 80} 条记录，请使用工作时间线查看完整列表。</p>}</div></article>}<article className="panel category-table"><table><thead><tr><th>{mode === 'group' ? '大类' : '分类'}</th><th>记录数</th><th>占比</th></tr></thead><tbody>{stats.map(item => <tr key={item.name}><td>{item.name}</td><td>{item.value}</td><td>{(item.value / dataset.records.length * 100).toFixed(1)}%</td></tr>)}</tbody></table></article></section>;
}


