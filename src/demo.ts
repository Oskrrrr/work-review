import type { WorkDataset, WorkRecord } from './types';

const categories = ['项目协作', '资料整理', '客户支持', '数据分析', '会议准备', '产品维护', '内容编辑', '日常跟进'];
const titles = [
  '整理项目资料并标记待确认内容', '跟进客户反馈并记录处理结果', '汇总本周数据并更新看板',
  '准备例会材料与演示文稿', '检查产品页面并记录优化建议', '整理会议纪要和后续任务',
  '校对发布内容并补充说明', '跟进协作事项的最新进展', '核对名单与报名信息', '归档本阶段工作文件'
];

function makeDate(dayIndex: number) {
  const date = new Date(2026, 0, 4 + dayIndex);
  return date.toISOString().slice(0, 10);
}

const records: WorkRecord[] = Array.from({ length: 148 }, (_, index) => {
  const day = Math.floor(index * 1.72);
  const category = categories[index % categories.length];
  const date = makeDate(day);
  return {
    id: `demo-${index + 1}`,
    sourceRow: index + 2,
    date,
    weekday: '日一二三四五六'[new Date(`${date}T00:00:00`).getDay()],
    title: titles[index % titles.length],
    originalCategory: category,
    effectiveCategory: category,
    steps: [
      { id: `demo-${index + 1}-1`, order: 1, kind: 'text', text: index % 3 === 0 ? '已完成资料核对，并记录后续处理安排。' : '完成当天处理，等待下一步反馈。' }
    ],
    caseId: undefined,
    sourceSignature: `demo-${index + 1}`
  };
});

export const demoDataset: WorkDataset = {
  meta: {
    sourceName: '示例工作记录.xlsx',
    sheetName: 'Sheet1',
    year: 2026,
    importedAt: new Date().toISOString(),
    sourceMode: 'demo',
    imageCount: 0,
    warnings: ['当前展示通用示例记录；导入你的工作簿后会替换为真实内容。']
  },
  records,
  cases: []
};
