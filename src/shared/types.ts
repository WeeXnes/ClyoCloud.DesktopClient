export interface Tag {
  name: string;
  color: string;
}

export interface FileMeta {
  tags?: Tag[];
  description?: string;
  isPublic?: boolean;
  isFavourite?: boolean;
  isWallpaper?: boolean;
  isPhotoWidget?: boolean;
  previewImage?: string;
}

export interface ClyoFile {
  id?: string;
  name: string;
  size: number;
  type: string;
  meta: FileMeta;
  lastModified: number;
  isFolder: boolean;
}

export interface RAMStats {
  total?: number;
  used?: number;
  free?: number;
}

export interface CPUStats {
  model?: string;
  cores?: number;
  load?: number; // 0-100 percentage
}

export interface ServerStats {
  used?: number;
  total?: number;
  free?: number;
  ram?: RAMStats;
  cpu?: CPUStats;
  username?: string;
}

export type TransferType = 'upload' | 'download' | 'sync' | 'clipboard';

export type TransferStatus =
  | { state: 'pending' }
  | { state: 'inProgress'; progress: number }
  | { state: 'completed' }
  | { state: 'failed'; error: string };

export interface TransferItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  type: TransferType;
  status: TransferStatus;
  date: number;
}

export interface SyncFolderPair {
  id: string;
  localPath: string;
  remotePath: string;
  isEnabled: boolean;
  lastSyncTime?: number;
  statusDescription: string;
}

export interface SyncManifestItem {
  size: number;
  localMtime: number;
  remoteMtime: number;
}

export interface SyncManifest {
  items: Record<string, SyncManifestItem>;
}

export interface DevicePayload {
  serverUrl: string;
  username: string;
  token: string;
}

export type ActiveTab = 'Upload' | 'Wallpapers' | 'Sync' | 'Settings';

export interface AppSettings {
  serverUrl: string;
  username: string;
  defaultUploadPath: string;
  launchAtLogin: boolean;
  syncFolderPairs: SyncFolderPair[];
  deviceModel: string;
}

export interface AppStateData {
  isAuthenticated: boolean;
  currentUser: string;
  serverUrl: string;
  selectedTab: ActiveTab;
  serverStats: ServerStats | null;
  recentTransfers: TransferItem[];
  isRefreshing: boolean;
  remoteFolders: string[];
  syncStatusMessage: string;
  isSyncing: boolean;
  launchAtLogin: boolean;
  deviceModel: string;
}

export interface LoginResult {
  success: boolean;
  requires2fa?: boolean;
  tempToken?: string;
  message: string;
}
