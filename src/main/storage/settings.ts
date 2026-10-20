import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppSettings, SyncFolderPair } from '../../shared/types';
import { getDeviceModelString } from '../platform/device';

export class SettingsManager {
  private static instance: SettingsManager;
  private settingsFile: string;
  private settings: AppSettings;

  private constructor() {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) {
      fs.mkdirSync(userData, { recursive: true });
    }
    this.settingsFile = path.join(userData, 'settings.json');
    this.settings = this.loadSettings();
  }

  public static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  private loadSettings(): AppSettings {
    const defaultSettings: AppSettings = {
      serverUrl: 'http://localhost:6969',
      username: '',
      defaultUploadPath: '',
      launchAtLogin: false,
      syncFolderPairs: [],
      deviceModel: getDeviceModelString()
    };

    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = fs.readFileSync(this.settingsFile, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          ...defaultSettings,
          ...parsed,
          deviceModel: getDeviceModelString()
        };
      }
    } catch (e) {
      console.error('Failed to parse settings.json, reverting to defaults:', e);
    }
    return defaultSettings;
  }

  public save(): void {
    try {
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save settings.json:', e);
    }
  }

  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  public getServerUrl(): string {
    return this.settings.serverUrl.trim();
  }

  public setServerUrl(url: string): void {
    this.settings.serverUrl = url.trim();
    this.save();
  }

  public getUsername(): string {
    return this.settings.username;
  }

  public setUsername(username: string): void {
    this.settings.username = username.trim();
    this.save();
  }

  public getDefaultUploadPath(): string {
    return this.settings.defaultUploadPath;
  }

  public setDefaultUploadPath(path: string): void {
    this.settings.defaultUploadPath = path;
    this.save();
  }

  public isLaunchAtLogin(): boolean {
    return this.settings.launchAtLogin;
  }

  public setLaunchAtLogin(enabled: boolean): void {
    this.settings.launchAtLogin = enabled;
    this.save();
  }

  public getSyncFolderPairs(): SyncFolderPair[] {
    return [...this.settings.syncFolderPairs];
  }

  public addSyncPair(localPath: string, remotePath: string): SyncFolderPair {
    const newPair: SyncFolderPair = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      localPath,
      remotePath,
      isEnabled: true,
      lastSyncTime: undefined,
      statusDescription: 'Ready'
    };
    this.settings.syncFolderPairs.push(newPair);
    this.save();
    return newPair;
  }

  public removeSyncPair(id: string): void {
    this.settings.syncFolderPairs = this.settings.syncFolderPairs.filter(p => p.id !== id);
    this.save();
  }

  public updateSyncPair(pair: SyncFolderPair): void {
    const idx = this.settings.syncFolderPairs.findIndex(p => p.id === pair.id);
    if (idx !== -1) {
      this.settings.syncFolderPairs[idx] = pair;
      this.save();
    }
  }
}
