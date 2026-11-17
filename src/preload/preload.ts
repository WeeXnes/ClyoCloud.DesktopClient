import { contextBridge, ipcRenderer } from 'electron';
import { ClyoFile } from '../shared/types';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  refreshData: () => ipcRenderer.invoke('refresh-data'),
  loginWithPayload: (payloadStr: string, serverUrl?: string) => ipcRenderer.invoke('login-payload', { payloadStr, serverUrl }),
  loginWithCredentials: (u: string, p: string, serverUrl?: string) => ipcRenderer.invoke('login-credentials', { username: u, password: p, serverUrl }),
  verify2FA: (tempToken: string, code: string, username: string, serverUrl?: string) => ipcRenderer.invoke('verify-2fa', { tempToken, code, username, serverUrl }),
  logout: () => ipcRenderer.invoke('logout'),

  uploadFiles: (filePaths: string[], destination: string) => ipcRenderer.invoke('upload-files', { filePaths, destination }),
  uploadClipboard: (destination: string) => ipcRenderer.invoke('upload-clipboard', destination),

  fetchWallpapers: () => ipcRenderer.invoke('fetch-wallpapers'),
  fetchThumbnail: (remotePath: string) => ipcRenderer.invoke('fetch-thumbnail', remotePath),
  setDesktopWallpaper: (file: ClyoFile) => ipcRenderer.invoke('set-desktop-wallpaper', file),
  getWallpaperMode: () => ipcRenderer.invoke('get-wallpaper-mode'),
  addWallpaperToHydeTheme: (file: ClyoFile) => ipcRenderer.invoke('add-wallpaper-to-hyde-theme', file),

  syncAll: () => ipcRenderer.invoke('sync-all'),
  getSyncPairs: () => ipcRenderer.invoke('get-sync-pairs'),
  addSyncPair: (localPath: string, remotePath: string) => ipcRenderer.invoke('add-sync-pair', { localPath, remotePath }),
  removeSyncPair: (id: string) => ipcRenderer.invoke('remove-sync-pair', id),

  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke('set-launch-at-login', enabled),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openAppWindow: (pathOnServer?: string) => ipcRenderer.invoke('open-app-window', pathOnServer),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),

  // Event Listeners
  onSwitchTab: (callback: (tab: string) => void) => {
    const handler = (_: any, tab: string) => callback(tab);
    ipcRenderer.on('switch-tab', handler);
    return () => ipcRenderer.removeListener('switch-tab', handler);
  },
  onSyncStateChanged: (callback: (state: any) => void) => {
    const handler = (_: any, state: any) => callback(state);
    ipcRenderer.on('sync-state-changed', handler);
    return () => ipcRenderer.removeListener('sync-state-changed', handler);
  },
  onTransferUpdated: (callback: (transfer: any) => void) => {
    const handler = (_: any, transfer: any) => callback(transfer);
    ipcRenderer.on('transfer-updated', handler);
    return () => ipcRenderer.removeListener('transfer-updated', handler);
  },
  onDataRefreshed: (callback: (appState: any) => void) => {
    const handler = (_: any, appState: any) => callback(appState);
    ipcRenderer.on('data-refreshed', handler);
    return () => ipcRenderer.removeListener('data-refreshed', handler);
  },
  onClipboardUploaded: (callback: (result: any) => void) => {
    const handler = (_: any, result: any) => callback(result);
    ipcRenderer.on('clipboard-uploaded', handler);
    return () => ipcRenderer.removeListener('clipboard-uploaded', handler);
  }
});
