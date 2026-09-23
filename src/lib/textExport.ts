import type { WorkDataset, WorkRecord } from '../types';

function escapeMarkdown(value: string) {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&');
}

function groupFor(groups: Record<string, string[]>, category: string) {
  return Object.entries(groups).find(([, members]) => members.includes(category))?.[0] || '未分组';
}

function categoryLabel(dataset: WorkDataset, record: WorkRecord) {
  return `${groupFor(dataset.meta.categoryGroups ?? {}, record.effectiveCategory)}-${record.effectiveCategory}`;
}

function recordBody(record: WorkRecord) {
  const text = record.steps.filter(step => step.kind === 'text' && step.text?.trim()).map(step => step.text!.trim());
  const images = record.steps.filter(step => step.kind === 'image').length;
  const parts = [...text];
  if (images) parts.push(`图片记录 ${images} 张`);
  return parts.length ? parts.join('；') : '暂无文字跟进内容';
}

function dateRange(records: WorkRecord[]) {
  const dates = records.map(record => record.date).sort();
  return dates.length ? `${dates[0]} 至 ${dates.at(-1)}` : '暂无日期';
}

function formatRecord(dataset: WorkDataset, record: WorkRecord) {
  const caseText = record.caseId ? ` · 事项编号：${record.caseId}` : '';
  return `- ${record.date}（${record.weekday || '工作日'}） · 类别：${categoryLabel(dataset, record)}${caseText} · **${escapeMarkdown(record.title)}**\n  - 工作内容：${recordBody(record)}`;
}

/**
 * Build an AI-friendly, fact-oriented Markdown export. It deliberately keeps
 * the original record timeline while adding the app's long-running work view.
 */
export function buildAiWorklogMarkdown(dataset: WorkDataset) {
  const records = [...dataset.records].sort((a, b) => a.date.localeCompare(b.date) || a.sourceRow - b.sourceRow);
  const confirmedCases = dataset.cases.filter(item => item.status === 'confirmed').map(item => ({
    item,
    records: records.filter(record => item.recordIds.includes(record.id)),
  })).filter(value => value.records.length).sort((a, b) => a.records[0].date.localeCompare(b.records[0].date));
  const longTermCases = confirmedCases.filter(value => (value.item.kind || 'long-term') === 'long-term');
  const periodicCases = confirmedCases.filter(value => value.item.kind === 'periodic');
  const caseRecordIds = new Set(confirmedCases.flatMap(value => value.records.map(record => record.id)));
  const standalone = records.filter(record => !caseRecordIds.has(record.id));
  const categoryCounts = records.reduce<Record<string, number>>((counts, record) => {
    const label = categoryLabel(dataset, record);
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});
  const categorySummary = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([label, count]) => `${label}（${count}条）`).join('、') || '暂无分类';
  const monthGroups = [...new Set(records.map(record => record.date.slice(0, 7)))];
  const lines: string[] = [
    `# ${dataset.meta.year} 年工作记录｜AI 年度报告素材`,
    '',
    '> 本文由“工作脉络”根据工作记录整理生成。请只依据本文事实撰写年度报告；对于没有明确记录的信息不要自行补充。',
    '',
    '## 一、数据概览',
    '',
    `- 数据来源：${dataset.meta.sourceName}`,
    `- 工作表：${dataset.meta.sheetName}`,
    `- 记录时间范围：${dateRange(records)}`,
    `- 工作记录：${records.length} 条，覆盖 ${new Set(records.map(record => record.date)).size} 个工作日`,
    `- 已确认事项：${confirmedCases.length} 项（长期 ${longTermCases.length} 项，阶段性 ${periodicCases.length} 项）`,
    `- 图片记录：${dataset.meta.imageCount} 张（图片本身未写入文字稿）`,
    `- 分类分布：${categorySummary}`,
    '',
    '## 二、长期工作项目',
    '',
  ];

  if (longTermCases.length) {
    longTermCases.forEach(({ item, records: caseRecords }) => {
      const labels = [...new Set(caseRecords.map(record => categoryLabel(dataset, record)))].join('、');
      const firstRecord = caseRecords[0];
      const lastRecord = caseRecords.at(-1)!;
      const span = Math.max(1, Math.floor((new Date(`${lastRecord.date}T00:00:00`).getTime() - new Date(`${firstRecord.date}T00:00:00`).getTime()) / 86400000) + 1);
      lines.push(`### ${item.id}｜${item.title}`);
      lines.push('');
      lines.push(`- 工作周期：${dateRange(caseRecords)}（持续 ${span} 天）`);
      lines.push(`- 记录次数：${caseRecords.length} 次`);
      lines.push(`- 类别：${labels || '未分类'}`);
      lines.push('- 跟进时间线：');
      caseRecords.forEach(record => lines.push(`  ${formatRecord(dataset, record)}`));
      lines.push('');
    });
  } else {
    lines.push('当前没有已确认的长期工作项目。可以在“事项编号总表”或“自定义关联”中串联同一工作的多条记录。', '');
  }

  lines.push('## 三、已确认事项与阶段性工作', '');
  if (periodicCases.length) {
    periodicCases.forEach(({ item, records: caseRecords }) => {
      const labels = [...new Set(caseRecords.map(record => categoryLabel(dataset, record)))].join('、');
      lines.push(`### ${item.id}｜${item.title}`);
      lines.push('');
      lines.push(`- 工作周期：${dateRange(caseRecords)}`);
      lines.push(`- 记录次数：${caseRecords.length} 次`);
      lines.push(`- 类别：${labels || '未分类'}`);
      lines.push('- 跟进时间线：');
      caseRecords.forEach(record => lines.push(`  ${formatRecord(dataset, record)}`));
      lines.push('');
    });
  } else {
    lines.push('当前没有已确认的阶段性事项。', '');
  }

  lines.push('## 四、未串联的单项工作', '');
  if (standalone.length) standalone.forEach(record => lines.push(formatRecord(dataset, record), ''));
  else lines.push('所有记录都已归入事项编号。', '');

  lines.push('## 五、完整工作时间线', '');
  if (records.length) {
    monthGroups.forEach(month => {
      lines.push(`### ${month}`, '');
      records.filter(record => record.date.startsWith(month)).forEach(record => lines.push(formatRecord(dataset, record)));
      lines.push('');
    });
  } else {
    lines.push('暂无工作记录。', '');
  }

  lines.push('## 六、给 AI 的写作提示', '', '请基于以上工作记录，撰写一份正式、客观的年度工作报告：', '- 先概括全年工作主线，再分别参考长期项目、阶段性事项和单项工作，突出持续周期、关键节点和结果。', '- 将“大类-小类”作为分类线索，但不要机械堆砌分类名称。', '- 对只有过程记录、没有明确结果的事项，使用“完成了相关跟进/推进了相关工作”等谨慎表述，不要虚构成绩。', '- 图片仅以“图片记录 X 张”作为线索，不要假设图片中的具体内容。', '- 最后总结工作特点、可复用经验和下一步建议；无法从记录确认的内容请标注“待补充”。');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
