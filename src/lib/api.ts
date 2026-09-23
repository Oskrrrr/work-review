import type { WorkDataset } from '../types';

export const API_BASE_KEY = 'work-review-cloud-api-base';
export const WPS_CLIENT_CONFIG_KEY = 'work-review-wps-client-config';
export const WPS_AUTH_PENDING_KEY = 'work-review-wps-auth-pending';
export const PERSONAL_WPS_FILE_KEY = 'work-review-personal-wps-file';

export function getCloudApiBase() {
  try {
    const local = localStorage.getItem(API_BASE_KEY)?.trim();
    if (local) return local.replace(/\/$/, '');
  } catch { /* localStorage is unavailable during non-browser rendering */ }
  return import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '';
}

export function saveCloudApiBase(value: string) {
  const normalized = value.trim().replace(/\/$/, '');
  if (normalized) localStorage.setItem(API_BASE_KEY, normalized);
  else localStorage.removeItem(API_BASE_KEY);
  return normalized;
}

export function hasCloudApi() {
  return Boolean(getCloudApiBase());
}

export function getSavedWpsConfig() {
  try {
    const value = JSON.parse(localStorage.getItem(WPS_CLIENT_CONFIG_KEY) || '{}') as { appId?: string; appKey?: string };
    const appKey = value.appKey?.trim() || '';
    // 早期客户端容易把 CloudBase 地址误填进 App Key。不要再次把网址发送给 WPS，
    // 让用户重新填写真正的 App Key。
    return { appId: value.appId?.trim() || '', appKey: /^https?:\/\//i.test(appKey) ? '' : appKey };
  } catch {
    return { appId: '', appKey: '' };
  }
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${getCloudApiBase()}${path}`, { credentials: 'include', ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || `请求失败：${response.status}`);
  return response.json() as Promise<T>;
}

export async function getCloudDataset() {
  return request<WorkDataset>('/api/dataset');
}

export async function triggerCloudSync() {
  return request<{ status: string; imported: number }>('/api/sync', { method: 'POST' });
}

export async function saveCloudCases(dataset: WorkDataset) {
  return request<{ ok: boolean }>('/api/cases', { method: 'PUT', body: JSON.stringify({ cases: dataset.cases }) });
}

export type UserSettings = Pick<WorkDataset['meta'], 'categoryGroups' | 'customAssociations' | 'associationExclusions' | 'associationHistory'> & { cases: WorkDataset['cases'] };

export async function getCloudSettings() {
  return request<Partial<UserSettings>>('/api/settings');
}

export async function saveCloudSettings(settings: UserSettings) {
  return request<{ ok: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) });
}

export async function getCloudImageUrl(imageId: string) {
  return request<{ url: string }>(`/api/images/${encodeURIComponent(imageId)}`);
}

export async function getWpsAuthUrl(config = getSavedWpsConfig()) {
  const result = await request<{ url: string }>('/api/auth/wps/start', { headers: { 'x-wps-app-id': config.appId, 'x-wps-app-key': config.appKey } });
  // 标记一次未完成的授权。客户端下次启动时会据此清理 WPS 登录页遗留的会话。
  try { localStorage.setItem(WPS_AUTH_PENDING_KEY, String(Date.now())); } catch { /* localStorage unavailable */ }
  return result;
}

export interface CloudWpsFile { id: string; name: string; size?: number; modifiedAt?: string; type?: string; }

export async function searchCloudWpsFiles(keyword = '') {
  return request<{ files: CloudWpsFile[] }>(`/api/wps/files?keyword=${encodeURIComponent(keyword)}`);
}

export interface PersonalWpsFile extends CloudWpsFile { driveId?: string; parentId?: string; }

export function hasPersonalWps() {
  return Boolean(window.workReviewDesktop?.personalWpsStatus);
}

export async function getPersonalWpsStatus() {
  if (!window.workReviewDesktop?.personalWpsStatus) return { available: false, authenticated: false, message: '个人 WPS 组件仅支持桌面客户端。' };
  return window.workReviewDesktop.personalWpsStatus();
}

export async function loginPersonalWps() {
  if (!window.workReviewDesktop?.personalWpsLogin) throw new Error('个人 WPS 登录仅支持桌面客户端。');
  return window.workReviewDesktop.personalWpsLogin();
}

export async function searchPersonalWpsFiles(keyword = '') {
  if (!window.workReviewDesktop?.personalWpsSearch) throw new Error('个人 WPS 文件搜索仅支持桌面客户端。');
  return window.workReviewDesktop.personalWpsSearch(keyword);
}

export async function downloadPersonalWpsFile(file: PersonalWpsFile) {
  if (!window.workReviewDesktop?.personalWpsDownload) throw new Error('个人 WPS 文件下载仅支持桌面客户端。');
  return window.workReviewDesktop.personalWpsDownload(file);
}
