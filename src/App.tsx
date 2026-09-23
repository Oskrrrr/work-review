import { Clock3, Cloud, Eye, EyeOff, FileSpreadsheet, FolderKanban, Info, LayoutDashboard, ListFilter, RefreshCw, Search, Settings, Tags, X, SlidersHorizontal, Link2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImportDialog } from './components/ImportDialog';
import { FirstRunDialog } from './components/FirstRunDialog';
import { PosterExportDialog } from './components/PosterExportDialog';
import { acceptSuggestion, associationRecordKey, buildCaseSuggestions, mergeCases, renumberCases, type CaseSuggestion } from './lib/cases';
import { clearLocalData, deleteDataset, loadDataset, loadDatasets, saveDataset, saveImages } from './lib/storage';
import { getCloudDataset, getCloudSettings, hasCloudApi, saveCloudCases, saveCloudSettings, WPS_AUTH_PENDING_KEY, PERSONAL_WPS_FILE_KEY, type UserSettings, triggerCloudSync, downloadPersonalWpsFile, type PersonalWpsFile, loginPersonalWps } from './lib/api';
import { demoDataset } from './demo';
import type { LongTermProject, ProjectRecordLink, WorkDataset } from './types';
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
import { AboutView } from './views/AboutView';
import { buildAiWorklogMarkdown } from './lib/textExport';
import { reconcilePersonalDataset } from './lib/personalSync';

type ViewName = 'overview'|'timeline'|'categories'|'work-front'|'cases'|'suggestions'|'group-editor'|'custom-association'|'settings'|'about';

const navigation: Array<{group?:string;id:ViewName;label:string;icon:typeof LayoutDashboard}> = [
  {group:'回顾',id:'overview',label:'年度概览',icon:LayoutDashboard},
  {id:'timeline',label:'工作时间线',icon:FileSpreadsheet},
  {id:'categories',label:'分类复盘',icon:Tags},
  {id:'work-front',label:'长期工作前台',icon:Clock3},
  {group:'配置',id:'group-editor',label:'分类大类编辑',icon:SlidersHorizontal},
  {id:'custom-association',label:'自定义关联',icon:Link2},
  {group:'事项',id:'cases',label:'事项编号总表',icon:FolderKanban},
  {id:'suggestions',label:'待确认关联',icon:ListFilter},
  {group:'系统',id:'settings',label:'数据与同步',icon:Settings},
  {id:'about',label:'软件信息',icon:Info}
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

// WPS 同步只更新原始记录；本机保存的人工关联会在刷新后的记录中重新对账。
function settingsFrom(dataset: WorkDataset): UserSettings {
  const derivedHistory = dataset.cases.flatMap(item => item.recordIds.map(id => dataset.records.find(record => record.id === id)).filter((record): record is WorkDataset['records'][number] => Boolean(record)).map(associationRecordKey));
  return { cases: dataset.cases, categoryGroups: dataset.meta.categoryGroups ?? {}, customAssociations: dataset.meta.customAssociations ?? [], associationExclusions: dataset.meta.associationExclusions ?? [], associationHistory: [...new Set([...(dataset.meta.associationHistory ?? []), ...derivedHistory])] };
}

function applyCloudSettings(dataset: WorkDataset, settings?: Partial<UserSettings>) {
  if (!settings) return dataset;
  const cases = settings.cases ?? dataset.cases;
  const caseByRecord = new Map(cases.flatMap(item => item.recordIds.map(recordId => [recordId, item] as const)));
  const records = dataset.records.map(record => { const item = caseByRecord.get(record.id); return item ? { ...record, caseId: item.id, effectiveCategory: item.categoryOverride || record.originalCategory } : record; });
  return { ...dataset, cases, records, meta: { ...dataset.meta, ...(settings.categoryGroups ? { categoryGroups: settings.categoryGroups } : {}), ...(settings.customAssociations ? { customAssociations: settings.customAssociations } : {}), ...(settings.associationExclusions ? { associationExclusions: settings.associationExclusions } : {}), ...(settings.associationHistory ? { associationHistory: settings.associationHistory } : {}) } };
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
    meta: { ...remote.meta, ...(local.meta.categoryGroups ? { categoryGroups: local.meta.categoryGroups } : {}), ...(local.meta.customAssociations ? { customAssociations: local.meta.customAssociations } : {}), ...(local.meta.associationExclusions ? { associationExclusions: local.meta.associationExclusions } : {}), ...(local.meta.associationHistory ? { associationHistory: local.meta.associationHistory } : {}) }
  };
  const localHasSettings = Boolean(local && (local.cases.length || local.meta.categoryGroups || local.meta.customAssociations || local.meta.associationExclusions || local.meta.associationHistory));
  return applyCloudSettings(merged, localHasSettings ? settingsFrom(local!) : cloudSettings);
}

