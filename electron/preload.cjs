// Keep the renderer isolated. WPS authorization and local data handling stay in
// the web app until the desktop OAuth callback is verified against WPS.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workReviewDesktop', {
  platform: process.platform,
  isDesktop: true,
  clearWpsSession: () => ipcRenderer.invoke('clear-wps-session'),
  personalWpsStatus: () => ipcRenderer.invoke('kdocs-status'),
  personalWpsLogin: () => ipcRenderer.invoke('kdocs-login'),
  personalWpsSearch: (keyword) => ipcRenderer.invoke('kdocs-search', keyword),
  personalWpsDownload: (file) => ipcRenderer.invoke('kdocs-download', file),
  savePoster: (payload) => ipcRenderer.invoke('save-poster', payload),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
