import { CalendarDays, Clock3, Cloud, Eye, EyeOff, FileSpreadsheet, FolderKanban, LayoutDashboard, ListFilter, RefreshCw, Search, Settings, Tags, X, SlidersHorizontal, Link2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImportDialog } from './components/ImportDialog';
import { FirstRunDialog } from './components/FirstRunDialog';
import { acceptSuggestion, buildCaseSuggestions, renumberCases, type CaseSuggestion } from './lib/cases';
import { clearLocalData, loadDataset, loadDatasets, saveDataset, saveImages } from './lib/storage';
import { getCloudDataset, getCloudSettings, hasCloudApi, saveCloudCases, saveCloudSettings, WPS_AUTH_PENDING_KEY, type UserSettings, triggerCloudSync, downloadPersonalWpsFile, type PersonalWpsFile, loginPersonalWps } from './lib/api';
import { demoDataset } from './demo';
import type { WorkDataset } from './types';
import { importWorkbook, type ImportResult } from './lib/workbook';
import { OverviewView } from './views/OverviewView';
import { TimelineView } from './views/TimelineView';
import { CategoriesView } from './views/CategoriesView';
import { CasesView } from './views/CasesView';
import { SuggestionsView } from './views/SuggestionsView';
import { SettingsView } from './views/SettingsView';
import { GroupEditorView } from './views/GroupEditorView';
import { CustomAssociationView } from './views/CustomAssociationView';
import { WorkFrontView } from './views/WorkFrontView';
import { buildAiWorklogMarkdown } from './lib/textExport';

type ViewName = 'overview'|'timeline'|'categories'|'work-front'|'cases'|'suggestions'|'group-editor'|'custom-association'|'settings';

const navigation: Array<{group?:string;id:ViewName;label:string;icon:typeof LayoutDashboard}> = [
  {group:'回顾',id:'overview',label:'年度概览',icon:LayoutDashboard},
  {id:'timeline',label:'工作时间线',icon:FileSpreadsheet},
  {id:'categories',label:'分类复盘',icon:Tags},
  {id:'work-front',label:'长期工作前台',icon:Clock3},
  {group:'配置',id:'group-editor',label:'分类大类编辑',icon:SlidersHorizontal},
  {id:'custom-association',label:'自定义关联',icon:Link2},
  {group:'事项',id:'cases',label:'事项编号总表',icon:FolderKanban},
  {id:'suggestions',label:'待确认关联',icon:ListFilter},
  {group:'系统',id:'settings',label:'数据与同步',icon:Settings}
];

function newestDate(dataset: WorkDataset) {
  return dataset.records.reduce((latest, record) => record.date > latest ? record.date : latest, `${dataset.meta.year}-01-01`);
}

// WPS 同步只更新原始记录；本机保存的人工关联不能被远端数据覆盖。
function settingsFrom(dataset: WorkDataset): UserSettings {
  return { cases: dataset.cases, categoryGroups: dataset.meta.categoryGroups ?? {}, customAssociations: dataset.meta.customAssociations ?? [], associationExclusions: dataset.meta.associationExclusions ?? [] };
}

function applyCloudSettings(dataset: WorkDataset, settings?: Partial<UserSettings>) {
  if (!settings) return dataset;
  const cases = settings.cases ?? dataset.cases;
  const caseByRecord = new Map(cases.flatMap(item => item.recordIds.map(recordId => [recordId, item] as const)));
  const records = dataset.records.map(record => { const item = caseByRecord.get(record.id); return item ? { ...record, caseId: item.id, effectiveCategory: item.categoryOverride || record.originalCategory } : record; });
  return { ...dataset, cases, records, meta: { ...dataset.meta, ...(settings.categoryGroups ? { categoryGroups: settings.categoryGroups } : {}), ...(settings.customAssociations ? { customAssociations: settings.customAssociations } : {}), ...(settings.associationExclusions ? { associationExclusions: settings.associationExclusions } : {}) } };
}