// Refreshing a workbook replaces its source records, then reconciles the
// user's manually confirmed projects and associations against the new rows.
function mergePersonalDataset(previous: WorkDataset, imported: WorkDataset) {
  const merged = reconcilePersonalDataset(previous, imported);
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
  const suggestions = useMemo(() => buildCaseSuggestions(dataset.records,rejectedSuggestions,dataset.meta.associationExclusions ?? [],dataset.cases,dataset.meta.associationHistory ?? []),[dataset.records,dataset.cases,rejectedSuggestions,dataset.meta.associationExclusions,dataset.meta.associationHistory]);

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
  const addRecordsToProject = (projectId: string, links: ProjectRecordLink[]) => {
    if (!links.length) return;
    setLongTermProjects(current => current.map(project => {
      if (project.id !== projectId) return project;
      const existing = new Set((project.recordLinks || []).map(link => `${link.datasetId}:${link.recordId}`));
      return { ...project, recordLinks: [...(project.recordLinks || []), ...links.filter(link => !existing.has(`${link.datasetId}:${link.recordId}`))] };
    }));
    notify(`已将 ${links.length} 条记录加入跨年度主档`);
  };
  const removeRecordFromProject = (projectId: string, link: ProjectRecordLink) => {
    if (!window.confirm('确定将这条记录移出跨年度主档吗？原始记录和事项编号不会被删除。')) return;
    setLongTermProjects(current => current.map(project => project.id === projectId ? { ...project, recordLinks: (project.recordLinks || []).filter(item => !(item.datasetId === link.datasetId && item.recordId === link.recordId)) } : project));
    notify('已将记录移出跨年度主档');
  };
  const mergeSelectedCases = (caseIds: string[]) => {
    const next = mergeCases(dataset, caseIds);
    if (next === dataset) return;
    applyDataset(next);
    notify(`已将 ${caseIds.length} 个事项合并为一件工作`);
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
  const exportConfig = () => {
    const all = [...datasets, dataset].filter((item, index, list) => list.findIndex(candidate => datasetIdOf(candidate) === datasetIdOf(item)) === index && item.meta.sourceMode !== 'demo');
    const payload = {
      format: 'work-review-settings', version: 2, exportedAt: new Date().toISOString(), activeDatasetId: datasetId(dataset),
      datasets: all.map(item => ({ id: datasetId(item), meta: { datasetId: item.meta.datasetId, displayName: item.meta.displayName, sourceName: item.meta.sourceName, sheetName: item.meta.sheetName, year: item.meta.year, sourceMode: item.meta.sourceMode, sourceFileId: item.meta.sourceFileId, sourceDriveId: item.meta.sourceDriveId }, settings: settingsFrom(item) })),
      longTermProjects,
      rejectedSuggestions,
      personalWpsFiles: personalWpsFileMap(),
      selectedPersonalWpsFile: (() => { try { return JSON.parse(localStorage.getItem(PERSONAL_WPS_FILE_KEY) || 'null'); } catch { return null; } })(),
      hideContent
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `工作配置-完整备份-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); notify(`已保存完整配置备份（${all.length} 个数据集）`);
  };
  const exportAiText = () => { const markdown = buildAiWorklogMarkdown(dataset); const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${dataset.meta.year}年工作记录-AI年度报告素材.md`; link.click(); URL.revokeObjectURL(url); notify('AI 年度报告素材已导出'); };
  const copyAiText = async () => { const markdown = buildAiWorklogMarkdown(dataset); try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(markdown); else { const textarea = document.createElement('textarea'); textarea.value = markdown; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); if (!document.execCommand('copy')) throw new Error('copy failed'); textarea.remove(); } notify('AI 年度报告素材已复制，可直接粘贴给 AI'); } catch { notify('复制失败，请先导出文字文件'); } };
  const importConfig = async (file: File) => {
    try {
      const payload = JSON.parse(await file.text()) as { format?: string; version?: number; settings?: Partial<UserSettings>; datasets?: Array<{ id?: string; meta?: Partial<WorkDataset['meta']>; settings?: Partial<UserSettings> }>; activeDatasetId?: string; longTermProjects?: LongTermProject[]; rejectedSuggestions?: string[]; personalWpsFiles?: Record<string, PersonalWpsFile>; selectedPersonalWpsFile?: PersonalWpsFile | null; hideContent?: boolean };
      if (payload.format !== 'work-review-settings') throw new Error('配置文件格式不正确');
      if (payload.version === 2 && Array.isArray(payload.datasets)) {
        const source = datasets.some(item => datasetId(item) === datasetId(dataset)) ? datasets : [...datasets, dataset];
        const restored = source.map(item => {
          const entry = payload.datasets?.find(candidate => candidate.id === datasetId(item) || (candidate.meta?.sourceName === item.meta.sourceName && candidate.meta?.year === item.meta.year));
          if (!entry?.settings) return item;
          const next = applyCloudSettings(item, entry.settings);
          return { ...next, meta: { ...next.meta, ...(entry.meta?.displayName !== undefined ? { displayName: entry.meta.displayName } : {}), ...(entry.meta?.year ? { year: entry.meta.year } : {}), ...(entry.meta?.sourceFileId ? { sourceFileId: entry.meta.sourceFileId } : {}), ...(entry.meta?.sourceDriveId ? { sourceDriveId: entry.meta.sourceDriveId } : {}) } };
        });
        const currentId = payload.activeDatasetId && restored.some(item => datasetId(item) === payload.activeDatasetId) ? payload.activeDatasetId : datasetId(dataset);
        const nextCurrent = restored.find(item => datasetId(item) === currentId) ?? restored[0] ?? dataset;
        setDataset(nextCurrent); setDatasets(sortDatasets(restored.filter(item => item.meta.sourceMode !== 'demo'))); void Promise.all(restored.filter(item => item.meta.sourceMode !== 'demo').map(item => saveDataset(item)));
        if (Array.isArray(payload.longTermProjects)) { setLongTermProjects(payload.longTermProjects); localStorage.setItem(LONG_TERM_PROJECTS_KEY, JSON.stringify(payload.longTermProjects)); }
        if (Array.isArray(payload.rejectedSuggestions)) { setRejectedSuggestions(payload.rejectedSuggestions); localStorage.setItem('rejected-suggestions', JSON.stringify(payload.rejectedSuggestions)); }
        if (payload.personalWpsFiles && typeof payload.personalWpsFiles === 'object') localStorage.setItem(PERSONAL_WPS_FILE_MAP_KEY, JSON.stringify(payload.personalWpsFiles));
        if (payload.selectedPersonalWpsFile) localStorage.setItem(PERSONAL_WPS_FILE_KEY, JSON.stringify(payload.selectedPersonalWpsFile));
        if (typeof payload.hideContent === 'boolean') setHideContent(payload.hideContent);
        notify(`已导入完整配置：${restored.filter(item => item.meta.sourceMode !== 'demo').length} 个数据集`);
        return;
      }
      const settings = payload.settings;
      if (!settings || !Array.isArray(settings.cases)) throw new Error('配置文件格式不正确'); const merged = renumberCases(applyCloudSettings(dataset, settings)); applyDataset(merged); notify(`已导入 ${merged.cases.length} 个事项配置`);
    } catch (error) { notify(error instanceof Error ? error.message : '配置文件读取失败'); }
  };
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
      <div className="brand"><div className="brand-mark"><img src="./work-review-icon.png" alt="" /></div><div><strong>工作脉络</strong><span>个人工作记录</span></div></div>
      <nav aria-label="主导航">{navigation.map(item => { const Icon=item.icon; return <div key={item.id}>{item.group && <p>{item.group}</p>}<button className={view===item.id?'active':''} onClick={()=>navigateToView(item.id)}><Icon size={18}/><span>{item.label}</span>{item.id==='cases'&&<em>{dataset.cases.length}</em>}{item.id==='suggestions'&&<em>{suggestions.length}</em>}</button></div>; })}</nav>
      <div className="source-card"><div className="source-title"><Cloud size={17}/><strong>{dataset.meta.sourceMode==='demo'?'等待连接':'数据源已连接'}</strong></div><p>{dataset.meta.sourceName}<br/>{dataset.meta.sourceMode==='demo'?'可先导入本地工作簿':`已导入 ${dataset.records.length} 条记录`}</p><button onClick={syncNow}><RefreshCw size={15}/><span>{dataset.meta.sourceMode==='personal-wps'?'同步个人 WPS':dataset.meta.sourceMode==='wps'?'立即同步':dataset.meta.sourceMode==='demo'?'连接数据源':'重新导入'}</span></button></div>
    </aside>
    <main>
      <header className="topbar"><div><p>工作记录</p>{view==='overview'&&<h1>{datasetDisplayYear(dataset)} 年工作回顾</h1>}</div><div className="top-actions">{datasets.length > 1 && <label className="dataset-switcher"><span>数据年度</span><select value={datasetId(dataset)} onChange={event => switchDataset(event.target.value)}>{sortDatasets(datasets).map(item => <option key={datasetId(item)} value={datasetId(item)}>{datasetLabel(item)}</option>)}</select></label>}<label className="search"><Search size={16}/><input aria-label="全局搜索" value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')navigateToView('timeline')}} placeholder="搜索事项、跟进或编号"/>{search&&<small>{searchMatchCount}</small>}</label><button className={`privacy-toggle${hideContent ? ' active' : ''}`} onClick={() => setHideContent(value => { if (!value) setSearch(''); return !value; })} title={hideContent ? '显示工作内容' : '隐藏工作内容'} aria-label={hideContent ? '显示工作内容' : '隐藏工作内容'}>{hideContent ? <Eye size={16}/> : <EyeOff size={16}/>}</button><div className="avatar">我</div></div></header>
      {dataset.meta.sourceMode==='demo'&&<div className="notice"><span>当前是示例数据。导入你的工作记录 Excel 后，会在当前浏览器中生成真实时间线和图片。</span><button onClick={()=>navigateToView('settings')}>前往数据与同步</button></div>}
      <div key={`${view}:${projectDetailId}`} className="view-host">
      {view==='overview'&&<OverviewView dataset={dataset} year={datasetDisplayYear(dataset)} selectedDate={selectedDate} onSelectDate={selectHeatmapDate} onOpenImage={openImage} onNavigate={name=>navigateToView(name as ViewName)} hideContent={hideContent}/>}
      {view==='timeline'&&<TimelineView dataset={search?{...dataset,records:dataset.records.filter(record=>[record.title,record.caseId,...record.steps.map(step=>step.text)].join(' ').toLowerCase().includes(search.toLowerCase()))}:dataset} onOpenImage={openImage} hideContent={hideContent}/>} 
      {view==='categories'&&<CategoriesView dataset={dataset}/>} 
      {view==='work-front'&&selectedProject&&<ProjectDetailView project={selectedProject} datasets={allDatasets} onBack={()=>setProjectDetailId('')} onOpenImage={openImage} onChangeLifecycle={updateCaseLifecycleAcrossProject} onAddRecords={addRecordsToProject} onRemoveRecord={removeRecordFromProject} hideContent={hideContent}/>}
      {view==='work-front'&&!selectedProject&&<WorkFrontView dataset={dataset} datasets={allDatasets} projects={longTermProjects} onOpenCase={()=>navigateToView('cases')} onOpenProject={setProjectDetailId} onChangeLifecycle={updateCaseLifecycleAcrossProject}/>}
      {view==='group-editor'&&<GroupEditorView dataset={dataset} datasets={datasets} onChange={applyDataset} onChangeGroups={updateCategoryGroups}/>}
      {view==='custom-association'&&<CustomAssociationView dataset={dataset} onChange={applyDataset}/>} 
      {view==='cases'&&<CasesView dataset={dataset} projects={longTermProjects} onAssignProject={assignCaseProject} onCreateProject={createCaseProject} onChange={applyDataset} onChangeLifecycle={updateCaseLifecycleAcrossProject} onMerge={mergeSelectedCases}/>}
      {view==='suggestions'&&<SuggestionsView suggestions={suggestions} onAccept={accept} onReject={reject}/>} 
      {view==='settings'&&<SettingsView dataset={dataset} datasets={datasets} onImport={()=>setImportOpen(true)} onUpdateDataset={updateStoredDataset} onDeleteDataset={removeStoredDataset} onClear={clear} onExportConfig={exportConfig} onImportConfig={importConfig} onConfigureWps={()=>setFirstRunOpen(true)} onPersonalImport={file => handlePersonalWpsImport(file, dataset.meta.sourceMode === 'personal-wps' && personalFileMatchesDataset(file, dataset) ? datasetId(dataset) : undefined)} onExportAiText={exportAiText} onCopyAiText={copyAiText} onExportPoster={()=>setPosterOpen(true)}/>}
      {view==='about'&&<AboutView/>}
      </div>
    </main>
    <ImportDialog open={importOpen} onClose={()=>setImportOpen(false)} onImported={handleImported}/>
    <PosterExportDialog open={posterOpen} dataset={dataset} defaultHideContent={hideContent} onClose={()=>setPosterOpen(false)} onSaved={notify}/>
    <FirstRunDialog open={firstRunOpen} onSkip={()=>setFirstRunOpen(false)} onContinue={()=>setFirstRunOpen(false)} onImport={()=>{ setFirstRunOpen(false); setImportOpen(true); }} onPersonalLogin={async () => { try { const result = await loginPersonalWps(); if (!result.authenticated) throw new Error(result.message || '个人 WPS 登录未完成'); setFirstRunOpen(false); navigateToView('settings'); notify('个人 WPS 已连接，请选择工作记录文件'); } catch (reason) { notify(reason instanceof Error ? reason.message : '个人 WPS 登录失败'); } }}/>
    {imagePreview&&<div className="image-lightbox" onMouseDown={event=>event.target===event.currentTarget&&setImagePreview(undefined)}><figure><button onClick={()=>setImagePreview(undefined)} aria-label="关闭"><X/></button><img src={imagePreview.url} alt={imagePreview.title}/><figcaption>{imagePreview.title}</figcaption></figure></div>}
    <div className={`toast${toast?' show':''}`} aria-live="polite">{toast}</div>
  </div>;
}

export default App;
