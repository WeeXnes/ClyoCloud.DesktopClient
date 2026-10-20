import path from 'path';
import fs from 'fs';
import { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell } from 'electron';
import { SettingsManager } from './storage/settings';
import { SecureStore } from './storage/secureStore';
import { ClyoAPIClient } from './api/clyoApi';
import { SyncEngine } from './sync/syncEngine';
import { WallpaperManager } from './platform/wallpaper';
import { AutostartManager } from './platform/autostart';
import { ClipboardUploader } from './clipboard/uploader';
import { TrayManager } from './tray';
import { getDeviceModelString } from './platform/device';
import { AppStateData, ClyoFile, TransferItem } from '../shared/types';

// Support self-signed or internal SSL certificates for self-hosted ClyoCloud instances
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
app.commandLine.appendSwitch('ignore-certificate-errors');

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let recentTransfers: TransferItem[] = [];
let remoteFoldersCache: string[] = ['/'];
let serverStatsCache: any = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 490,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const htmlPath = path.join(__dirname, '../renderer/index.html');
  win.loadFile(htmlPath);

  // Auto-hide when focus is lost (like macOS NSPopover)
  win.on('blur', () => {
    // Avoid hiding immediately if dialog is open
    if (!win.webContents.isDevToolsOpened()) {
      win.hide();
    }
  });

  return win;
}

app.whenReady().then(async () => {
  // Prevent dock icon on macOS or standalone taskbar item
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  mainWindow = createWindow();
  TrayManager.getInstance().setup(mainWindow);

  // Setup global hotkey (Ctrl + Alt + U or Cmd + Alt + U)
  try {
    globalShortcut.register('CommandOrControl+Alt+U', async () => {
      const result = await ClipboardUploader.getInstance().uploadClipboardImage();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clipboard-uploaded', result);
        await refreshData();
      }
    });
  } catch (err) {
    console.error('Failed to register global shortcut:', err);
  }

  // Check existing auth
  const username = SettingsManager.getInstance().getUsername();
  if (username) {
    const token = SecureStore.getInstance().readToken(username);
    if (token) {
      SyncEngine.getInstance().start();
      refreshData().catch(console.error);
    }
  }

  // Register Sync listener to push status updates
  SyncEngine.getInstance().addStateListener(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-state-changed', {
        isSyncing: SyncEngine.getInstance().isSyncing,
        statusMessage: SyncEngine.getInstance().statusMessage,
        lastSyncDate: SyncEngine.getInstance().lastSyncDate
      });
    }
  });

  setupIpcHandlers();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  SyncEngine.getInstance().stop();
});

async function refreshData(): Promise<void> {
  const username = SettingsManager.getInstance().getUsername();
  const token = username ? SecureStore.getInstance().readToken(username) : null;
  if (!token) return;

  try {
    const [stats, files] = await Promise.all([
      ClyoAPIClient.getInstance().fetchStats().catch(() => null),
      ClyoAPIClient.getInstance().fetchFiles('').catch(() => null)
    ]);

    if (stats) {
      serverStatsCache = stats;
    }
    if (files) {
      const folders = files.filter(f => f.isFolder).map(f => f.name);
      remoteFoldersCache = ['/', ...folders];
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('data-refreshed', getAppState());
    }
  } catch (e) {
    console.warn('Failed to refresh data:', e);
  }
}

function getAppState(): AppStateData {
  const settings = SettingsManager.getInstance();
  const username = settings.getUsername();
  const token = username ? SecureStore.getInstance().readToken(username) : null;

  return {
    isAuthenticated: !!token,
    currentUser: username,
    serverUrl: settings.getServerUrl(),
    selectedTab: 'Upload',
    serverStats: serverStatsCache,
    recentTransfers,
    isRefreshing: false,
    remoteFolders: remoteFoldersCache,
    syncStatusMessage: SyncEngine.getInstance().statusMessage,
    isSyncing: SyncEngine.getInstance().isSyncing,
    launchAtLogin: AutostartManager.getInstance().isLaunchAtLogin(),
    deviceModel: getDeviceModelString()
  };
}