function mergeLocalUserState(remote: WorkDataset, local?: WorkDataset, cloudSettings?: Partial<UserSettings>) {
  if (!local) return remote;
  const localCaseIds = new Map(local.records.filter(record => record.caseId).map(record => [record.id, record.caseId!]));
  const savedRules = local.meta.customAssociations ?? [];
  const recoveredCases = savedRules.filter(rule => !local.cases.some(item => item.id === rule.caseId)).map(rule => ({ id: rule.caseId, title: rule.title, recordIds: rule.recordIds, status: 'confirmed' as const, createdAt: rule.createdAt }));
  savedRules.forEach(rule => rule.recordIds.forEach(recordId => localCaseIds.set(recordId, rule.caseId)));
  const records = remote.records.map(record => localCaseIds.has(record.id) ? { ...record, caseId: localCaseIds.get(record.id) } : record);
  const merged = {
    ...remote,
    records,
    cases: local.cases.length ? [...local.cases, ...recoveredCases] : (recoveredCases.length ? recoveredCases : remote.cases),
    meta: { ...remote.meta, ...(local.meta.categoryGroups ? { categoryGroups: local.meta.categoryGroups } : {}), ...(local.meta.customAssociations ? { customAssociations: local.meta.customAssociations } : {}), ...(local.meta.associationExclusions ? { associationExclusions: local.meta.associationExclusions } : {}) }
  };
  const localHasSettings = Boolean(local && (local.cases.length || local.meta.categoryGroups || local.meta.customAssociations || local.meta.associationExclusions));
  return applyCloudSettings(merged, localHasSettings ? settingsFrom(local!) : cloudSettings);
}

