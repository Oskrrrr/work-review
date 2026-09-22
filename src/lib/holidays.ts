type HolidayRange = { start: string; end: string; name: string };

// 2026 年法定节假日休息日期，依据国务院办公厅发布的年度安排。
const holidayRanges: Record<number, HolidayRange[]> = {
  2026: [
    { start: '2026-01-01', end: '2026-01-03', name: '元旦' },
    { start: '2026-02-15', end: '2026-02-23', name: '春节' },
    { start: '2026-04-04', end: '2026-04-06', name: '清明节' },
    { start: '2026-05-01', end: '2026-05-05', name: '劳动节' },
    { start: '2026-06-19', end: '2026-06-21', name: '端午节' },
    { start: '2026-09-25', end: '2026-09-27', name: '中秋节' },
    { start: '2026-10-01', end: '2026-10-07', name: '国庆节' }
  ]
};

const weekendWorkdays: Record<number, string[]> = {
  2026: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']
};

export function holidayForDate(date: string) {
  return holidayRanges[Number(date.slice(0, 4))]?.find(item => date >= item.start && date <= item.end);
}

export function restDayForDate(date: string) {
  const holiday = holidayForDate(date);
  if (holiday) return { ...holiday, type: 'holiday' as const };
  const year = Number(date.slice(0, 4));
  const weekday = new Date(`${date}T00:00:00`).getDay();
  if ((weekday === 0 || weekday === 6) && !weekendWorkdays[year]?.includes(date)) {
    return { start: date, end: date, name: weekday === 6 ? '周六' : '周日', type: 'weekend' as const };
  }
  return undefined;
}
