import fs from 'fs';
import path from 'path';
import { SyncFolderPair, SyncManifestItem, ClyoFile } from '../../shared/types';
import { SettingsManager } from '../storage/settings';
import { ClyoAPIClient } from '../api/clyoApi';
import { SyncManifestManager } from './manifest';
import { FolderWatcher } from './watcher';

export class SyncEngine {
  private static instance: SyncEngine;

  public isSyncing: boolean = false;
  public lastSyncDate: number | null = null;
  public statusMessage: string = 'All folders up to date';

  private watcher: FolderWatcher | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  private onStateChangeListeners: Array<() => void> = [];

  private ignoredFiles = new Set([
    '.DS_Store',
    '.localized',
    '.cloudinfo',
    'Thumbs.db',
    'desktop.ini'
  ]);

  private constructor() {
    this.watcher = new FolderWatcher(() => {
      this.syncAll().catch(err => console.error('Auto sync error:', err));
    });
  }

  public static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine();
    }
    return SyncEngine.instance;
  }

  public addStateListener(listener: () => void): () => void {
    this.onStateChangeListeners.push(listener);
    return () => {
      this.onStateChangeListeners = this.onStateChangeListeners.filter(l => l !== listener);
    };
  }

  private notifyState(): void {
    for (const listener of this.onStateChangeListeners) {
      try {
        listener();
      } catch (e) {
        console.error('Error in sync state listener:', e);
      }
    }
  }

  public start(): void {
    this.restartWatcher();
    this.startPeriodicTimer();
  }

  public stop(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.watcher) {
      this.watcher.stop();
    }
  }

  public restartWatcher(): void {
    if (!this.watcher) return;
    const paths = SettingsManager.getInstance()
      .getSyncFolderPairs()
      .filter(p => p.isEnabled)
      .map(p => p.localPath)
      .filter(p => fs.existsSync(p));

    this.watcher.watchPaths(paths);
  }

  private startPeriodicTimer(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
    }
    // Poll for remote changes every 60 seconds
    this.periodicTimer = setInterval(() => {
      this.syncAll().catch(e => console.error('Periodic sync error:', e));
    }, 60000);
  }

  public async syncAll(): Promise<void> {
    if (this.isSyncing) return;

    const pairs = SettingsManager.getInstance().getSyncFolderPairs().filter(p => p.isEnabled);
    if (pairs.length === 0) {
      this.statusMessage = 'No synced folders configured';
      this.notifyState();
      return;
    }

    this.isSyncing = true;
    this.statusMessage = 'Syncing folders...';
    this.notifyState();

    try {
      for (const pair of pairs) {
        await this.syncPair(pair);
      }
      this.lastSyncDate = Date.now();
      this.statusMessage = 'All folders up to date';
    } catch (e: any) {
      console.error('Error in syncAll:', e);
      this.statusMessage = `Sync error: ${e?.message || e}`;
    } finally {
      this.isSyncing = false;
      this.notifyState();
    }
  }

  private async syncPair(pair: SyncFolderPair): Promise<void> {
    if (!fs.existsSync(pair.localPath)) {
      const updated = { ...pair, statusDescription: 'Local folder not found' };
      SettingsManager.getInstance().updateSyncPair(updated);
      return;
    }

    const currentPair = { ...pair, statusDescription: 'Syncing...' };
    SettingsManager.getInstance().updateSyncPair(currentPair);

    try {
      const manifest = SyncManifestManager.getInstance().loadManifest(pair.id);

      // 1. Fetch remote files (recursively)
      const remoteDict = await this.scanRemoteFiles(pair.remotePath);

      // 2. Scan local files (recursively)
      const localDict = this.scanLocalFiles(pair.localPath);

      // 3. Phase 1: Local Rename Detection
      const missingLocalNames = Object.keys(manifest.items).filter(
        name => !localDict[name] && !!remoteDict[name]
      );
      const newLocalNames = Object.keys(localDict).filter(
        name => !manifest.items[name] && !remoteDict[name]
      );

      for (const oldName of missingLocalNames) {
        const oldManifestItem = manifest.items[oldName];
        if (!oldManifestItem) continue;

        const matchingNewName = newLocalNames.find(
          newName => localDict[newName]?.size === oldManifestItem.size
        );

        if (matchingNewName) {
          const oldRemotePath = this.getFullRemoteFilePath(pair.remotePath, oldName);
          const newFileName = path.basename(matchingNewName);
          try {
            await ClyoAPIClient.getInstance().renameFile(oldRemotePath, newFileName);
            delete manifest.items[oldName];

            const localInfo = localDict[matchingNewName];
            if (localInfo) {
              manifest.items[matchingNewName] = {
                size: localInfo.size,
                localMtime: localInfo.mtime,
                remoteMtime: Date.now() / 1000
              };
            }

            const oldRemote = remoteDict[oldName];
            delete remoteDict[oldName];
            if (oldRemote) {
              remoteDict[matchingNewName] = {
                ...oldRemote,
                name: matchingNewName,
                lastModified: Date.now()
              };
            }
          } catch (e) {
            console.warn('Rename optimization failed, will fallback to delete/upload:', e);
          }
        }
      }

      // 4. Phase 2: 3-Way Reconciliation
      const allNames = new Set([
        ...Object.keys(localDict),
        ...Object.keys(remoteDict),
        ...Object.keys(manifest.items)
      ]);

      for (const name of allNames) {
        if (!this.shouldSyncItem(name)) continue;

        const local = localDict[name];
        const remote = remoteDict[name];
        const last = manifest.items[name];
        const remoteFolderPath = this.getRemoteFolderPath(pair.remotePath, name);
        const remoteFullPath = this.getFullRemoteFilePath(pair.remotePath, name);
        const itemLocalPath = path.join(pair.localPath, ...name.split('/'));

        if (local && remote && last) {
          // Scenario A: Exists in Local, Remote, and Manifest
          const localChanged = Math.abs(local.mtime - last.localMtime) > 2.0 || local.size !== last.size;
          const remoteTimeSec = remote.lastModified / 1000;
          const remoteChanged = Math.abs(remoteTimeSec - last.remoteMtime) > 2.0 || remote.size !== last.size;

          if (localChanged && !remoteChanged) {
            // Local modified -> Upload
            await ClyoAPIClient.getInstance().uploadFiles([local.fullPath], remoteFolderPath);
            manifest.items[name] = {
              size: local.size,
              localMtime: local.mtime,
              remoteMtime: Date.now() / 1000
            };
          } else if (remoteChanged && !localChanged) {
            // Remote modified -> Download
            await ClyoAPIClient.getInstance().downloadFile(remoteFullPath, local.fullPath);
            const stat = fs.statSync(local.fullPath);
            manifest.items[name] = {
              size: remote.size,
              localMtime: stat.mtimeMs / 1000,
              remoteMtime: remoteTimeSec
            };
          } else if (localChanged && remoteChanged) {
            // Conflict! Preserve local file, download remote file
            const ext = path.extname(name);
            const base = path.basename(name, ext);
            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, '0');
            const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            const conflictRelName = path.posix.join(
              path.posix.dirname(name) === '.' ? '' : path.posix.dirname(name),
              `${base} (Conflict ${stamp})${ext}`
            );
            const conflictLocalPath = path.join(pair.localPath, ...conflictRelName.split('/'));

            try {
              fs.renameSync(local.fullPath, conflictLocalPath);
              await ClyoAPIClient.getInstance().downloadFile(remoteFullPath, local.fullPath);

              const stat = fs.statSync(local.fullPath);
              manifest.items[name] = {
                size: remote.size,
                localMtime: stat.mtimeMs / 1000,
                remoteMtime: remoteTimeSec
              };

              const conflictStat = fs.statSync(conflictLocalPath);
              manifest.items[conflictRelName] = {
                size: conflictStat.size,
                localMtime: conflictStat.mtimeMs / 1000,
                remoteMtime: 0
              };
            } catch (err) {
              console.error('Conflict resolution error:', err);
            }
          }

        } else if (local && last && !remote) {
          // Scenario B: In Local and Manifest, but REMOVED on Remote
          const localChanged = Math.abs(local.mtime - last.localMtime) > 2.0 || local.size !== last.size;
          if (!localChanged) {
            // Deleted on remote -> delete locally
            try {
              fs.unlinkSync(local.fullPath);
            } catch {}
            delete manifest.items[name];
          } else {
            // Locally modified while remotely deleted -> re-upload to remote
            await ClyoAPIClient.getInstance().uploadFiles([local.fullPath], remoteFolderPath);
            manifest.items[name] = {
              size: local.size,
              localMtime: local.mtime,
              remoteMtime: Date.now() / 1000
            };
          }

        } else if (remote && last && !local) {
          // Scenario C: In Remote and Manifest, but DELETED on Local
          const remoteTimeSec = remote.lastModified / 1000;
          const remoteChanged = Math.abs(remoteTimeSec - last.remoteMtime) > 2.0 || remote.size !== last.size;
          if (!remoteChanged) {
            // Deleted on local -> delete remotely
            await ClyoAPIClient.getInstance().deleteFile(remoteFullPath);
            delete manifest.items[name];
          } else {
            // Remotely modified while locally deleted -> re-download
            await ClyoAPIClient.getInstance().downloadFile(remoteFullPath, itemLocalPath);
            const stat = fs.statSync(itemLocalPath);
            manifest.items[name] = {
              size: remote.size,
              localMtime: stat.mtimeMs / 1000,
              remoteMtime: remoteTimeSec
            };
          }

        } else if (!local && !remote && last) {
          // Scenario D: Gone from both
          delete manifest.items[name];

        } else if (local && remote && !last) {
          // Scenario E: In Local and Remote, but not in manifest (First time merge)
          const remoteTimeSec = remote.lastModified / 1000;
          const timeDiff = local.mtime - remoteTimeSec;
          if (timeDiff > 3.0 && local.size !== remote.size) {
            // Local is newer -> Upload
            await ClyoAPIClient.getInstance().uploadFiles([local.fullPath], remoteFolderPath);
            manifest.items[name] = {
              size: local.size,
              localMtime: local.mtime,
              remoteMtime: Date.now() / 1000
            };
          } else if (timeDiff < -3.0 && local.size !== remote.size) {
            // Remote is newer -> Download
            await ClyoAPIClient.getInstance().downloadFile(remoteFullPath, local.fullPath);
            const stat = fs.statSync(local.fullPath);
            manifest.items[name] = {
              size: remote.size,
              localMtime: stat.mtimeMs / 1000,
              remoteMtime: remoteTimeSec
            };
          } else {
            // Identical / compatible -> adopt
            manifest.items[name] = {
              size: local.size,
              localMtime: local.mtime,
              remoteMtime: remoteTimeSec
            };
          }

        } else if (local && !remote && !last) {
          // Scenario F: Brand new local file
          await ClyoAPIClient.getInstance().uploadFiles([local.fullPath], remoteFolderPath);
          manifest.items[name] = {
            size: local.size,
            localMtime: local.mtime,
            remoteMtime: Date.now() / 1000
          };

        } else if (remote && !local && !last) {
          // Scenario G: Brand new remote file
          await ClyoAPIClient.getInstance().downloadFile(remoteFullPath, itemLocalPath);
          const stat = fs.statSync(itemLocalPath);
          manifest.items[name] = {
            size: remote.size,
            localMtime: stat.mtimeMs / 1000,
            remoteMtime: remote.lastModified / 1000
          };
        }
      }

      // Save updated manifest
      SyncManifestManager.getInstance().saveManifest(pair.id, manifest);

      const inSyncPair: SyncFolderPair = {
        ...pair,
        lastSyncTime: Date.now(),
        statusDescription: 'In Sync'
      };
      SettingsManager.getInstance().updateSyncPair(inSyncPair);

    } catch (e: any) {
      console.error(`Sync error on pair ${pair.localPath}:`, e);
      const errPair: SyncFolderPair = {
        ...pair,
        statusDescription: `Sync error: ${e?.message || e}`
      };
      SettingsManager.getInstance().updateSyncPair(errPair);
    }
  }

  // MARK: - Recursive Scanners

  private scanLocalFiles(rootDir: string): Record<string, { fullPath: string; size: number; mtime: number }> {
    const results: Record<string, { fullPath: string; size: number; mtime: number }> = {};

    const scanDir = (currentDir: string, relativePrefix: string) => {
      const items = fs.readdirSync(currentDir);
      for (const item of items) {
        if (!this.shouldSyncItem(item)) continue;
        const itemFullPath = path.join(currentDir, item);
        const relPath = relativePrefix ? `${relativePrefix}/${item}` : item;

        try {
          const stat = fs.statSync(itemFullPath);
          if (stat.isDirectory()) {
            scanDir(itemFullPath, relPath);
          } else if (stat.isFile()) {
            results[relPath] = {
              fullPath: itemFullPath,
              size: stat.size,
              mtime: stat.mtimeMs / 1000
            };
          }
        } catch (e) {
          console.warn('Failed to stat file:', itemFullPath, e);
        }
      }
    };

    scanDir(rootDir, '');
    return results;
  }

  private async scanRemoteFiles(basePath: string): Promise<Record<string, ClyoFile>> {
    const results: Record<string, ClyoFile> = {};

    const scanRemoteDir = async (currentPath: string, relativePrefix: string) => {
      const files = await ClyoAPIClient.getInstance().fetchFiles(currentPath);
      for (const file of files) {
        if (!this.shouldSyncItem(file.name)) continue;
        const relPath = relativePrefix ? `${relativePrefix}/${file.name}` : file.name;
        const fullRemotePath = currentPath ? `${currentPath.replace(/^\/+|\/+$/g, '')}/${file.name}` : file.name;

        if (file.isFolder) {
          await scanRemoteDir(fullRemotePath, relPath);
        } else {
          results[relPath] = {
            ...file,
            name: relPath
          };
        }
      }
    };

    await scanRemoteDir(basePath.replace(/^\/+|\/+$/g, ''), '');
    return results;
  }

  private getRemoteFolderPath(pairRemotePath: string, fileRelPath: string): string {
    const subDir = path.posix.dirname(fileRelPath);
    const base = pairRemotePath.replace(/^\/+|\/+$/g, '');
    if (!base && (subDir === '.' || !subDir)) return '';
    if (!base) return subDir;
    if (subDir === '.' || !subDir) return base;
    return `${base}/${subDir}`;
  }

  private getFullRemoteFilePath(pairRemotePath: string, fileRelPath: string): string {
    const base = pairRemotePath.replace(/^\/+|\/+$/g, '');
    if (!base) return fileRelPath;
    return `${base}/${fileRelPath}`;
  }

  private shouldSyncItem(name: string): boolean {
    const base = path.basename(name);
    if (this.ignoredFiles.has(base)) return false;
    if (base.startsWith('.')) return false;
    if (base.endsWith('.cloudinfo')) return false;
    if (base.endsWith('.crdownload') || base.endsWith('.tmp')) return false;
    return true;
  }
}
