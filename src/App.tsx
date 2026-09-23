import { CalendarDays, Clock3, Cloud, Eye, EyeOff, FileSpreadsheet, FolderKanban, LayoutDashboard, ListFilter, RefreshCw, Search, Settings, Tags, X, SlidersHorizontal, Link2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImportDialog } from './components/ImportDialog';
import { FirstRunDialog } from './components/FirstRunDialog';
import { PosterExportDialog } from './components/PosterExportDialog';
import { acceptSuggestion, buildCaseSuggestions, renumberCases, type CaseSuggestion } from './lib/cases';
import { clearLocalData, deleteDataset, loadDataset, loadDatasets, saveDataset, saveImages } from './lib/storage';
import { getCloudDataset, getCloudSettings, hasCloudApi, saveCloudCases, saveCloudSettings, WPS_AUTH_PENDING_KEY, PERSONAL_WPS_FILE_KEY, type UserSettings, triggerCloudSync, downloadPersonalWpsFile, type PersonalWpsFile, loginPersonalWps } from './lib/api';
import { demoDataset } from './demo';
import type { LongTermProject, WorkDataset } from './types';
import { importWorkbook, inferYearFromFileName, personalDatasetId, type ImportResult } from './lib/workbook';
import { OverviewView } from './views/OverviewView';
import { TimelineView } from './views/TimelineView';
import { CategoriesView } from './views/CategoriesView';
import { CasesView } from './views/CasesView';
import { SuggestionsView } from './views/SuggestionsView';
import { SettingsView } from './views/SettingsView';
import { GroupEditorView } from './views/GroupEditorView';
import { CustomAssociationView } from './views/CustomAssociationView';
import { WorkFrontView } from './views/WorkFrontView';
import { ProjectDetailView } from './views/ProjectDetailView';
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

function datasetIdOf(item: WorkDataset) {
  return item.meta.datasetId || `${item.meta.year}-${item.meta.sourceName}`;
}

function datasetLabel(item: WorkDataset) {
  return item.meta.displayName?.trim() || item.meta.sourceName;
}

// Imported workbooks commonly carry the data year in their display name
// (for example, “2025工作记录.xlsx”). Prefer that explicit year in the
// overview while keeping the editable metadata year as the fallback.
function datasetDisplayYear(item: WorkDataset) {
  const label = datasetLabel(item);
  const match = label.match(/(?:^|[^\d])(20\d{2})(?=[^\d]|$)/);
  return match ? Number(match[1]) : item.meta.year;
}

function sortDatasets(items: WorkDataset[]) {
  return [...items].sort((a, b) => b.meta.year - a.meta.year || b.meta.importedAt.localeCompare(a.meta.importedAt));
}

const PERSONAL_WPS_FILE_MAP_KEY = 'work-review-personal-wps-files';
const LONG_TERM_PROJECTS_KEY = 'work-review-long-term-projects';

function personalWpsFileMap() {
  try { return JSON.parse(localStorage.getItem(PERSONAL_WPS_FILE_MAP_KEY) || '{}') as Record<string, PersonalWpsFile>; }
  catch { return {}; }
}

function rememberPersonalWpsFile(datasetId: string, file: PersonalWpsFile) {
  try {
    const map = personalWpsFileMap();
    map[datasetId] = file;
    localStorage.setItem(PERSONAL_WPS_FILE_MAP_KEY, JSON.stringify(map));
    localStorage.setItem(PERSONAL_WPS_FILE_KEY, JSON.stringify(file));
  } catch { /* localStorage may be unavailable in a restricted browser */ }
}

function forgetPersonalWpsFile(datasetId: string) {
  try {
    const map = personalWpsFileMap();
    delete map[datasetId];
    localStorage.setItem(PERSONAL_WPS_FILE_MAP_KEY, JSON.stringify(map));
  } catch { /* best effort cleanup */ }
}

