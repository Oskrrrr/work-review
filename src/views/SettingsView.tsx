import { CalendarDays, Cloud, Copy, Database, Download, FileSpreadsheet, FileText, ImagePlus, LogIn, RefreshCw, Save, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getPersonalWpsStatus, loginPersonalWps, searchPersonalWpsFiles, type PersonalWpsFile } from '../lib/api';
import type { WorkDataset } from '../types';

const FILE_CONFIG_KEY = 'work-review-personal-wps-file';

export function SettingsView({ dataset, datasets, onImport, onUpdateDataset, onDeleteDataset, onClear, onExportConfig, onImportConfig, onConfigureWps, onPersonalImport, onExportAiText, onCopyAiText, onExportPoster }: { dataset: WorkDataset; datasets: WorkDataset[]; onImport: () => void; onUpdateDataset: (id: string, changes: { displayName: string; year: number }) => void; onDeleteDataset: (id: string) => Promise<void>; onClear: () => void; onExportConfig: () => void; onImportConfig: (file: File) => void; onConfigureWps: () => void; onPersonalImport: (file: PersonalWpsFile) => Promise<void>; onExportAiText: () => void; onCopyAiText: () => void; onExportPoster: () => void }) {
  return <section className="workspace-view">
    <div className="view-heading"><div><h2>数据与同步</h2><p>管理已导入的数据表，连接个人 WPS，或随时导入新的本地 Excel。</p></div></div>
    <div className="settings-dashboard">
      <DatasetLibrary dataset={dataset} datasets={datasets} onImport={onImport} onUpdate={onUpdateDataset} onDelete={onDeleteDataset}/>
      <PersonalWpsPicker onConfigure={onConfigureWps} onImport={onPersonalImport}/>
      <article className="panel setting-card ai-export-card"><FileStatus icon={<FileText/>} title="AI 年度报告素材" value="文字版 · Markdown"/><p className="setting-note">把年度概览、类别、长期工作项目、未串联事项和完整时间线整理成一份适合交给 AI 的文字稿，不包含图片文件本身。</p><div className="config-backup-actions"><button className="primary-action" onClick={onExportAiText}><Download size={15}/>导出文字稿（.md）</button><button className="secondary-action" onClick={onCopyAiText}><Copy size={15}/>复制到剪贴板</button><button className="secondary-action" onClick={onExportPoster}><ImagePlus size={15}/>生成年度海报</button></div></article>
      <article className="panel setting-card config-backup-card"><FileStatus icon={<Download/>} title="个人配置备份" value="可离线迁移"/><p className="setting-note">只保存事项编号、自定义关联、自定义大类和排除词，不包含原始工作记录和图片。</p><div className="config-backup-actions"><button className="secondary-action" onClick={onExportConfig}><Download size={15}/>保存配置到本地</button><label className="secondary-action"><Upload size={15}/>导入本地配置<input type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (file) onImportConfig(file); event.currentTarget.value = ''; }}/></label></div></article>
    </div>
    <button className="danger-link" onClick={onClear}>清除当前客户端中的全部工作记录和图片</button>
  </section>;
}

