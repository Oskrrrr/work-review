import type { WorkDataset } from '../types';

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character] || character));
}

function mask(value: string) {
  const visible = [...value].filter(character => character.trim()).length;
  return visible ? [...value].map(character => character.trim() ? '●' : character).join('') : '●●●●';
}

function safeStem(value: string) {
  return value.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 70) || '年度工作记录';
}

export function posterFileName(dataset: WorkDataset) {
  return `工作脉络-${dataset.meta.year}-${safeStem(dataset.meta.displayName || dataset.meta.sourceName)}-年度总结海报.png`;
}

function text(x: number, y: number, value: string, size: number, fill = '#173d2d', weight = 400, anchor = 'start') {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="${size}px" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function roundedRect(x: number, y: number, width: number, height: number, fill: string, stroke = 'none', radius = 18) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
}

function categoryLabel(dataset: WorkDataset, category: string) {
  const group = Object.entries(dataset.meta.categoryGroups ?? {}).find(([, members]) => members.includes(category))?.[0];
  return group ? `${group} · ${category}` : category;
}

function dateRange(records: WorkDataset['records']) {
  const dates = records.map(record => record.date).sort();
  return dates.length ? `${dates[0]} 至 ${dates.at(-1)}` : '暂无日期';
}

export function buildAnnualPosterSvg(dataset: WorkDataset, options: { hideContent?: boolean } = {}) {
  const hideContent = Boolean(options.hideContent);
  const records = [...dataset.records].sort((a, b) => a.date.localeCompare(b.date) || a.sourceRow - b.sourceRow);
  const activeDays = new Set(records.map(record => record.date)).size;
  const categories = Object.entries(records.reduce<Record<string, number>>((counts, record) => {
    const label = categoryLabel(dataset, record.effectiveCategory);
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCategory = categories[0]?.[1] ?? 1;
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = `${dataset.meta.year}-${String(index + 1).padStart(2, '0')}`;
    return [key, records.filter(record => record.date.startsWith(key)).length] as const;
  });
  const maxMonth = Math.max(1, ...months.map(([, count]) => count));
  const projects = dataset.cases.map(item => ({
    title: item.title,
    count: item.recordIds.filter(id => records.some(record => record.id === id)).length,
    dates: records.filter(record => item.recordIds.includes(record.id)).map(record => record.date).sort(),
  })).filter(item => item.count).sort((a, b) => b.count - a.count).slice(0, 4);
  const title = hideContent ? '年度工作总结' : `${dataset.meta.year} 年工作总结`;
  const source = hideContent ? '●●●●●●●●' : (dataset.meta.displayName || dataset.meta.sourceName);
  const palette = ['#176f50', '#2e8c63', '#55aa7b', '#82c49a', '#add9ba', '#ccebd7'];
  const svg: string[] = [];

  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">`);
  svg.push(`<defs><linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f6045"/><stop offset="1" stop-color="#2e8c63"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#173d2d" flood-opacity=".10"/></filter></defs>`);
  svg.push(`<rect width="1200" height="1600" fill="#f3f8f4"/>`);
  svg.push(roundedRect(52, 52, 1096, 330, 'url(#hero)', 'none', 32));
  svg.push(`<circle cx="1000" cy="80" r="240" fill="#ffffff" fill-opacity=".06"/><circle cx="1100" cy="330" r="180" fill="#ffffff" fill-opacity=".05"/>`);
  svg.push(text(100, 112, '工作脉络 · 年度复盘', 22, '#c9f0d8', 600));
  svg.push(text(100, 188, title, 58, '#ffffff', 700));
  svg.push(text(100, 236, hideContent ? '工作内容已保护，统计结构仍完整保留' : '把零散记录整理成可回看的工作脉络', 22, '#d9f5e3', 400));
  svg.push(text(100, 304, source, 18, '#bce7cd', 500));
  svg.push(text(1088, 118, '年度数据', 15, '#bce7cd', 500, 'end'));
  svg.push(text(1088, 178, String(dataset.meta.year), 42, '#ffffff', 700, 'end'));
  svg.push(text(1088, 216, dateRange(records), 15, '#bce7cd', 400, 'end'));

  const cards = [
    ['事项记录', records.length.toLocaleString(), '条'],
    ['已记录工作日', activeDays.toLocaleString(), '天'],
    ['事项分类', String(new Set(records.map(record => record.originalCategory)).size), '类'],
    ['长期项目', String(dataset.cases.length), '项'],
  ];
  cards.forEach(([label, value, unit], index) => {
    const x = 52 + index * 274;
    svg.push(roundedRect(x, 420, 252, 142, '#ffffff', '#d9e9de', 20));
    svg.push(text(x + 24, 460, label, 16, '#6c8577', 500));
    svg.push(text(x + 24, 515, value, 38, '#173d2d', 700));
    svg.push(text(x + 24 + Math.max(50, value.length * 22), 515, unit, 15, '#6c8577', 500));
  });

  svg.push(roundedRect(52, 600, 650, 420, '#ffffff', '#d9e9de', 22));
  svg.push(text(84, 650, '分类复盘', 24, '#173d2d', 700));
  svg.push(text(84, 680, '按有效分类统计全年记录', 14, '#789083', 400));
  categories.forEach(([label, count], index) => {
    const y = 734 + index * 45;
    const displayLabel = hideContent ? mask(label) : label;
    svg.push(text(84, y, displayLabel, 15, '#355545', 500));
    svg.push(text(650, y, String(count), 14, '#527264', 600, 'end'));
    svg.push(roundedRect(84, y + 10, 566, 10, '#e8f1eb', 'none', 5));
    svg.push(roundedRect(84, y + 10, Math.max(20, 566 * count / maxCategory), 10, palette[index], 'none', 5));
  });

  svg.push(roundedRect(730, 600, 418, 420, '#ffffff', '#d9e9de', 22));
  svg.push(text(762, 650, '全年节奏', 24, '#173d2d', 700));
  svg.push(text(762, 680, '按月份查看工作密度', 14, '#789083', 400));
  months.forEach(([month, count], index) => {
    const x = 778 + index * 27;
    const height = Math.max(6, 230 * count / maxMonth);
    svg.push(roundedRect(x, 930 - height, 16, height, count ? '#2e8c63' : '#e4eee7', 'none', 5));
    if (index % 2 === 0) svg.push(text(x + 8, 958, month.slice(5), 11, '#789083', 500, 'middle'));
  });
  svg.push(text(762, 990, `覆盖 ${activeDays} 个工作日 · 图片记录 ${dataset.meta.imageCount} 张`, 13, '#789083', 400));

  svg.push(roundedRect(52, 1058, 1096, 410, '#ffffff', '#d9e9de', 22));
  svg.push(text(84, 1110, '长期工作项目', 24, '#173d2d', 700));
  svg.push(text(84, 1140, hideContent ? '项目名称已保护，持续记录仍保留' : '跨日期串联同一件事，展示持续推进的工作', 14, '#789083', 400));
  if (projects.length) {
    projects.forEach((project, index) => {
      const y = 1195 + index * 62;
      const projectTitle = hideContent ? mask(project.title) : project.title;
      svg.push(text(84, y, projectTitle, 16, '#2c513d', 600));
      svg.push(text(1080, y, `${project.count} 次记录`, 13, '#527264', 500, 'end'));
      svg.push(roundedRect(84, y + 14, 996, 8, '#e8f1eb', 'none', 4));
      svg.push(roundedRect(84, y + 14, Math.max(28, 996 * project.count / Math.max(1, projects[0].count)), 8, '#55aa7b', 'none', 4));
      svg.push(text(84, y + 39, project.dates.length ? `${project.dates[0]} 至 ${project.dates.at(-1)}` : '暂无日期', 12, '#789083', 400));
    });
  } else {
    svg.push(text(84, 1230, hideContent ? '●●●●●●●●' : '暂未建立长期项目', 18, '#789083', 500));
    svg.push(text(84, 1270, '可以在事项编号总表中串联跨日期的工作记录。', 13, '#9aaa9f', 400));
  }
  svg.push(text(84, 1532, '由“工作脉络”生成 · 可用于年度复盘、汇报或交给 AI 继续整理', 13, '#789083', 400));
  svg.push(text(1116, 1532, hideContent ? '隐私模式' : '完整内容', 13, '#2e8c63', 600, 'end'));
  svg.push('</svg>');
  return svg.join('');
}