function App() {
  const [dataset,setDataset] = useState<WorkDataset>(demoDataset);
  const [datasets,setDatasets] = useState<WorkDataset[]>([]);
  const [view,setView] = useState<ViewName>('overview');
  const [selectedDate,setSelectedDate] = useState(newestDate(demoDataset));
  const [importOpen,setImportOpen] = useState(false);
  const [firstRunOpen,setFirstRunOpen] = useState(false);
  const [hydrated,setHydrated] = useState(false);
  const [search,setSearch] = useState('');
  const [imagePreview,setImagePreview] = useState<{url:string;title:string}>();
  const [toast,setToast] = useState('');
  const [rejectedSuggestions,setRejectedSuggestions] = useState<string[]>(() => JSON.parse(localStorage.getItem('rejected-suggestions') || '[]'));
  const [hideContent, setHideContent] = useState(false);
  const toastTimer = useRef<number>();

  // 如果上一次授权过程中客户端被关闭，下一次启动时只清理 WPS 的
  // 登录 Cookie/缓存，不触碰工作记录、IndexedDB 或本地配置。
  useEffect(() => {
    if (!localStorage.getItem(WPS_AUTH_PENDING_KEY)) return;
    localStorage.removeItem(WPS_AUTH_PENDING_KEY);
    const clearWpsPromise = window.workReviewDesktop?.clearWpsSession?.();
    void clearWpsPromise?.catch(() => undefined);
  }, []);

  useEffect(() => { (async () => {
    const stored = await loadDataset();
    const all = await loadDatasets();
    if (stored) { const normalized = renumberCases(stored); setDatasets(all); setDataset(normalized); setSelectedDate(newestDate(normalized)); }
    else if (!localStorage.getItem('work-review-onboarding-seen')) setFirstRunOpen(true);
    setHydrated(true);
  })(); }, []);
  useEffect(() => { if (hydrated && dataset.meta.sourceMode !== 'demo') saveDataset(dataset); }, [dataset,hydrated]);
  const suggestions = useMemo(() => buildCaseSuggestions(dataset.records,rejectedSuggestions,dataset.meta.associationExclusions ?? []),[dataset.records,rejectedSuggestions,dataset.meta.associationExclusions]);

  const notify = (message:string) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current=window.setTimeout(()=>setToast(''),2600); };
  const datasetId = (item: WorkDataset) => item.meta.datasetId || `${item.meta.year}-${item.meta.sourceName}`;
  const applyDataset = (next:WorkDataset) => {
    const normalized = renumberCases(next);
    setDataset(normalized);
    setDatasets(current => [...current.filter(item => datasetId(item) !== datasetId(normalized)), normalized].sort((a, b) => b.meta.year - a.meta.year || b.meta.importedAt.localeCompare(a.meta.importedAt)));
    void saveDataset(normalized);
  };
  const handleImported = async (result:ImportResult) => { await saveImages(result.images, datasetId(result.dataset)); applyDataset(result.dataset); setSelectedDate(newestDate(result.dataset)); notify(`已保存 ${result.dataset.meta.year} 年数据：${result.dataset.records.length} 条记录和 ${result.dataset.meta.imageCount} 个图片引用`); };
  const handlePersonalWpsImport = async (file: PersonalWpsFile) => {
    notify('正在下载个人 WPS 工作记录…');
    try {
      const downloaded = await downloadPersonalWpsFile(file);
      const workbook = new File([downloaded.bytes], downloaded.name || file.name || '工作记录.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const result = await importWorkbook(workbook, new Date().getFullYear());
      result.dataset.meta.sourceMode = 'personal-wps';
      result.dataset.meta.sourceName = downloaded.name || file.name;
      await handleImported(result);
      localStorage.setItem('work-review-personal-wps-file', JSON.stringify(file));
      notify(`已从个人 WPS 导入 ${result.dataset.records.length} 条记录`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '个人 WPS 文件导入失败');
    }
  };
  const exportConfig = () => { const payload = { format: 'work-review-settings', version: 1, exportedAt: new Date().toISOString(), sourceName: dataset.meta.sourceName, settings: settingsFrom(dataset) }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `工作配置-${dataset.meta.year}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); notify('配置已保存到本地'); };
  const exportAiText = () => { const markdown = buildAiWorklogMarkdown(dataset); const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${dataset.meta.year}年工作记录-AI年度报告素材.md`; link.click(); URL.revokeObjectURL(url); notify('AI 年度报告素材已导出'); };
  const copyAiText = async () => { const markdown = buildAiWorklogMarkdown(dataset); try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(markdown); else { const textarea = document.createElement('textarea'); textarea.value = markdown; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); if (!document.execCommand('copy')) throw new Error('copy failed'); textarea.remove(); } notify('AI 年度报告素材已复制，可直接粘贴给 AI'); } catch { notify('复制失败，请先导出文字文件'); } };
  const importConfig = async (file: File) => { try { const payload = JSON.parse(await file.text()) as { format?: string; settings?: Partial<UserSettings> }; const settings = payload.settings; if (payload.format !== 'work-review-settings' || !settings || !Array.isArray(settings.cases)) throw new Error('配置文件格式不正确'); const merged = renumberCases(applyCloudSettings(dataset, settings)); applyDataset(merged); notify(`已导入 ${merged.cases.length} 个事项配置`); } catch (error) { notify(error instanceof Error ? error.message : '配置文件读取失败'); } };
  const accept = (suggestion:CaseSuggestion) => { const next=acceptSuggestion(dataset,suggestion); applyDataset(next); notify(`已生成 ${next.cases.at(-1)?.id}`); };
  const reject = (suggestion:CaseSuggestion) => { const next=[...rejectedSuggestions,suggestion.id]; setRejectedSuggestions(next); localStorage.setItem('rejected-suggestions',JSON.stringify(next)); notify('已忽略这条关联建议'); };
  const clear = async () => { if (!window.confirm('确定清除当前浏览器中的全部年度工作记录和图片吗？原始 Excel 不会受到影响。')) return; await clearLocalData(); setDatasets([]); setDataset(demoDataset); setSelectedDate(newestDate(demoDataset)); notify('本地数据已清除'); };
  const switchDataset = (id:string) => { const target = datasets.find(item => datasetId(item) === id); if (!target) return; setDataset(target); setSelectedDate(newestDate(target)); };
  const openImage = (url:string,title:string) => setImagePreview({url,title});
  const syncNow = async () => {
    if (dataset.meta.sourceMode === 'personal-wps') {
      const saved = localStorage.getItem('work-review-personal-wps-file');
      if (!saved) { setView('settings'); notify('请先在“数据与同步”中选择个人 WPS 文件'); return; }
      try { await handlePersonalWpsImport(JSON.parse(saved) as PersonalWpsFile); } catch { setView('settings'); notify('个人 WPS 文件配置已失效，请重新选择'); }
      return;
    }
    if (dataset.meta.sourceMode !== 'wps' || !hasCloudApi()) { setImportOpen(true); return; }
    notify('正在从 WPS 同步…');
    try { const result = await triggerCloudSync(); const remote = await getCloudDataset(); const local = await loadDataset(); const cloudSettings = await getCloudSettings(); const merged = renumberCases(mergeLocalUserState(remote, local, cloudSettings)); applyDataset(merged); setSelectedDate(newestDate(merged)); await Promise.all([saveCloudCases(merged), saveCloudSettings(settingsFrom(merged))]); notify(`同步完成，读取 ${result.imported} 条记录`); }
    catch (reason) { notify(reason instanceof Error ? reason.message : '同步失败'); }
  };
  const searchMatchCount = search ? dataset.records.filter(record => [record.title,record.caseId,...record.steps.map(step=>step.text)].join(' ').toLowerCase().includes(search.toLowerCase())).length : 0;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><CalendarDays size={20}/></div><div><strong>工作脉络</strong><span>个人工作记录</span></div></div>
      <nav aria-label="主导航">{navigation.map(item => { const Icon=item.icon; return <div key={item.id}>{item.group && <p>{item.group}</p>}<button className={view===item.id?'active':''} onClick={()=>setView(item.id)}><Icon size={18}/><span>{item.label}</span>{item.id==='cases'&&<em>{dataset.cases.length}</em>}{item.id==='suggestions'&&<em>{suggestions.length}</em>}</button></div>; })}</nav>
      <div className="source-card"><div className="source-title"><Cloud size={17}/><strong>{dataset.meta.sourceMode==='demo'?'等待连接':'数据源已连接'}</strong></div><p>{dataset.meta.sourceName}<br/>{dataset.meta.sourceMode==='demo'?'可先导入本地工作簿':`已导入 ${dataset.records.length} 条记录`}</p><button onClick={syncNow}><RefreshCw size={15}/><span>{dataset.meta.sourceMode==='personal-wps'?'同步个人 WPS':dataset.meta.sourceMode==='wps'?'立即同步':dataset.meta.sourceMode==='demo'?'连接数据源':'重新导入'}</span></button></div>
    </aside>
    <main>
      <header className="topbar"><div><p>工作记录</p>{view==='overview'&&<h1>{dataset.meta.year} 年工作回顾</h1>}</div><div className="top-actions">{datasets.length > 1 && <label className="dataset-switcher"><span>数据年度</span><select value={datasetId(dataset)} onChange={event => switchDataset(event.target.value)}>{datasets.map(item => <option key={datasetId(item)} value={datasetId(item)}>{item.meta.year} · {item.meta.sourceName}</option>)}</select></label>}<label className="search"><Search size={16}/><input aria-label="全局搜索" value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')setView('timeline')}} placeholder="搜索事项、跟进或编号"/>{search&&<small>{searchMatchCount}</small>}</label><button className={`privacy-toggle${hideContent ? ' active' : ''}`} onClick={() => setHideContent(value => !value)} title={hideContent ? '显示工作内容' : '隐藏工作内容'}>{hideContent ? <Eye size={16}/> : <EyeOff size={16}/>}<span>{hideContent ? '显示内容' : '隐藏内容'}</span></button><button className="import-button" onClick={()=>setImportOpen(true)}><FileSpreadsheet size={17}/><span>导入工作簿</span></button><div className="avatar">我</div></div></header>
      {dataset.meta.sourceMode==='demo'&&<div className="notice"><span>当前是示例数据。导入你的工作记录 Excel 后，会在当前浏览器中生成真实时间线和图片。</span><button onClick={()=>setImportOpen(true)}>现在导入</button></div>}
      {view==='overview'&&<OverviewView dataset={dataset} selectedDate={selectedDate} onSelectDate={setSelectedDate} onOpenImage={openImage} onNavigate={name=>setView(name as ViewName)} hideContent={hideContent}/>} 
      {view==='timeline'&&<TimelineView dataset={search?{...dataset,records:dataset.records.filter(record=>[record.title,record.caseId,...record.steps.map(step=>step.text)].join(' ').toLowerCase().includes(search.toLowerCase()))}:dataset} onOpenImage={openImage} hideContent={hideContent}/>} 
      {view==='categories'&&<CategoriesView dataset={dataset}/>} 
      {view==='work-front'&&<WorkFrontView dataset={dataset} onOpenCase={()=>setView('cases')}/>} 
      {view==='group-editor'&&<GroupEditorView dataset={dataset} onChange={applyDataset}/>} 
      {view==='custom-association'&&<CustomAssociationView dataset={dataset} onChange={applyDataset}/>} 
      {view==='cases'&&<CasesView dataset={dataset} onChange={applyDataset}/>} 
      {view==='suggestions'&&<SuggestionsView suggestions={suggestions} onAccept={accept} onReject={reject}/>} 
      {view==='settings'&&<SettingsView dataset={dataset} onImport={()=>setImportOpen(true)} onClear={clear} onExportConfig={exportConfig} onImportConfig={importConfig} onConfigureWps={()=>setFirstRunOpen(true)} onPersonalImport={handlePersonalWpsImport} onExportAiText={exportAiText} onCopyAiText={copyAiText}/>} 
    </main>
    <ImportDialog open={importOpen} onClose={()=>setImportOpen(false)} onImported={handleImported}/>
    <FirstRunDialog open={firstRunOpen} onSkip={()=>setFirstRunOpen(false)} onContinue={()=>setFirstRunOpen(false)} onImport={()=>{ setFirstRunOpen(false); setImportOpen(true); }} onPersonalLogin={async () => { try { const result = await loginPersonalWps(); if (!result.authenticated) throw new Error(result.message || '个人 WPS 登录未完成'); setFirstRunOpen(false); setView('settings'); notify('个人 WPS 已连接，请选择工作记录文件'); } catch (reason) { notify(reason instanceof Error ? reason.message : '个人 WPS 登录失败'); } }}/>
    {imagePreview&&<div className="image-lightbox" onMouseDown={event=>event.target===event.currentTarget&&setImagePreview(undefined)}><figure><button onClick={()=>setImagePreview(undefined)} aria-label="关闭"><X/></button><img src={imagePreview.url} alt={imagePreview.title}/><figcaption>{imagePreview.title}</figcaption></figure></div>}
    <div className={`toast${toast?' show':''}`} aria-live="polite">{toast}</div>
  </div>;
}

export default App;
