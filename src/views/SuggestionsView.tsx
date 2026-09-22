import { CalendarDays, Check, ClipboardList, Image, Link2, X } from 'lucide-react';
import type { CaseSuggestion } from '../lib/cases';
import type { WorkRecord } from '../types';

const categoryColors = ['#3b82f6', '#8b5cf6', '#0f9f8f', '#d97706', '#e11d48', '#64748b', '#16a34a'];
function categoryColor(category: string) {
  return categoryColors[[...category].reduce((sum, character) => sum + character.charCodeAt(0), 0) % categoryColors.length];
}
function recordSummary(record: WorkRecord) {
  const textSteps = record.steps.flatMap(step => step.kind === 'text' && step.text?.trim() ? [step.text.trim().replace(/\s+/g, ' ')] : []);
  if (!textSteps.length) return record.steps.some(step => step.kind === 'image') ? '包含图片跟进，打开事项可查看原图' : '暂无文字跟进';
  const summary = textSteps.join('；');
  return summary.length > 240 ? `${summary.slice(0, 240)}…` : summary;
}
function imageCount(record: WorkRecord) { return record.steps.filter(step => step.kind === 'image').length; }

export function SuggestionsView({ suggestions, onAccept, onReject }: { suggestions: CaseSuggestion[]; onAccept: (suggestion: CaseSuggestion) => void; onReject: (suggestion: CaseSuggestion) => void }) {
  return <section className="workspace-view"><div className="view-heading"><div><h2>待确认关联</h2><p>系统只提出建议；确认后才会生成事项编号。每条候选都附有事项内容、分类和跟进摘要，方便复核。</p></div><span>{suggestions.length} 条建议</span></div><div className="suggestion-list">{suggestions.map(item => <article className="panel suggestion-card" key={item.id} style={{ borderLeftColor: categoryColor(item.left.originalCategory) }}><div className="confidence"><Link2 size={17}/><strong>{Math.round(item.score*100)}% 相似</strong><span>{item.reason}</span></div><div className="suggestion-records"><SuggestionRecord record={item.left}/><SuggestionRecord record={item.right}/></div><div className="suggestion-actions"><button className="reject" onClick={() => onReject(item)}><X size={16}/>不是同一事项</button><button className="accept" onClick={() => onAccept(item)}><Check size={16}/>确认并生成编号</button></div></article>)}{!suggestions.length && <div className="large-empty"><Check size={34}/><h3>没有待确认建议</h3><p>已处理完当前候选，或需要导入更多记录。</p></div>}</div></section>;
}

function SuggestionRecord({ record }: { record: WorkRecord }) {
  const photos = imageCount(record);
  return <div className="suggestion-record" style={{ borderTopColor: categoryColor(record.originalCategory) }}><div className="suggestion-record-head"><span className="suggestion-category" style={{ backgroundColor: categoryColor(record.originalCategory) }}>{record.originalCategory}</span><time className="suggestion-date"><CalendarDays size={14}/><strong>{record.date}</strong><small>{record.weekday || '工作日'}</small></time></div><h3>{record.title}</h3><p className="suggestion-content-label">工作内容</p><p className="suggestion-summary"><ClipboardList size={14}/><span>{recordSummary(record)}</span></p><div className="suggestion-meta"><span><ClipboardList size={13}/>{record.steps.filter(step => step.kind === 'text').length} 条文字跟进</span>{photos > 0 && <span><Image size={13}/>{photos} 张图片</span>}<small>原始第 {record.sourceRow} 行</small></div></div>;
}