function personalFileMatchesDataset(file: PersonalWpsFile | undefined, item: WorkDataset) {
  if (!file || item.meta.sourceMode !== 'personal-wps') return false;
  if (item.meta.sourceFileId) return file.id === item.meta.sourceFileId && (!item.meta.sourceDriveId || file.driveId === item.meta.sourceDriveId);
  return file.name === item.meta.sourceName;
}

function configuredPersonalWpsFile(item: WorkDataset) {
  const id = datasetIdOf(item);
  const mapped = personalWpsFileMap()[id];
  if (personalFileMatchesDataset(mapped, item)) return mapped;
  try {
    const saved = JSON.parse(localStorage.getItem(PERSONAL_WPS_FILE_KEY) || 'null') as PersonalWpsFile | null;
    return personalFileMatchesDataset(saved ?? undefined, item) ? saved ?? undefined : undefined;
  } catch { return undefined; }
}

function loadLongTermProjects() {
  try { return JSON.parse(localStorage.getItem(LONG_TERM_PROJECTS_KEY) || '[]') as LongTermProject[]; } catch { return []; }
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

// Refreshing a workbook replaces only its source records. Keep the user's
// manually confirmed projects, category groups and display name attached to
// the same cloud file while dropping references to rows that no longer exist.
function mergePersonalDataset(previous: WorkDataset, imported: WorkDataset) {
  const recordIds = new Set(imported.records.map(record => record.id));
  const cases = previous.cases
    .map(item => ({ ...item, recordIds: item.recordIds.filter(id => recordIds.has(id)) }))
    .filter(item => item.recordIds.length);
  const customAssociations = (previous.meta.customAssociations ?? []).map(rule => ({
    ...rule,
    recordIds: rule.recordIds.filter(id => recordIds.has(id))
  })).filter(rule => rule.recordIds.length);
  const merged = {
    ...imported,
    cases,
    meta: {
      ...imported.meta,
      ...(previous.meta.displayName ? { displayName: previous.meta.displayName } : {}),
      ...(previous.meta.categoryGroups ? { categoryGroups: previous.meta.categoryGroups } : {}),
      ...(customAssociations.length ? { customAssociations } : {}),
      ...(previous.meta.associationExclusions ? { associationExclusions: previous.meta.associationExclusions } : {})
    }
  };
  return applyCloudSettings(merged, settingsFrom(merged));
}

function App() {
  const [dataset,setDataset] = useState<WorkDataset>(demoDataset);
  const [datasets,setDatasets] = useState<WorkDataset[]>([]);
  const [view,setView] = useState<ViewName>('overview');
  const [selectedDate,setSelectedDate] = useState(newestDate(demoDataset));
  const [importOpen,setImportOpen] = useState(false);
  const [posterOpen,setPosterOpen] = useState(false);
  const [firstRunOpen,setFirstRunOpen] = useState(false);
  const [hydrated,setHydrated] = useState(false);
  const [search,setSearch] = useState('');
  const [imagePreview,setImagePreview] = useState<{url:string;title:string}>();
  const [toast,setToast] = useState('');
  const [rejectedSuggestions,setRejectedSuggestions] = useState<string[]>(() => JSON.parse(localStorage.getItem('rejected-suggestions') || '[]'));
  const [hideContent, setHideContent] = useState(false);
  const [longTermProjects, setLongTermProjects] = useState<LongTermProject[]>(loadLongTermProjects);
  const [projectDetailId, setProjectDetailId] = useState('');
  const toastTimer = useRef<number>();

  // Navigation can otherwise leave a focused control from the previous view
  // alive while React reuses the surrounding layout.  Resetting transient
  // overlays and focus gives every new page a clean, editable surface.
  const navigateToView = (nextView: ViewName) => {
    setImportOpen(false);
    setPosterOpen(false);
    setFirstRunOpen(false);
    setImagePreview(undefined);
    setView(nextView);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
  };

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
    if (stored) { const normalized = renumberCases(stored); setDatasets(sortDatasets(all)); setDataset(normalized); setSelectedDate(newestDate(normalized)); }
    else if (!localStorage.getItem('work-review-onboarding-seen')) setFirstRunOpen(true);
    setHydrated(true);
  })(); }, []);
  useEffect(() => { if (hydrated && dataset.meta.sourceMode !== 'demo') saveDataset(dataset); }, [dataset,hydrated]);
  useEffect(() => { localStorage.setItem(LONG_TERM_PROJECTS_KEY, JSON.stringify(longTermProjects)); }, [longTermProjects]);
  const suggestions = useMemo(() => buildCaseSuggestions(dataset.records,rejectedSuggestions,dataset.meta.associationExclusions ?? []),[dataset.records,rejectedSuggestions,dataset.meta.associationExclusions]);

  const notify = (message:string) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current=window.setTimeout(()=>setToast(''),2600); };
  const datasetId = datasetIdOf;
  const applyDataset = (next:WorkDataset) => {
    const normalized = renumberCases(next);
    setDataset(normalized);
    setDatasets(current => sortDatasets([...current.filter(item => datasetId(item) !== datasetId(normalized)), normalized]));
    void saveDataset(normalized);
  };
  const updateStoredDataset = (id: string, changes: { displayName: string; year: number }) => {
    const target = datasets.find(item => datasetId(item) === id);
    if (!target) return;
    const next = { ...target, meta: { ...target.meta, displayName: changes.displayName.trim() || undefined, year: changes.year } };
    setDatasets(current => sortDatasets(current.map(item => datasetId(item) === id ? next : item)));
    if (datasetId(dataset) === id) {
      setDataset(next);
      setSelectedDate(newestDate(next));
    }
    void saveDataset(next);
    notify('数据表信息已保存');
  };
  const removeStoredDataset = async (id: string) => {
    const target = datasets.find(item => datasetId(item) === id);
    if (!target || !window.confirm(`确定删除“${datasetLabel(target)}”吗？该表的记录、事项配置和关联图片都会从当前客户端移除，原始 Excel 和 WPS 云文件不会被删除。`)) return;
    await deleteDataset(id);
    const remaining = datasets.filter(item => datasetId(item) !== id);
    setDatasets(sortDatasets(remaining));
    if (datasetId(dataset) === id) {
      const next = remaining[0] ?? demoDataset;
      setDataset(next);
      setSelectedDate(newestDate(next));
      if (next.meta.sourceMode !== 'demo') await saveDataset(next);
    }
    forgetPersonalWpsFile(id);
    notify(`已删除数据表“${datasetLabel(target)}”`);
  };
  const assignCaseProject = (caseId: string, projectId?: string) => applyDataset({ ...dataset, cases: dataset.cases.map(item => item.id === caseId ? { ...item, longTermProjectId: projectId || undefined } : item) });
  const createCaseProject = (caseId: string, title: string) => {
    const normalized = title.trim();
    if (!normalized) return;
    const project = { id: `P-${Date.now().toString(36)}`, title: normalized, createdAt: new Date().toISOString() };
    setLongTermProjects(current => [...current, project]);
    assignCaseProject(caseId, project.id);
    notify(`已建立跨年度长期事项“${normalized}”`);
  };
  const updateCaseLifecycleAcrossProject = (caseId: string, lifecycle: 'active' | 'completed') => {
    const target = dataset.cases.find(item => item.id === caseId);
    const projectId = target?.longTermProjectId;
    if (!projectId) { applyDataset({ ...dataset, cases: dataset.cases.map(item => item.id === caseId ? { ...item, lifecycle, ...(lifecycle === 'completed' ? { completedAt: new Date().toISOString() } : { completedAt: undefined }) } : item) }); return; }
    const currentId = datasetId(dataset);
    const source = datasets.some(item => datasetId(item) === currentId) ? datasets : [...datasets, dataset];
    const stamp = new Date().toISOString();
    const nextAll = source.map(item => ({ ...item, cases: item.cases.map(caseItem => caseItem.longTermProjectId === projectId ? { ...caseItem, lifecycle, ...(lifecycle === 'completed' ? { completedAt: stamp } : { completedAt: undefined }) } : caseItem) }));
    const nextCurrent = nextAll.find(item => datasetId(item) === currentId) ?? dataset;
    setDataset(nextCurrent);
    setDatasets(sortDatasets(nextAll.filter(item => item.meta.sourceMode !== 'demo')));
    nextAll.forEach(item => { if (item.meta.sourceMode !== 'demo') void saveDataset(item); });
    notify(lifecycle === 'completed' ? '已将同一跨年度主档的事项全部标记为已办结' : '已重新打开同一跨年度主档的事项');
  };
  const updateCategoryGroups = (groups: Record<string, string[]>) => {
    const currentId = datasetId(dataset);
    const source = datasets.some(item => datasetId(item) === currentId) ? datasets : [...datasets, dataset];
    const nextAll = source.map(item => ({ ...item, meta: { ...item.meta, categoryGroups: groups } }));
    const nextCurrent = nextAll.find(item => datasetId(item) === currentId) ?? { ...dataset, meta: { ...dataset.meta, categoryGroups: groups } };
    setDataset(nextCurrent);
    setDatasets(sortDatasets(nextAll.filter(item => item.meta.sourceMode !== 'demo')));
    nextAll.forEach(item => { if (item.meta.sourceMode !== 'demo') void saveDataset(item); });
  };
  const handleImported = async (result:ImportResult) => { await saveImages(result.images, datasetId(result.dataset)); applyDataset(result.dataset); setSelectedDate(newestDate(result.dataset)); notify(`已保存 ${result.dataset.meta.year} 年数据：${result.dataset.records.length} 条记录和 ${result.dataset.meta.imageCount} 个图片引用`); };
  const handlePersonalWpsImport = async (file: PersonalWpsFile, targetDatasetId?: string) => {
    notify('正在下载个人 WPS 工作记录…');
    try {
      const downloaded = await downloadPersonalWpsFile(file);
      const sourceName = downloaded.name || file.name || '工作记录.xlsx';
      const target = targetDatasetId ? datasets.find(item => datasetId(item) === targetDatasetId) ?? (datasetId(dataset) === targetDatasetId ? dataset : undefined) : undefined;
      const year = inferYearFromFileName(sourceName, target?.meta.year ?? new Date().getFullYear());
      const workbook = new File([downloaded.bytes], sourceName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const result = await importWorkbook(workbook, year);
      const stableId = target ? datasetId(target) : personalDatasetId(file.id, sourceName, file.driveId);
      const imported = {
        ...result.dataset,
        meta: {
          ...result.dataset.meta,
          datasetId: stableId,
          sourceMode: 'personal-wps' as const,
          sourceName,
          sourceFileId: file.id,
          ...(file.driveId ? { sourceDriveId: file.driveId } : {})
        }
      };
      const merged = target ? mergePersonalDataset(target, imported) : imported;
      await saveImages(result.images, stableId);
      applyDataset(merged);
      setSelectedDate(newestDate(merged));
      rememberPersonalWpsFile(stableId, file);
      notify(`已同步个人 WPS：${merged.meta.year} 年，更新 ${merged.records.length} 条记录`);
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
  const clear = async () => { if (!window.confirm('确定清除当前浏览器中的全部年度工作记录和图片吗？原始 Excel 不会受到影响。')) return; await clearLocalData(); setLongTermProjects([]); localStorage.removeItem(LONG_TERM_PROJECTS_KEY); setDatasets([]); setDataset(demoDataset); setSelectedDate(newestDate(demoDataset)); notify('本地数据已清除'); };
  const switchDataset = (id:string) => { const target = datasets.find(item => datasetId(item) === id); if (!target) return; setDataset(target); setSelectedDate(newestDate(target)); };
  const selectHeatmapDate = (date: string) => setSelectedDate(current => current === date ? '' : date);
  const openImage = (url:string,title:string) => setImagePreview({url,title});
  const syncNow = async () => {
    if (dataset.meta.sourceMode === 'personal-wps') {
      const saved = configuredPersonalWpsFile(dataset);
      if (!saved) { navigateToView('settings'); notify('当前年度还没有绑定个人 WPS 文件，请在“数据与同步”中重新选择'); return; }
      await handlePersonalWpsImport(saved, datasetId(dataset));
      return;
    }
    if (dataset.meta.sourceMode !== 'wps' || !hasCloudApi()) { setImportOpen(true); return; }
    notify('正在从 WPS 同步…');
    try { const result = await triggerCloudSync(); const remote = await getCloudDataset(); const local = await loadDataset(); const cloudSettings = await getCloudSettings(); const merged = renumberCases(mergeLocalUserState(remote, local, cloudSettings)); applyDataset(merged); setSelectedDate(newestDate(merged)); await Promise.all([saveCloudCases(merged), saveCloudSettings(settingsFrom(merged))]); notify(`同步完成，读取 ${result.imported} 条记录`); }
    catch (reason) { notify(reason instanceof Error ? reason.message : '同步失败'); }
  };
  const searchMatchCount = search ? dataset.records.filter(record => [record.title,record.caseId,...record.steps.map(step=>step.text)].join(' ').toLowerCase().includes(search.toLowerCase())).length : 0;
  const allDatasets = datasets.some(item => datasetId(item) === datasetId(dataset)) ? datasets : [...datasets, dataset];
  const selectedProject = longTermProjects.find(project => project.id === projectDetailId);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><CalendarDays size={20}/></div><div><strong>工作脉络</strong><span>个人工作记录</span></div></div>
      <nav aria-label="主导航">{navigation.map(item => { const Icon=item.icon; return <div key={item.id}>{item.group && <p>{item.group}</p>}<button className={view===item.id?'active':''} onClick={()=>navigateToView(item.id)}><Icon size={18}/><span>{item.label}</span>{item.id==='cases'&&<em>{dataset.cases.length}</em>}{item.id==='suggestions'&&<em>{suggestions.length}</em>}</button></div>; })}</nav>
      <div className="source-card"><div className="source-title"><Cloud size={17}/><strong>{dataset.meta.sourceMode==='demo'?'等待连接':'数据源已连接'}</strong></div><p>{dataset.meta.sourceName}<br/>{dataset.meta.sourceMode==='demo'?'可先导入本地工作簿':`已导入 ${dataset.records.length} 条记录`}</p><button onClick={syncNow}><RefreshCw size={15}/><span>{dataset.meta.sourceMode==='personal-wps'?'同步个人 WPS':dataset.meta.sourceMode==='wps'?'立即同步':dataset.meta.sourceMode==='demo'?'连接数据源':'重新导入'}</span></button></div>
    </aside>
    <main>
      <header className="topbar"><div><p>工作记录</p>{view==='overview'&&<h1>{datasetDisplayYear(dataset)} 年工作回顾</h1>}</div><div className="top-actions">{datasets.length > 1 && <label className="dataset-switcher"><span>数据年度</span><select value={datasetId(dataset)} onChange={event => switchDataset(event.target.value)}>{sortDatasets(datasets).map(item => <option key={datasetId(item)} value={datasetId(item)}>{datasetLabel(item)}</option>)}</select></label>}<label className="search"><Search size={16}/><input aria-label="全局搜索" value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')setView('timeline')}} placeholder="搜索事项、跟进或编号"/>{search&&<small>{searchMatchCount}</small>}</label><button className={`privacy-toggle${hideContent ? ' active' : ''}`} onClick={() => setHideContent(value => { if (!value) setSearch(''); return !value; })} title={hideContent ? '显示工作内容' : '隐藏工作内容'} aria-label={hideContent ? '显示工作内容' : '隐藏工作内容'}>{hideContent ? <Eye size={16}/> : <EyeOff size={16}/>}</button><div className="avatar">我</div></div></header>
      {dataset.meta.sourceMode==='demo'&&<div className="notice"><span>当前是示例数据。导入你的工作记录 Excel 后，会在当前浏览器中生成真实时间线和图片。</span><button onClick={()=>setView('settings')}>前往数据与同步</button></div>}
      <div key={`${view}:${projectDetailId}`} className="view-host">
      {view==='overview'&&<OverviewView dataset={dataset} year={datasetDisplayYear(dataset)} selectedDate={selectedDate} onSelectDate={selectHeatmapDate} onOpenImage={openImage} onNavigate={name=>navigateToView(name as ViewName)} hideContent={hideContent}/>}
      {view==='timeline'&&<TimelineView dataset={search?{...dataset,records:dataset.records.filter(record=>[record.title,record.caseId,...record.steps.map(step=>step.text)].join(' ').toLowerCase().includes(search.toLowerCase()))}:dataset} onOpenImage={openImage} hideContent={hideContent}/>} 
      {view==='categories'&&<CategoriesView dataset={dataset}/>} 
      {view==='work-front'&&selectedProject&&<ProjectDetailView project={selectedProject} datasets={allDatasets} onBack={()=>setProjectDetailId('')} onOpenImage={openImage} onChangeLifecycle={updateCaseLifecycleAcrossProject} hideContent={hideContent}/>}
      {view==='work-front'&&!selectedProject&&<WorkFrontView dataset={dataset} datasets={allDatasets} projects={longTermProjects} onOpenCase={()=>setView('cases')} onOpenProject={setProjectDetailId} onChangeLifecycle={updateCaseLifecycleAcrossProject}/>}
      {view==='group-editor'&&<GroupEditorView dataset={dataset} datasets={datasets} onChange={applyDataset} onChangeGroups={updateCategoryGroups}/>}
      {view==='custom-association'&&<CustomAssociationView dataset={dataset} onChange={applyDataset}/>} 
      {view==='cases'&&<CasesView dataset={dataset} projects={longTermProjects} onAssignProject={assignCaseProject} onCreateProject={createCaseProject} onChange={applyDataset} onChangeLifecycle={updateCaseLifecycleAcrossProject}/>}
      {view==='suggestions'&&<SuggestionsView suggestions={suggestions} onAccept={accept} onReject={reject}/>} 
      {view==='settings'&&<SettingsView dataset={dataset} datasets={datasets} onImport={()=>setImportOpen(true)} onUpdateDataset={updateStoredDataset} onDeleteDataset={removeStoredDataset} onClear={clear} onExportConfig={exportConfig} onImportConfig={importConfig} onConfigureWps={()=>setFirstRunOpen(true)} onPersonalImport={file => handlePersonalWpsImport(file, dataset.meta.sourceMode === 'personal-wps' && personalFileMatchesDataset(file, dataset) ? datasetId(dataset) : undefined)} onExportAiText={exportAiText} onCopyAiText={copyAiText} onExportPoster={()=>setPosterOpen(true)}/>}
      </div>
    </main>
    <ImportDialog open={importOpen} onClose={()=>setImportOpen(false)} onImported={handleImported}/>
    <PosterExportDialog open={posterOpen} dataset={dataset} defaultHideContent={hideContent} onClose={()=>setPosterOpen(false)} onSaved={notify}/>
    <FirstRunDialog open={firstRunOpen} onSkip={()=>setFirstRunOpen(false)} onContinue={()=>setFirstRunOpen(false)} onImport={()=>{ setFirstRunOpen(false); setImportOpen(true); }} onPersonalLogin={async () => { try { const result = await loginPersonalWps(); if (!result.authenticated) throw new Error(result.message || '个人 WPS 登录未完成'); setFirstRunOpen(false); setView('settings'); notify('个人 WPS 已连接，请选择工作记录文件'); } catch (reason) { notify(reason instanceof Error ? reason.message : '个人 WPS 登录失败'); } }}/>
    {imagePreview&&<div className="image-lightbox" onMouseDown={event=>event.target===event.currentTarget&&setImagePreview(undefined)}><figure><button onClick={()=>setImagePreview(undefined)} aria-label="关闭"><X/></button><img src={imagePreview.url} alt={imagePreview.title}/><figcaption>{imagePreview.title}</figcaption></figure></div>}
    <div className={`toast${toast?' show':''}`} aria-live="polite">{toast}</div>
  </div>;
}

export default App;
