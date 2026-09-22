import { useMemo } from 'react';
import type { WorkRecord } from '../types';
import { restDayForDate } from '../lib/holidays';

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export type HeatmapPeriod = 'year' | 'quarter' | 'month' | 'week';

function monday(date: Date) { const value = new Date(date); value.setDate(value.getDate() - ((value.getDay() + 6) % 7)); return value; }
function periodRange(year: number, anchor: string | undefined, period: HeatmapPeriod) {
  const selected = anchor ? new Date(`${anchor}T00:00:00`) : new Date(year, 0, 1);
  let first = new Date(year, 0, 1); let last = new Date(year, 11, 31);
  if (period === 'quarter') { const quarter = Math.floor(selected.getMonth() / 3); first = new Date(selected.getFullYear(), quarter * 3, 1); last = new Date(selected.getFullYear(), quarter * 3 + 3, 0); }
  if (period === 'month') { first = new Date(selected.getFullYear(), selected.getMonth(), 1); last = new Date(selected.getFullYear(), selected.getMonth() + 1, 0); }
  if (period === 'week') { first = monday(selected); last = new Date(first); last.setDate(first.getDate() + 6); }
  const gridStart = monday(first); const gridEnd = new Date(last); gridEnd.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  return { first, last, gridStart, gridEnd };
}

export function Heatmap({ records, year, selectedDate, period = 'year', onSelect, hideRestDays = false }: { records: WorkRecord[]; year: number; selectedDate?: string; period?: HeatmapPeriod; onSelect: (date: string) => void; hideRestDays?: boolean }) {
  const counts = useMemo(() => records.reduce<Record<string, number>>((map, record) => {
    map[record.date] = (map[record.date] ?? 0) + 1;
    return map;
  }, {}), [records]);
  const { first, last, gridStart, gridEnd } = periodRange(year, selectedDate, period);
  const periodTitle = period === 'year' ? `${year} 年` : period === 'quarter' ? `${first.getFullYear()} 年第 ${Math.floor(first.getMonth() / 3) + 1} 季度` : period === 'month' ? `${first.getFullYear()} 年${first.getMonth() + 1} 月` : `${localDateKey(first)} 至 ${localDateKey(last)}`;
  const days: Date[] = [];
  for (const cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) days.push(new Date(cursor));
  return <div className={`heatmap-scroll heatmap-${period}`}>
    <div className="heatmap-period-label">{periodTitle}</div>
    <div className="heatmap-layout">
      <div className="weekday-labels"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>
      <div className="heatmap-grid" role="grid" aria-label={`${periodTitle} 每日工作记录`}>
        {days.map(date => {
          const key = localDateKey(date);
          const count = counts[key] ?? 0;
          const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4;
          const isRestDay = Boolean(restDayForDate(key));
          return <button key={key} className={`heat-cell level-${level}${selectedDate === key ? ' selected' : ''}${date.getFullYear() !== year ? ' outside' : ''}${hideRestDays && isRestDay ? ' rest-hidden' : ''}`} onClick={() => onSelect(key)} aria-label={`${key}，${count} 条记录`} title={`${key} · ${count} 条记录`} />;
        })}
      </div>
    </div>
  </div>;
}
