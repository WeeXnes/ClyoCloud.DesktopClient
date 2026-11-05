import { AddToHydeThemeResult, AppStateData, ClyoFile, SyncFolderPair, TransferItem, WallpaperMode } from '../../shared/types';

declare global {
  interface Window {
    electronAPI: {
      getAppState: () => Promise<AppStateData>;
      refreshData: () => Promise<AppStateData>;
      loginWithPayload: (payloadStr: string, serverUrl?: string) => Promise<{ success: boolean; message: string }>;
      loginWithCredentials: (u: string, p: string, serverUrl?: string) => Promise<{ success: boolean; requires2fa?: boolean; tempToken?: string; message: string }>;
      verify2FA: (tempToken: string, code: string, username: string, serverUrl?: string) => Promise<{ success: boolean; message: string }>;
      logout: () => Promise<AppStateData>;

      uploadFiles: (filePaths: string[], destination: string) => Promise<TransferItem[]>;
      uploadClipboard: (destination: string) => Promise<{ success: boolean; message: string; url?: string }>;

      fetchWallpapers: () => Promise<ClyoFile[]>;
      fetchThumbnail: (remotePath: string) => Promise<string | null>;
      setDesktopWallpaper: (file: ClyoFile) => Promise<boolean>;
      getWallpaperMode: () => Promise<WallpaperMode>;
      addWallpaperToHydeTheme: (file: ClyoFile) => Promise<AddToHydeThemeResult>;

      syncAll: () => Promise<{ statusMessage: string; lastSyncDate: number | null }>;
      getSyncPairs: () => Promise<SyncFolderPair[]>;
      addSyncPair: (localPath: string, remotePath: string) => Promise<SyncFolderPair>;
      removeSyncPair: (id: string) => Promise<SyncFolderPair[]>;

      setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
      openDirectoryDialog: () => Promise<string | null>;
      openFileDialog: () => Promise<string[]>;
      openExternal: (url: string) => Promise<void>;
      quitApp: () => Promise<void>;
      hideWindow: () => Promise<void>;

      onSwitchTab: (callback: (tab: string) => void) => () => void;
      onSyncStateChanged: (callback: (state: any) => void) => () => void;
      onTransferUpdated: (callback: (transfer: TransferItem) => void) => () => void;
      onDataRefreshed: (callback: (appState: AppStateData) => void) => () => void;
      onClipboardUploaded: (callback: (result: any) => void) => () => void;
    };
  }
}

class AppRenderer {
  private state: AppStateData | null = null;
  private currentTab: string = 'Upload';
  private wallpapers: ClyoFile[] = [];
  private syncPairs: SyncFolderPair[] = [];
  private loginMode: 'token' | 'creds' = 'token';
  private temp2FAToken: string = '';

  // Elements
  private statusDot = document.getElementById('status-dot')!;
  private statusText = document.getElementById('status-text')!;
  private btnRefresh = document.getElementById('btn-refresh')!;
  private btnClose = document.getElementById('btn-close');
  private btnQuit = document.getElementById('btn-quit')!;
  private storageBar = document.getElementById('storage-bar')!;
  private storageProgressFill = document.getElementById('storage-progress-fill')!;
  private storageText = document.getElementById('storage-text')!;
  private tabsBar = document.getElementById('tabs-bar')!;
  private tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-button');
  private tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');

  // Login Elements
  private loginServerUrl = document.getElementById('login-server-url') as HTMLInputElement;
  private btnModeToken = document.getElementById('btn-mode-token')!;
  private btnModeCreds = document.getElementById('btn-mode-creds')!;
  private flowToken = document.getElementById('flow-token')!;
  private flowCreds = document.getElementById('flow-creds')!;
  private credsStep1 = document.getElementById('creds-step-1')!;
  private credsStep2FA = document.getElementById('creds-step-2fa')!;
  private loginPayloadInput = document.getElementById('login-payload-input') as HTMLTextAreaElement;
  private loginUsername = document.getElementById('login-username') as HTMLInputElement;
  private loginPassword = document.getElementById('login-password') as HTMLInputElement;
  private login2FACode = document.getElementById('login-2fa-code') as HTMLInputElement;
  private loginMsg = document.getElementById('login-msg')!;
  private btnLoginSubmit = document.getElementById('btn-login-submit')!;