function DatasetLibrary({ dataset, datasets, onImport, onUpdate, onDelete }: { dataset: WorkDataset; datasets: WorkDataset[]; onImport: () => void; onUpdate: (id: string, changes: { displayName: string; year: number }) => void; onDelete: (id: string) => Promise<void> }) {
  const idOf = (item: WorkDataset) => item.meta.datasetId || `${item.meta.year}-${item.meta.sourceName}`;
  const visibleDatasets = datasets.length ? datasets : dataset.meta.sourceMode === 'demo' ? [] : [dataset];
  const ordered = [...visibleDatasets].sort((a, b) => b.meta.year - a.meta.year || b.meta.importedAt.localeCompare(a.meta.importedAt));
  const [drafts, setDrafts] = useState<Record<string, { name: string; year: string }>>({});
  useEffect(() => setDrafts(Object.fromEntries(ordered.map(item => [idOf(item), { name: item.meta.displayName || item.meta.sourceName, year: String(item.meta.year) }]))), [datasets, dataset]);
  const updateDraft = (id: string, field: 'name' | 'year', value: string) => setDrafts(current => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const save = (item: WorkDataset) => {
    const id = idOf(item);
    const draft = drafts[id];
    const year = Number(draft?.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return;
    onUpdate(id, { displayName: draft?.name ?? item.meta.sourceName, year });
  };
  return <article className="panel dataset-library-card">
    <div className="dataset-library-head"><FileStatus icon={<Database/>} title="已同步数据表" value={ordered.length ? `${ordered.length} 个数据集，按年份排序` : '尚未导入工作记录'}/><button className="primary-action" onClick={onImport}><FileSpreadsheet size={15}/>导入工作簿</button></div>
    <p className="setting-note">在这里整理每张已导入的表。修改“显示名称”只影响年度概览中的下拉名称；删除只移除当前客户端的数据，不会删除原始 Excel 或 WPS 云文件。</p>
    {ordered.length ? <div className="dataset-library-list">{ordered.map(item => { const id = idOf(item); const draft = drafts[id] ?? { name: item.meta.displayName || item.meta.sourceName, year: String(item.meta.year) }; const active = id === idOf(dataset); return <article className={`dataset-library-item${active ? ' active' : ''}`} key={id}>
      <div className="dataset-item-summary"><span className="dataset-year-badge"><CalendarDays size={14}/>{item.meta.year}</span><div><strong>{item.meta.displayName || item.meta.sourceName}</strong><small>{active ? '当前正在查看' : '已同步'} · {item.meta.sheetName} · {item.records.length} 条记录</small></div></div>
      <div className="dataset-edit-fields"><label><span>数据年度</span><input type="number" min="1900" max="2200" value={draft.year} onChange={event => updateDraft(id, 'year', event.target.value)}/></label><label><span>年度概览显示名称</span><input value={draft.name} onChange={event => updateDraft(id, 'name', event.target.value)} placeholder="例如：2026 工作记录"/></label></div>
      <div className="dataset-item-actions"><button className="secondary-action" onClick={() => save(item)} title="保存表格名称和年份"><Save size={14}/>保存</button><button className="icon-text-danger" onClick={() => void onDelete(id)} title="删除当前客户端中的这张表"><Trash2 size={14}/>删除</button></div>
    </article>; })}</div> : <div className="dataset-library-empty"><Database size={21}/><div><strong>还没有同步的数据表</strong><span>导入本地 Excel，或从个人 WPS 中选择一张工作记录表。</span></div></div>}
  </article>;
}

function PersonalWpsPicker({ onConfigure, onImport }: { onConfigure: () => void; onImport: (file: PersonalWpsFile) => Promise<void> }) {
  const [keyword, setKeyword] = useState('');
  const [files, setFiles] = useState<PersonalWpsFile[]>([]);
  const [selected, setSelected] = useState<PersonalWpsFile>(() => { try { return JSON.parse(localStorage.getItem(FILE_CONFIG_KEY) || 'null'); } catch { return undefined; } });
  const [status, setStatus] = useState<{ available: boolean; authenticated: boolean; message?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refreshStatus = async () => { setStatus(await getPersonalWpsStatus()); };
  useEffect(() => { void refreshStatus(); }, []);
  const login = async () => { setBusy(true); setError(''); try { const result = await loginPersonalWps(); setStatus(result); if (!result.authenticated) setError(result.message || '个人 WPS 登录未完成。'); } catch (reason) { setError(reason instanceof Error ? reason.message : '个人 WPS 登录失败。'); } finally { setBusy(false); } };
  const refresh = async () => { setBusy(true); setError(''); try { const current = status || await getPersonalWpsStatus(); setStatus(current); if (!current.authenticated) { setError(current.message || '请先登录个人 WPS。'); return; } setFiles((await searchPersonalWpsFiles(keyword)).files); } catch (reason) { setError(reason instanceof Error ? reason.message : '个人 WPS 文件列表读取失败。'); } finally { setBusy(false); } };
  const choose = (file: PersonalWpsFile) => { localStorage.setItem(FILE_CONFIG_KEY, JSON.stringify(file)); setSelected(file); };
  return <article className="panel setting-card wps-file-picker"><FileStatus icon={<Cloud/>} title="个人 WPS 云文档" value={selected?.name || (status?.authenticated ? '已登录，尚未选择文件' : status?.available === false ? '需要安装组件' : '未连接')}/><p className="setting-note">使用个人 WPS 账号访问自己的云文档，不需要企业 AppID、AppKey 或 CloudBase。登录凭据由官方组件保存在当前电脑中。左下角“同步个人 WPS”只更新年度概览当前正在查看的数据表。</p><div className="settings-wps-actions"><button className="secondary-action" onClick={login} disabled={busy}><LogIn size={15}/>登录个人 WPS</button><button className="primary-action" onClick={refresh} disabled={busy}><RefreshCw size={15} className={busy?'spin':''}/>刷新个人文件</button>{selected&&<button className="secondary-action" onClick={() => onImport(selected)} disabled={busy}>导入已选文件</button>}</div><div className="wps-file-search"><Search size={15}/><input value={keyword} onChange={event=>setKeyword(event.target.value)} placeholder="搜索工作记录、日志或文件名"/><button className="secondary-action" onClick={refresh} disabled={busy}>搜索</button></div>{error&&<div className="dialog-error" role="alert">{error}</div>}{status?.available === false&&<button className="first-run-file-link" onClick={() => window.workReviewDesktop?.openExternal?.('https://github.com/kdocs-app/kdocs-skill')}>安装官方个人 WPS 组件</button>}{files.length>0&&<div className="wps-file-list">{files.map(file=><button className={`wps-file-item${selected?.id===file.id?' active':''}`} key={file.id} onClick={()=>choose(file)}><span><strong>{file.name}</strong><small>{file.modifiedAt?new Date(file.modifiedAt).toLocaleString('zh-CN'):'修改时间未知'}{file.size?` · ${(file.size/1024).toFixed(0)} KB`:''}</small></span><b>{selected?.id===file.id?'已选择':'选择'}</b></button>)}</div>}<button className="first-run-file-link" onClick={onConfigure}>查看个人 WPS 连接说明</button></article>;
}

function FileStatus({icon,title,value}:{icon:React.ReactNode;title:string;value:string}) { return <div className="file-status"><span>{icon}</span><div><small>{title}</small><strong>{value}</strong></div></div>; }
