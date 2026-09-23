const { app, BrowserWindow, shell, session, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const { promisify } = require('node:util');
const path = require('node:path');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const WPS_COOKIE_DOMAINS = ['kdocs.cn', 'wps.cn'];
let mainWindow;
let wpsAuthInProgress = false;
const execFileAsync = promisify(execFile);

function findKdocsCli() {
  const candidates = [
    process.env.KDOCS_CLI_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'kdocs-cli', 'kdocs-cli.exe'),
    path.join(app.getPath('userData'), 'kdocs-cli.exe'),
    path.join(process.resourcesPath || '', 'vendor', 'kdocs-cli', 'kdocs-cli.exe'),
    path.join(__dirname, '..', 'vendor', 'kdocs-cli', 'kdocs-cli.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function parseKdocsOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new Error(text.slice(-500));
  }
}

async function runKdocs(args, options = {}) {
  const executable = findKdocsCli();
  if (!executable) throw new Error('未找到个人 WPS 组件 kdocs-cli，请先安装官方个人云文档组件。');
  try {
    const result = await execFileAsync(executable, [...args, '--output', 'json'], {
      windowsHide: true,
      timeout: options.timeout || 120000,
      maxBuffer: 32 * 1024 * 1024
    });
    return parseKdocsOutput(result.stdout);
  } catch (error) {
    const message = String(error?.stderr || error?.stdout || error?.message || '个人 WPS 请求失败').trim();
    throw new Error(message.replace(/^Error:\s*/i, '').slice(-800));
  }
}

function kdocsData(result) {
  return result?.data ?? result;
}

function flattenKdocsFiles(value) {
  let data = kdocsData(value);
  // kdocs-cli wraps the API response as { data: { code, data: { items } } }.
  // The actual file metadata is then nested under each item's `file` field.
  if (data?.data && !Array.isArray(data.items) && !Array.isArray(data.files) && !Array.isArray(data.list)) data = data.data;
  const items = Array.isArray(data) ? data : (data?.items || data?.files || data?.list || []);
  return items.filter(Boolean).map(entry => {
    const item = entry?.file || entry;
    return {
    id: String(item.file_id || item.fileId || item.id || ''),
    driveId: item.drive_id || item.driveId ? String(item.drive_id || item.driveId) : undefined,
    parentId: item.parent_id || item.parentId ? String(item.parent_id || item.parentId) : undefined,
    name: item.name || item.file_name || item.fileName || '未命名文件',
    size: Number(item.size || item.file_size || item.fileSize || 0) || undefined,
    modifiedAt: item.modify_time ? new Date(Number(item.modify_time) * 1000).toISOString() : (item.mtime || item.update_time || item.updateTime),
    type: item.file_type || item.type || 'file'
    };
  }).filter(item => item.id);
}

async function kdocsStatus() {
  if (!findKdocsCli()) return { available: false, authenticated: false, message: '未安装个人 WPS 组件' };
  try { return { available: true, ...kdocsData(await runKdocs(['auth', 'status'])) }; }
  catch (error) { return { available: true, authenticated: false, message: error.message }; }
}

async function kdocsLogin() {
  const executable = findKdocsCli();
  if (!executable) throw new Error('未找到个人 WPS 组件 kdocs-cli，请先安装官方个人云文档组件。');
  await execFileAsync(executable, ['auth', 'login'], { windowsHide: false, timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
  return kdocsStatus();
}

async function kdocsSearch(_event, keyword = '') {
  const params = {
    keyword: String(keyword || ''),
    type: 'all',
    file_type: 'file',
    page_size: 100,
    order: 'desc',
    order_by: 'mtime',
    scope: ['personal_drive']
  };
  const result = await runKdocs(['drive', 'search-files', '--args', JSON.stringify(params)]);
  return { files: flattenKdocsFiles(result) };
}

function findDownloadUrl(value) {
  if (!value || typeof value !== 'object') return '';
  for (const key of ['url', 'download_url', 'downloadUrl', 'link_url', 'linkUrl']) {
    if (typeof value[key] === 'string' && /^https?:\/\//i.test(value[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findDownloadUrl(child);
    if (found) return found;
  }
  return '';
}

async function kdocsDownload(_event, file) {
  if (!file?.id) throw new Error('未选择个人 WPS 文件。');
  // The default storage host returned by kdocs-cli is a bare object URL and
  // responds with 403 when fetched outside the browser. Request the WPS365
  // compatible signed URL so the desktop client can download it directly.
  const params = {
    file_id: String(file.id),
    storage_base_domain: 'wps365.com',
    ...(file.driveId ? { drive_id: String(file.driveId) } : {})
  };
  const result = await runKdocs(['drive', 'download-file', '--args', JSON.stringify(params)]);
  const url = findDownloadUrl(result);
  if (!url) throw new Error('个人 WPS 未返回文件下载地址。');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`个人 WPS 文件下载失败：${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { name: file.name || '工作记录.xlsx', bytes };
}

ipcMain.handle('kdocs-status', kdocsStatus);
ipcMain.handle('kdocs-login', kdocsLogin);
ipcMain.handle('kdocs-search', kdocsSearch);
ipcMain.handle('kdocs-download', kdocsDownload);
function safePosterFileName(value) {
  const normalized = String(value || '工作脉络-年度总结海报.png').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return normalized.toLowerCase().endsWith('.png') ? normalized : `${normalized}.png`;
}

async function savePoster(_event, payload) {
  const dataUrl = String(payload?.dataUrl || '');
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('海报图片数据无效。');
  const fileName = safePosterFileName(payload?.fileName);
  const roots = [];
  if (!app.isPackaged) roots.push(path.join(app.getAppPath(), '工作脉络海报'));
  try { roots.push(path.join(path.dirname(app.getPath('exe')), '工作脉络海报')); } catch { /* app path unavailable during startup */ }
  roots.push(path.join(app.getPath('documents'), '工作脉络海报'));
  const buffer = Buffer.from(match[1], 'base64');
  for (const directory of roots) {
    try {
      await fs.promises.mkdir(directory, { recursive: true });
      const target = path.join(directory, fileName);
      await fs.promises.writeFile(target, buffer);
      return { path: target, directory, fileName };
    } catch { /* try the next writable location */ }
  }
  throw new Error('无法创建海报文件夹，请检查应用目录或用户文档目录的写入权限。');
}

ipcMain.handle('save-poster', savePoster);
ipcMain.handle('open-external', (_event, url) => {
  if (/^https:\/\/(github\.com|open\.wps\.cn)(\/|$)/i.test(String(url))) return shell.openExternal(String(url));
  throw new Error('不允许打开此外部地址。');
});

function isWpsCookie(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  return WPS_COOKIE_DOMAINS.some(base => domain === base || domain.endsWith(`.${base}`));
}

async function clearWpsSession() {
  const defaultSession = session.defaultSession;
  const cookies = await defaultSession.cookies.get({});
  const wpsCookies = cookies.filter(isWpsCookie);
  await Promise.all(wpsCookies.map(cookie => {
    const protocol = cookie.secure ? 'https://' : 'http://';
    const domain = String(cookie.domain || '').replace(/^\./, '');
    const url = `${protocol}${domain}${cookie.path || '/'}`;
    return defaultSession.cookies.remove(url, cookie.name).catch(() => undefined);
  }));
  // 清理网页缓存以避免重新打开时复用卡住的授权页面，但不清理
  // localStorage、IndexedDB 或应用自己的工作记录。
  await defaultSession.clearCache().catch(() => undefined);
  await defaultSession.clearAuthCache().catch(() => undefined);
  return { removed: wpsCookies.length };
}

ipcMain.handle('clear-wps-session', clearWpsSession);

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: '#f3f6f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const returnToApp = () => {
    if (!wpsAuthInProgress) return;
    wpsAuthInProgress = false;
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  };
  const isWpsPage = url => /(^|\.)wps\.cn|(^|\.)kdocs\.cn/i.test(String(url));
  const isCloudBaseRoot = url => {
    try {
      const parsed = new URL(url);
      return /(^|\.)tcloudbase\.com$/i.test(parsed.hostname) && (parsed.pathname === '/' || parsed.pathname === '');
    } catch { return false; }
  };
  // The OAuth callback is handled inside the Electron session. Depending on
  // the Chromium/Electron version, the callback's final 302 can surface as
  // will-redirect or will-navigate. Track the OAuth navigation and intercept
  // every CloudBase root navigation so it can never show the gateway 404 page.
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (isWpsPage(targetUrl)) wpsAuthInProgress = true;
    if (wpsAuthInProgress && isCloudBaseRoot(targetUrl)) { event.preventDefault(); returnToApp(); }
  });
  window.webContents.on('will-redirect', (event, targetUrl) => {
    const currentUrl = window.webContents.getURL();
    if (isWpsPage(targetUrl) || currentUrl.includes('/worklog-api/api/auth/wps/callback')) wpsAuthInProgress = true;
    if (wpsAuthInProgress && isCloudBaseRoot(targetUrl)) { event.preventDefault(); returnToApp(); }
  });
  window.webContents.on('did-navigate', (_event, targetUrl) => {
    if (wpsAuthInProgress && isCloudBaseRoot(targetUrl)) returnToApp();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow = window;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
