import { Check, Eye, EyeOff, FolderKanban, RotateCcw, Trash2, Unlink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { detachCase, detachRecordFromCase, updateCaseCategory, updateCaseKind, updateCaseLifecycle } from '../lib/cases';
import type { WorkDataset } from '../types';

export function CasesView({ dataset, onChange }: { dataset: WorkDataset; onChange: (dataset: WorkDataset) => void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = dataset.cases.find(item => item.id === selectedId);
  const selectedRecords = useMemo(() => dataset.records.filter(record => selected?.recordIds.includes(record.id)).sort((a, b) => a.date.localeCompare(b.date)), [dataset, selected]);
  const categories = [...new Set(dataset.records.map(record => record.originalCategory))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const detach = (caseId: string) => { if (!window.confirm(`确定取消 ${caseId} 的关联吗？原始工作记录会保留，但会解除事项编号和分类修正。`)) return; onChange(detachCase(dataset, caseId)); if (selectedId === caseId) setSelectedId(undefined); };
  const detachRecord = (recordId: string) => { if (!selected) return; const record = dataset.records.find(item => item.id === recordId); if (!record || !window.confirm(`确定将“${record.title}”从 ${selected.id} 中移除吗？原始工作记录不会删除。`)) return; const next = detachRecordFromCase(dataset, selected.id, recordId); const remainingIds = selected.recordIds.filter(id => id !== recordId); setSelectedId(next.cases.find(item => remainingIds.some(id => item.recordIds.includes(id)))?.id); onChange(next); };
  return <section className="workspace-view">
    <div className="view-heading"><div><h2>事项编号总表</h2><p>确认跨日期记录的归属，并手动区分长期事项或阶段性工作。已办结事项仍会保留，可随时重新打开。</p></div><span>{dataset.cases.length} 个事项</span></div>
    {dataset.cases.length ? <div className="case-layout">
      <article className="panel table-wrap"><table><thead><tr><th>编号</th><th>事项名称</th><th>记录</th><th>工作类型</th><th>状态</th><th>纠正分类</th><th>操作</th></tr></thead><tbody>{dataset.cases.map(item => {
        const isOpen = selectedId === item.id;
        const completed = item.lifecycle === 'completed';
        return <tr key={item.id} className={completed ? 'case-row-completed' : undefined}>
          <td className="case-code">{item.id}</td><td>{item.title}</td><td>{item.recordIds.length}</td>
          <td><select value={item.kind || 'long-term'} onChange={event => onChange(updateCaseKind(dataset, item.id, event.target.value as 'long-term' | 'periodic'))}><option value="long-term">长期事项</option><option value="periodic">阶段性工作</option></select></td>
          <td><button className={`case-status-button${completed ? ' completed' : ''}`} onClick={() => onChange(updateCaseLifecycle(dataset, item.id, completed ? 'active' : 'completed'))} title={completed ? '重新打开事项' : '标记为已办结'}>{completed ? <><RotateCcw size={13}/>已办结</> : <><Check size={13}/>进行中</>}</button></td>
          <td><select value={item.categoryOverride || ''} onChange={event => onChange(updateCaseCategory(dataset, item.id, event.target.value))}><option value="">使用原始分类</option>{categories.map(category => <option key={category}>{category}</option>)}</select></td>
          <td className="case-actions"><button className={`icon-button${isOpen ? ' active' : ''}`} onClick={() => setSelectedId(current => current === item.id ? undefined : item.id)} aria-label={isOpen ? `收起 ${item.id}` : `查看 ${item.id}`} title={isOpen ? '收起事项' : '查看事项'}>{isOpen ? <EyeOff size={17}/> : <Eye size={17}/>}</button><button className="icon-button danger" onClick={() => detach(item.id)} aria-label={`取消 ${item.id} 的关联`} title="取消关联"><Unlink size={17}/></button></td>
        </tr>;
      })}</tbody></table></article>
      {selected && <aside className="panel case-detail"><div className="case-detail-head"><div><span className="case-code">{selected.id}</span><h3>{selected.title}</h3></div><button className="unlink-button" onClick={() => detach(selected.id)}><Unlink size={15}/>取消关联</button></div><div className="case-detail-status"><span className={selected.lifecycle === 'completed' ? 'completed' : ''}>{selected.lifecycle === 'completed' ? '已办结，可重新打开' : '进行中'}</span><span>{selected.kind === 'periodic' ? '阶段性工作' : '长期事项'}</span></div><p>{selectedRecords[0]?.date} 至 {selectedRecords.at(-1)?.date}</p><div className="lifecycle">{selectedRecords.map(record => <div key={record.id}><time>{record.date}</time><div className="lifecycle-item-head"><strong>{record.title}</strong><button className="icon-button danger lifecycle-delete" onClick={() => detachRecord(record.id)} aria-label={`从 ${selected.id} 中移除 ${record.title}`} title="从此编号中移除"><Trash2 size={14}/></button></div><p>{record.steps.find(step => step.kind === 'text')?.text || '图片处理记录'}</p></div>)}</div></aside>}
    </div> : <div className="large-empty"><FolderKanban size={34}/><h3>还没有已确认的事项编号</h3><p>到“待确认关联”中接受一组建议，或从左侧“自定义关联”手动创建。</p></div>}
  </section>;
}