function setupIpcHandlers(): void {
  ipcMain.handle('get-app-state', () => getAppState());

  ipcMain.handle('refresh-data', async () => {
    await refreshData();
    return getAppState();
  });

  ipcMain.handle('login-payload', async (_, args: string | { payloadStr: string; serverUrl?: string }) => {
    const payloadStr = typeof args === 'string' ? args : args.payloadStr;
    const explicitServerUrl = typeof args === 'object' && args.serverUrl ? args.serverUrl.trim() : '';
    const trimmed = (payloadStr || '').trim();
    let serverUrl = explicitServerUrl;
    let username = '';
    let token = '';

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.serverUrl) serverUrl = parsed.serverUrl;
      username = parsed.username || '';
      token = parsed.token || '';
    } catch {
      // Raw token check (JWT)
      if (trimmed.includes('.')) {
        username = SettingsManager.getInstance().getUsername() || 'desktop_user';
        token = trimmed;
        if (!serverUrl) {
          serverUrl = SettingsManager.getInstance().getServerUrl();
        }
      } else {
        return { success: false, message: 'Invalid QR payload or token format' };
      }
    }

    if (serverUrl) {
      SettingsManager.getInstance().setServerUrl(serverUrl);
    }
    SettingsManager.getInstance().setUsername(username);
    SecureStore.getInstance().saveToken(username, token);

    SyncEngine.getInstance().start();
    await refreshData();
    return { success: true, message: `Connected to ${SettingsManager.getInstance().getServerUrl()}!` };
  });

  ipcMain.handle('login-credentials', async (_, { username, password, serverUrl }) => {
    try {
      if (serverUrl && typeof serverUrl === 'string' && serverUrl.trim()) {
        SettingsManager.getInstance().setServerUrl(serverUrl.trim());
      }
      const res = await ClyoAPIClient.getInstance().login(username, password);
      if (res.requires2fa) {
        return { success: false, requires2fa: true, tempToken: res.tempToken, message: '2FA code required' };
      }
      if (res.token) {
        SettingsManager.getInstance().setUsername(username);
        SecureStore.getInstance().saveToken(username, res.token);
        SyncEngine.getInstance().start();
        await refreshData();
        return { success: true, message: 'Logged in successfully!' };
      }
      return { success: false, message: 'Login failed' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Login error' };
    }
  });

  ipcMain.handle('verify-2fa', async (_, { tempToken, code, username, serverUrl }) => {
    try {
      if (serverUrl && typeof serverUrl === 'string' && serverUrl.trim()) {
        SettingsManager.getInstance().setServerUrl(serverUrl.trim());
      }
      const token = await ClyoAPIClient.getInstance().verify2FA(tempToken, code);
      SettingsManager.getInstance().setUsername(username);
      SecureStore.getInstance().saveToken(username, token);
      SyncEngine.getInstance().start();
      await refreshData();
      return { success: true, message: 'Verified and logged in!' };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Verification error' };
    }
  });

  ipcMain.handle('logout', () => {
    const username = SettingsManager.getInstance().getUsername();
    if (username) {
      SecureStore.getInstance().deleteToken(username);
    }
    SettingsManager.getInstance().setUsername('');
    SyncEngine.getInstance().stop();
    serverStatsCache = null;
    recentTransfers = [];
    return getAppState();
  });

  ipcMain.handle('upload-files', async (_, { filePaths, destination }) => {
    const dest = destination === '/' ? '' : destination;
    for (const filePath of filePaths) {
      const name = path.basename(filePath);
      const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const item: TransferItem = {
        id: transferId,
        name,
        size,
        progress: 0.1,
        type: 'upload',
        status: { state: 'inProgress', progress: 0.1 },
        date: Date.now()
      };
      recentTransfers.unshift(item);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transfer-updated', item);
      }

      try {
        await ClyoAPIClient.getInstance().uploadFiles([filePath], dest);
        item.progress = 1.0;
        item.status = { state: 'completed' };
      } catch (e: any) {
        item.status = { state: 'failed', error: e?.message || 'Upload error' };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transfer-updated', item);
      }
    }

    await refreshData();
    return recentTransfers;
  });

  ipcMain.handle('upload-clipboard', async (_, destination) => {
    const dest = destination === '/' ? '' : destination;
    const res = await ClipboardUploader.getInstance().uploadClipboardImage(dest);
    await refreshData();
    return res;
  });

  ipcMain.handle('fetch-wallpapers', async () => {
    try {
      return await ClyoAPIClient.getInstance().fetchWallpapers();
    } catch (e: any) {
      throw new Error(e?.message || 'Failed to fetch wallpapers');
    }
  });

  ipcMain.handle('fetch-thumbnail', async (_, remotePath: string) => {
    return await ClyoAPIClient.getInstance().fetchThumbnailDataUrl(remotePath);
  });

  ipcMain.handle('set-desktop-wallpaper', async (_, file: ClyoFile) => {
    return await WallpaperManager.getInstance().setAsDesktopWallpaper(file);
  });

  ipcMain.handle('sync-all', async () => {
    await SyncEngine.getInstance().syncAll();
    return {
      statusMessage: SyncEngine.getInstance().statusMessage,
      lastSyncDate: SyncEngine.getInstance().lastSyncDate
    };
  });

  ipcMain.handle('get-sync-pairs', () => {
    return SettingsManager.getInstance().getSyncFolderPairs();
  });

  ipcMain.handle('add-sync-pair', (_, { localPath, remotePath }) => {
    const pair = SettingsManager.getInstance().addSyncPair(localPath, remotePath);
    SyncEngine.getInstance().restartWatcher();
    SyncEngine.getInstance().syncAll().catch(console.error);
    return pair;
  });

  ipcMain.handle('remove-sync-pair', (_, id: string) => {
    SettingsManager.getInstance().removeSyncPair(id);
    SyncEngine.getInstance().restartWatcher();
    return SettingsManager.getInstance().getSyncFolderPairs();
  });

  ipcMain.handle('set-launch-at-login', (_, enabled: boolean) => {
    SettingsManager.getInstance().setLaunchAtLogin(enabled);
    AutostartManager.getInstance().setLaunchAtLogin(enabled);
    return enabled;
  });

  ipcMain.handle('open-directory-dialog', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('open-file-dialog', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('open-external', (_, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle('quit-app', () => {
    app.quit();
  });

  ipcMain.handle('hide-window', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    }
  });
}