  // Upload Elements
  private uploadDestSelect = document.getElementById('upload-destination-select') as HTMLSelectElement;
  private dropZone = document.getElementById('drop-zone')!;
  private btnBrowseFiles = document.getElementById('btn-browse-files')!;
  private btnUploadClipboard = document.getElementById('btn-upload-clipboard')!;
  private clipboardBtnText = document.getElementById('clipboard-btn-text')!;
  private clipboardStatus = document.getElementById('clipboard-status')!;
  private transfersSection = document.getElementById('transfers-section')!;
  private transfersList = document.getElementById('transfers-list')!;

  // Wallpapers Elements
  private wallpapersCountLabel = document.getElementById('wallpapers-count-label')!;
  private btnReloadWallpapers = document.getElementById('btn-reload-wallpapers')!;
  private wallpapersLoading = document.getElementById('wallpapers-loading')!;
  private wallpapersEmpty = document.getElementById('wallpapers-empty')!;
  private wallpapersGrid = document.getElementById('wallpapers-grid')!;

  // Sync Elements
  private syncSubStatus = document.getElementById('sync-sub-status')!;
  private btnSyncNow = document.getElementById('btn-sync-now')!;
  private syncSpinIcon = document.getElementById('sync-spin-icon')!;
  private syncBtnLabel = document.getElementById('sync-btn-label')!;
  private btnOpenAddFolder = document.getElementById('btn-open-add-folder')!;
  private syncEmptyState = document.getElementById('sync-empty-state')!;
  private btnEmptyAddFolder = document.getElementById('btn-empty-add-folder')!;
  private syncedFoldersList = document.getElementById('synced-folders-list')!;

  // Settings Elements
  private settingsUserName = document.getElementById('settings-user-name')!;
  private settingsServerUrl = document.getElementById('settings-server-url')!;
  private btnOpenWeb = document.getElementById('btn-open-web')!;
  private settingsMetricsSection = document.getElementById('settings-metrics-section')!;
  private metricsStorageFill = document.getElementById('metrics-storage-fill')!;
  private metricCpuGroup = document.getElementById('metric-cpu-group')!;
  private metricCpuVal = document.getElementById('metric-cpu-val')!;
  private metricRamGroup = document.getElementById('metric-ram-group')!;
  private metricRamVal = document.getElementById('metric-ram-val')!;
  private prefLaunchLogin = document.getElementById('pref-launch-login') as HTMLInputElement;
  private settingsDeviceModel = document.getElementById('settings-device-model')!;
  private btnOpenBrowser = document.getElementById('btn-open-browser')!;
  private btnSignOut = document.getElementById('btn-sign-out')!;

  // Modal Elements
  private modalAddFolder = document.getElementById('modal-add-folder')!;
  private modalLocalPath = document.getElementById('modal-local-path') as HTMLInputElement;
  private modalRemotePath = document.getElementById('modal-remote-path') as HTMLInputElement;
  private btnModalBrowse = document.getElementById('btn-modal-browse')!;
  private btnModalCancel = document.getElementById('btn-modal-cancel')!;
  private btnModalSave = document.getElementById('btn-modal-save')!;

  constructor() {
    this.initEventListeners();
    this.initBackendListeners();
    this.loadInitialState();
  }

  private async loadInitialState(): Promise<void> {
    try {
      this.state = await window.electronAPI.getAppState();
      if (this.state) {
        if (this.state.serverUrl && this.loginServerUrl) {
          this.loginServerUrl.value = this.state.serverUrl;
        }
        if (this.state.currentUser && this.loginUsername) {
          this.loginUsername.value = this.state.currentUser;
        }
      }
      this.syncPairs = await window.electronAPI.getSyncPairs();
      this.render();
      if (this.state?.isAuthenticated) {
        this.loadWallpapers();
      }
    } catch (e) {
      console.error('Failed to load initial app state:', e);
    }
  }

  private initEventListeners(): void {
    // Top Bar Actions
    this.btnRefresh.addEventListener('click', async () => {
      this.btnRefresh.querySelector('svg')?.classList.add('spin-animation');
      this.state = await window.electronAPI.refreshData();
      this.render();
      setTimeout(() => {
        this.btnRefresh.querySelector('svg')?.classList.remove('spin-animation');
      }, 800);
    });

    this.btnClose?.addEventListener('click', () => {
      window.electronAPI.hideWindow();
    });

    this.btnQuit.addEventListener('click', () => {
      window.electronAPI.quitApp();
    });

    // ESC closes/hides the popover window
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.electronAPI.hideWindow();
      }
    });

    // Tab Navigation
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // Login Mode Switch
    this.btnModeToken.addEventListener('click', () => {
      this.loginMode = 'token';
      this.btnModeToken.classList.add('active');
      this.btnModeCreds.classList.remove('active');
      this.flowToken.style.display = 'flex';
      this.flowCreds.style.display = 'none';
      this.loginMsg.style.display = 'none';
      this.btnLoginSubmit.querySelector('span')!.textContent = 'Connect & Login';
    });

    this.btnModeCreds.addEventListener('click', () => {
      this.loginMode = 'creds';
      this.btnModeCreds.classList.add('active');
      this.btnModeToken.classList.remove('active');
      this.flowToken.style.display = 'none';
      this.flowCreds.style.display = 'flex';
      this.loginMsg.style.display = 'none';
      if (this.temp2FAToken) {
        this.btnLoginSubmit.querySelector('span')!.textContent = 'Verify 2FA';
      } else {
        this.btnLoginSubmit.querySelector('span')!.textContent = 'Connect & Login';
      }
    });

    this.btnLoginSubmit.addEventListener('click', () => this.handleLogin());

    // Upload & DropZone
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.add('drag-over');
    });

    this.dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.remove('drag-over');
    });

    this.dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.remove('drag-over');

      if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      const filePaths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i] as any;
        if (file.path) {
          filePaths.push(file.path);
        }
      }

      if (filePaths.length > 0) {
        const dest = this.uploadDestSelect.value;
        const transfers = await window.electronAPI.uploadFiles(filePaths, dest);
        if (this.state) {
          this.state.recentTransfers = transfers;
          this.renderTransfers();
        }
      }
    });

    this.btnBrowseFiles.addEventListener('click', async () => {
      const selected = await window.electronAPI.openFileDialog();
      if (selected && selected.length > 0) {
        const dest = this.uploadDestSelect.value;
        const transfers = await window.electronAPI.uploadFiles(selected, dest);
        if (this.state) {
          this.state.recentTransfers = transfers;
          this.renderTransfers();
        }
      }
    });

    this.btnUploadClipboard.addEventListener('click', async () => {
      this.btnUploadClipboard.setAttribute('disabled', 'true');
      this.clipboardBtnText.textContent = 'Uploading...';
      this.clipboardStatus.style.display = 'none';

      const dest = this.uploadDestSelect.value;
      const res = await window.electronAPI.uploadClipboard(dest);

      this.btnUploadClipboard.removeAttribute('disabled');
      this.clipboardBtnText.textContent = 'Upload Clipboard';
      this.clipboardStatus.textContent = res.message;
      this.clipboardStatus.style.display = 'block';
      this.clipboardStatus.style.color = res.success ? 'var(--success)' : 'var(--danger)';
    });

    // Wallpapers
    this.btnReloadWallpapers.addEventListener('click', () => this.loadWallpapers());

    // Sync
    this.btnSyncNow.addEventListener('click', async () => {
      this.syncSpinIcon.classList.add('spin-animation');
      this.syncBtnLabel.textContent = 'Syncing...';
      const res = await window.electronAPI.syncAll();
      this.syncSubStatus.textContent = res.statusMessage;
      this.syncSpinIcon.classList.remove('spin-animation');
      this.syncBtnLabel.textContent = 'Sync Now';
      this.syncPairs = await window.electronAPI.getSyncPairs();
      this.renderSyncPairs();
    });

    const openAddModal = () => {
      this.modalLocalPath.value = '';
      this.modalRemotePath.value = '';
      this.modalAddFolder.classList.add('active');
    };
    this.btnOpenAddFolder.addEventListener('click', openAddModal);
    this.btnEmptyAddFolder.addEventListener('click', openAddModal);

    this.btnModalCancel.addEventListener('click', () => {
      this.modalAddFolder.classList.remove('active');
    });

    this.btnModalBrowse.addEventListener('click', async () => {
      const dir = await window.electronAPI.openDirectoryDialog();
      if (dir) {
        this.modalLocalPath.value = dir;
        if (!this.modalRemotePath.value) {
          const parts = dir.split(/[\\/]/).filter(Boolean);
          this.modalRemotePath.value = parts[parts.length - 1] || '';
        }
      }
    });

    this.btnModalSave.addEventListener('click', async () => {
      const localPath = this.modalLocalPath.value.trim();
      const remotePath = this.modalRemotePath.value.trim();
      if (!localPath) return;

      await window.electronAPI.addSyncPair(localPath, remotePath);
      this.syncPairs = await window.electronAPI.getSyncPairs();
      this.renderSyncPairs();
      this.modalAddFolder.classList.remove('active');
    });

    // Settings
    this.btnOpenWeb.addEventListener('click', () => {
      if (this.state?.serverUrl) {
        window.electronAPI.openExternal(this.state.serverUrl);
      }
    });
    this.btnOpenBrowser.addEventListener('click', () => {
      if (this.state?.serverUrl) {
        window.electronAPI.openExternal(this.state.serverUrl);
      }
    });

    this.prefLaunchLogin.addEventListener('change', async () => {
      await window.electronAPI.setLaunchAtLogin(this.prefLaunchLogin.checked);
    });

    this.btnSignOut.addEventListener('click', async () => {
      this.state = await window.electronAPI.logout();
      this.wallpapers = [];
      this.render();
    });
  }

  private initBackendListeners(): void {
    window.electronAPI.onSwitchTab((tab) => {
      this.switchTab(tab);
    });

    window.electronAPI.onSyncStateChanged((syncState) => {
      if (this.state) {
        this.state.isSyncing = syncState.isSyncing;
        this.state.syncStatusMessage = syncState.statusMessage;
      }
      this.updateStatusBadge();
      this.syncSubStatus.textContent = syncState.statusMessage;
      if (syncState.isSyncing) {
        this.syncSpinIcon.classList.add('spin-animation');
        this.syncBtnLabel.textContent = 'Syncing...';
      } else {
        this.syncSpinIcon.classList.remove('spin-animation');
        this.syncBtnLabel.textContent = 'Sync Now';
      }
    });

    window.electronAPI.onTransferUpdated((updatedTransfer) => {
      if (!this.state) return;
      const idx = this.state.recentTransfers.findIndex(t => t.id === updatedTransfer.id);
      if (idx !== -1) {
        this.state.recentTransfers[idx] = updatedTransfer;
      } else {
        this.state.recentTransfers.unshift(updatedTransfer);
      }
      this.renderTransfers();
    });

    window.electronAPI.onDataRefreshed((newState) => {
      this.state = newState;
      this.render();
    });

    window.electronAPI.onClipboardUploaded((res) => {
      this.clipboardStatus.textContent = res.message;
      this.clipboardStatus.style.display = 'block';
      this.clipboardStatus.style.color = res.success ? 'var(--success)' : 'var(--danger)';
    });
  }

  private switchTab(tab: string): void {
    this.currentTab = tab;
    this.tabButtons.forEach(btn => {
      if (btn.dataset.tab === tab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    this.tabPanes.forEach(pane => {
      if (pane.id === `pane-${tab.toLowerCase()}`) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    if (tab === 'Wallpapers' && this.wallpapers.length === 0) {
      this.loadWallpapers();
    }
  }

  private async handleLogin(): Promise<void> {
    this.loginMsg.style.display = 'none';
    const serverUrl = this.loginServerUrl.value.trim();

    if (this.loginMode === 'token') {
      const payload = this.loginPayloadInput.value.trim();
      if (!payload) {
        this.showLoginMessage('Please paste a token or QR JSON payload', false);
        return;
      }

      this.btnLoginSubmit.setAttribute('disabled', 'true');
      const res = await window.electronAPI.loginWithPayload(payload, serverUrl);
      this.btnLoginSubmit.removeAttribute('disabled');

      if (res.success) {
        this.showLoginMessage(res.message, true);
        this.state = await window.electronAPI.getAppState();
        this.render();
      } else {
        this.showLoginMessage(res.message, false);
      }
    } else {
      if (this.temp2FAToken) {
        // Verify 2FA
        const code = this.login2FACode.value.trim();
        const username = this.loginUsername.value.trim();
        if (!code) {
          this.showLoginMessage('Please enter your 2FA code', false);
          return;
        }

        this.btnLoginSubmit.setAttribute('disabled', 'true');
        const res = await window.electronAPI.verify2FA(this.temp2FAToken, code, username, serverUrl);
        this.btnLoginSubmit.removeAttribute('disabled');

        if (res.success) {
          this.temp2FAToken = '';
          this.showLoginMessage(res.message, true);
          this.state = await window.electronAPI.getAppState();
          this.render();
        } else {
          this.showLoginMessage(res.message, false);
        }
      } else {
        // Step 1: Credentials
        const username = this.loginUsername.value.trim();
        const password = this.loginPassword.value;
        if (!username || !password) {
          this.showLoginMessage('Please enter username and password', false);
          return;
        }

        this.btnLoginSubmit.setAttribute('disabled', 'true');
        const res = await window.electronAPI.loginWithCredentials(username, password, serverUrl);
        this.btnLoginSubmit.removeAttribute('disabled');

        if (res.requires2fa && res.tempToken) {
          this.temp2FAToken = res.tempToken;
          this.credsStep1.style.display = 'none';
          this.credsStep2FA.style.display = 'block';
          this.btnLoginSubmit.querySelector('span')!.textContent = 'Verify 2FA';
          this.showLoginMessage('Password verified. Enter your 2FA code.', true);
        } else if (res.success) {
          this.showLoginMessage(res.message, true);
          this.state = await window.electronAPI.getAppState();
          this.render();
        } else {
          this.showLoginMessage(res.message, false);
        }
      }
    }
  }

  private showLoginMessage(msg: string, isSuccess: boolean): void {
    this.loginMsg.textContent = msg;
    this.loginMsg.className = `login-message ${isSuccess ? 'success' : 'error'}`;
    this.loginMsg.style.display = 'block';
  }

  private render(): void {
    if (!this.state) return;

    this.updateStatusBadge();

    if (!this.state.isAuthenticated) {
      if (this.state.serverUrl && (!this.loginServerUrl.value || this.loginServerUrl.value === 'http://localhost:6969')) {
        this.loginServerUrl.value = this.state.serverUrl;
      }
      if (this.state.currentUser && !this.loginUsername.value) {
        this.loginUsername.value = this.state.currentUser;
      }
      // Show login pane, hide storage and tabs
      this.storageBar.style.display = 'none';
      this.tabsBar.style.display = 'none';
      this.tabPanes.forEach(p => p.classList.remove('active'));
      document.getElementById('pane-login')!.classList.add('active');
    } else {
      // Authenticated view
      document.getElementById('pane-login')!.classList.remove('active');
      this.storageBar.style.display = 'flex';
      this.tabsBar.style.display = 'flex';
      this.switchTab(this.currentTab);

      // Storage Quota
      if (this.state.serverStats) {
        const stats = this.state.serverStats;
        const used = stats.used || 0;
        const total = stats.total || 1;
        const pct = Math.min(100, Math.max(0, (used / total) * 100));

        this.storageProgressFill.style.width = `${pct}%`;
        if (pct > 90) {
          this.storageProgressFill.classList.add('danger');
        } else {
          this.storageProgressFill.classList.remove('danger');
        }

        this.storageText.textContent = `${this.formatBytes(used)} / ${this.formatBytes(total)}`;

        // Settings Metrics
        this.settingsMetricsSection.style.display = 'block';
        this.metricsStorageFill.style.width = `${pct}%`;
        if (stats.cpu && stats.cpu.load !== undefined) {
          this.metricCpuGroup.style.display = 'flex';
          this.metricCpuVal.textContent = `${stats.cpu.load.toFixed(1)}%`;
        }
        if (stats.ram && stats.ram.used && stats.ram.total) {
          this.metricRamGroup.style.display = 'flex';
          const ramPct = (stats.ram.used / stats.ram.total) * 100;
          this.metricRamVal.textContent = `${ramPct.toFixed(1)}%`;
        }
      }

      // Populate remote folders
      this.uploadDestSelect.innerHTML = '';
      this.state.remoteFolders.forEach(folder => {
        const opt = document.createElement('option');
        opt.value = folder;
        opt.textContent = folder === '/' ? 'Cloud Root (/)' : folder;
        this.uploadDestSelect.appendChild(opt);
      });

      this.renderTransfers();
      this.renderSyncPairs();

      // Settings details
      this.settingsUserName.textContent = this.state.currentUser;
      this.settingsServerUrl.textContent = this.state.serverUrl;
      this.prefLaunchLogin.checked = this.state.launchAtLogin;
      this.settingsDeviceModel.textContent = this.state.deviceModel;
    }
  }

  private updateStatusBadge(): void {
    if (!this.state) return;
    if (this.state.isSyncing) {
      this.statusDot.className = 'status-dot syncing';
      this.statusText.textContent = 'Syncing';
      this.statusText.style.color = 'var(--text)';
    } else if (this.state.isAuthenticated) {
      this.statusDot.className = 'status-dot connected';
      this.statusText.textContent = 'Connected';
      this.statusText.style.color = 'var(--text-2)';
    } else {
      this.statusDot.className = 'status-dot disconnected';
      this.statusText.textContent = 'Disconnected';
      this.statusText.style.color = 'var(--text-3)';
    }
  }

  private renderTransfers(): void {
    if (!this.state || this.state.recentTransfers.length === 0) {
      this.transfersSection.style.display = 'none';
      return;
    }

    this.transfersSection.style.display = 'block';
    this.transfersList.innerHTML = '';

    this.state.recentTransfers.slice(0, 5).forEach(item => {
      const card = document.createElement('div');
      card.className = 'transfer-item-card';

      let statusHtml = '';
      if (item.status.state === 'completed') {
        statusHtml = `<span class="transfer-badge success">✓</span>`;
      } else if (item.status.state === 'failed') {
        statusHtml = `<span class="transfer-badge failed" title="${item.status.error}">Failed</span>`;
      } else {
        const pct = Math.round(item.progress * 100);
        statusHtml = `<span class="transfer-pct num">${pct}%</span>`;
      }

      card.innerHTML = `
        <svg class="transfer-icon" viewBox="0 0 24 24"><path d="M12 2L6.5 7.5l1.42 1.41L11 5.83V16h2V5.83l3.08 3.09 1.42-1.42L12 2zm-8 18v2h16v-2H4z"/></svg>
        <div class="transfer-info">
          <div class="transfer-name" title="${item.name}">${item.name}</div>
          <div class="transfer-size num">${item.size > 0 ? this.formatBytes(item.size) : ''}</div>
        </div>
        ${statusHtml}
      `;
      this.transfersList.appendChild(card);
    });
  }

  private async loadWallpapers(): Promise<void> {
    this.wallpapersLoading.style.display = 'block';
    this.wallpapersEmpty.style.display = 'none';
    this.wallpapersGrid.innerHTML = '';

    try {
      const [wallpapers, wpMode] = await Promise.all([
        window.electronAPI.fetchWallpapers(),
        window.electronAPI.getWallpaperMode().catch((): WallpaperMode => ({ mode: 'default' })),
      ]);
      this.wallpapers = wallpapers;
      const isHyde = wpMode.mode === 'hyde';
      this.wallpapersCountLabel.textContent = `Cloud Wallpapers (${this.wallpapers.length})`
        + (isHyde ? ` · HyDE: ${wpMode.hydeTheme ?? 'unknown theme'}` : '');
      this.wallpapersLoading.style.display = 'none';

      if (this.wallpapers.length === 0) {
        this.wallpapersEmpty.style.display = 'block';
        return;
      }

      for (const wp of this.wallpapers) {
        const card = document.createElement('div');
        card.className = 'wallpaper-card';

        const thumbWrapper = document.createElement('div');
        thumbWrapper.className = 'wallpaper-thumb-wrapper';
        thumbWrapper.innerHTML = `<span class="micro">Loading...</span>`;

        // Async load thumbnail
        window.electronAPI.fetchThumbnail(wp.name).then(dataUrl => {
          if (dataUrl) {
            thumbWrapper.innerHTML = `<img src="${dataUrl}" class="wallpaper-thumb-img" alt="${wp.name}">`;
          } else {
            thumbWrapper.innerHTML = `<span class="micro">No Preview</span>`;
          }
        });

        const nameLabel = document.createElement('div');
        nameLabel.className = 'wallpaper-card-name';
        nameLabel.textContent = wp.name.split(/[\\/]/).pop() || wp.name;
        nameLabel.title = wp.name;

        const setBtn = document.createElement('button');
        setBtn.className = 'btn-secondary btn-wallpaper-set';
        const idleLabel = isHyde ? 'Add Wallpaper to Theme' : 'Set as Desktop';
        setBtn.textContent = idleLabel;
        if (isHyde) {
          setBtn.title = 'Download into the active HyDE theme\'s wallpapers folder (does not change your wallpaper)';
        }

        const resetBtn = () => {
          setBtn.classList.remove('applied');
          setBtn.removeAttribute('disabled');
          setBtn.textContent = idleLabel;
        };

        setBtn.addEventListener('click', async () => {
          setBtn.setAttribute('disabled', 'true');

          if (isHyde) {
            // HyDE: only download into the current theme's wallpapers folder, never apply.
            setBtn.textContent = 'Downloading...';
            const res = await window.electronAPI.addWallpaperToHydeTheme(wp)
              .catch((e: any): AddToHydeThemeResult => ({ success: false, message: e?.message || 'Failed' }));
            if (res.success) {
              setBtn.classList.add('applied');
              setBtn.textContent = res.alreadyExisted ? `Already in ${res.theme}` : `Added to ${res.theme}!`;
              if (res.localPath) setBtn.title = res.localPath;
            } else {
              setBtn.textContent = 'Failed to Add';
              setBtn.title = res.message;
            }
            setTimeout(resetBtn, 3000);
            return;
          }

          setBtn.textContent = 'Applying...';
          const ok = await window.electronAPI.setDesktopWallpaper(wp);
          if (ok) {
            setBtn.classList.add('applied');
            setBtn.textContent = 'Applied!';
          } else {
            setBtn.textContent = 'Failed to Set';
          }
          setTimeout(resetBtn, 3000);
        });

        card.appendChild(thumbWrapper);
        card.appendChild(nameLabel);
        card.appendChild(setBtn);
        this.wallpapersGrid.appendChild(card);
      }
    } catch (e) {
      this.wallpapersLoading.style.display = 'none';
      this.wallpapersEmpty.style.display = 'block';
      this.wallpapersEmpty.innerHTML = `<div class="empty-sub" style="color: var(--danger);">Failed to load wallpapers</div>`;
    }
  }

  private renderSyncPairs(): void {
    if (this.syncPairs.length === 0) {
      this.syncEmptyState.style.display = 'block';
      this.syncedFoldersList.innerHTML = '';
      return;
    }

    this.syncEmptyState.style.display = 'none';
    this.syncedFoldersList.innerHTML = '';

    this.syncPairs.forEach(pair => {
      const card = document.createElement('div');
      card.className = 'sync-pair-card';

      const folderName = pair.localPath.split(/[\\/]/).filter(Boolean).pop() || pair.localPath;
      const remoteName = pair.remotePath && pair.remotePath !== '/' ? pair.remotePath : 'Root';

      let badgeClass = 'sync-badge';
      if (pair.statusDescription.includes('Syncing')) {
        badgeClass += ' syncing';
      } else if (pair.statusDescription.includes('error')) {
        badgeClass += ' error';
      }

      card.innerHTML = `
        <div class="sync-pair-row1">
          <div class="sync-pair-title-group">
            <svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            <div class="sync-pair-names">
              <div class="sync-pair-name">${folderName}</div>
              <div class="sync-pair-path num" title="${pair.localPath}">${pair.localPath}</div>
            </div>
          </div>
          <span class="${badgeClass}">${pair.statusDescription}</span>
          <button class="btn-icon btn-delete-pair" data-id="${pair.id}" title="Remove Synced Folder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
        <div class="sync-pair-row2">
          <span>Remote: <span class="num">${remoteName}</span></span>
          <span class="num">${pair.lastSyncTime ? 'Synced ' + this.formatTimeAgo(pair.lastSyncTime) : 'Not synced yet'}</span>
        </div>
      `;

      card.querySelector('.btn-delete-pair')?.addEventListener('click', async () => {
        this.syncPairs = await window.electronAPI.removeSyncPair(pair.id);
        this.renderSyncPairs();
      });

      this.syncedFoldersList.appendChild(card);
    });
  }

  private formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  private formatTimeAgo(time: number): string {
    const diff = Math.floor((Date.now() - time) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new AppRenderer();
});
