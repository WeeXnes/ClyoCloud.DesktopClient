import path from 'path';
import fs from 'fs';
import {
  app, BrowserWindow, Menu, Notification, session, shell, screen,
  type Cookie, type Session, type WebContents, type DownloadItem, type MenuItemConstructorOptions,
} from 'electron';
import { SettingsManager } from './storage/settings';
import { SecureStore } from './storage/secureStore';

/**
 * The full ClyoCloud app window: the server's own web UI in a native window, so it looks and works
 * exactly like the website and updates with the server. Around it the desktop adds:
 *  - automatic sign-in with the token the tray companion already has (and the other way round),
 *  - native downloads with taskbar progress and "Show in folder",
 *  - remembered size/position, keyboard shortcuts, a context menu,
 *  - an offline / setup page when the server can't be reached.
 */

const PARTITION = 'persist:clyocloud-app';
const TOKEN_COOKIE = 'token';

interface WindowState { x?: number; y?: number; width: number; height: number; maximized: boolean }

export class AppWindowManager {
  private static instance: AppWindowManager;
  static getInstance(): AppWindowManager {
    if (!AppWindowManager.instance) AppWindowManager.instance = new AppWindowManager();
    return AppWindowManager.instance;
  }

  private win: BrowserWindow | null = null;
  private iconPath = '';
  private onAccountChanged: () => void = () => {};
  private sessionReady = false;
  // Ignore our own cookie writes when listening for web sign-ins
  private writingCookie = false;

  /** [iconPath] window icon; [onAccountChanged] called when signing in/out in the window changes the account. */
  init(iconPath: string, onAccountChanged: () => void): void {
    this.iconPath = iconPath;
    this.onAccountChanged = onAccountChanged;
  }

  private get appSession(): Session {
    return session.fromPartition(PARTITION);
  }

  private serverUrl(): string {
    return SettingsManager.getInstance().getServerUrl().replace(/\/+$/, '');
  }

  isOpen(): boolean {
    return !!this.win && !this.win.isDestroyed();
  }

  // ─── Window ────────────────────────────────────────────────────────────────

  async show(pathOnServer = ''): Promise<void> {
    if (this.isOpen()) {
      if (this.win!.isMinimized()) this.win!.restore();
      this.win!.show();
      this.win!.focus();
      if (pathOnServer) await this.load(pathOnServer);
      return;
    }

    this.setupSession();
    const state = this.loadWindowState();
    const win = new BrowserWindow({
      title: 'ClyoCloud',
      icon: this.iconPath,
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      minWidth: 360,
      minHeight: 480,
      show: false,
      backgroundColor: '#000000', // matches the web UI's background: no white flash
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        preload: path.join(__dirname, '../preload/appPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    });
    this.win = win;
    win.setMenuBarVisibility(false);
    if (state.maximized) win.maximize();

    win.once('ready-to-show', () => win.show());
    win.on('close', () => this.saveWindowState());
    win.on('closed', () => { this.win = null; });
    win.on('page-title-updated', (e, title) => {
      // "Files - ClyoCloud" etc. comes from the web UI; keep it, but never empty
      if (!title) { e.preventDefault(); win.setTitle('ClyoCloud'); }
    });

    this.wireWebContents(win.webContents);
    await this.load(pathOnServer);
  }

  /** Signs the window in with the stored token (if any) and loads the server, or the offline page. */
  async load(pathOnServer = ''): Promise<void> {
    if (!this.isOpen()) return;
    const base = this.serverUrl();
    if (!base) return this.showOffline('setup');
    await this.syncCookieFromStore();
    try {
      await this.win!.loadURL(base + (pathOnServer.startsWith('/') ? pathOnServer : `/${pathOnServer}`));
    } catch {
      // did-fail-load shows the offline page
    }
  }

  private showOffline(reason: 'offline' | 'setup', detail = ''): void {
    if (!this.isOpen()) return;
    const file = path.join(__dirname, '../renderer/offline.html');
    this.win!.loadFile(file, { query: { reason, server: this.serverUrl(), detail } }).catch(() => {});
  }

  /** Called from the offline page. */
  async connect(serverUrl: string): Promise<void> {
    let url = serverUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
    if (url) SettingsManager.getInstance().setServerUrl(url.replace(/\/+$/, ''));
    await this.load();
  }

  // ─── Navigation, links, shortcuts, menu ────────────────────────────────────

  private isServerUrl(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.serverUrl()).origin;
    } catch {
      return false;
    }
  }

  private wireWebContents(wc: WebContents): void {
    // Server not reachable: offline page with retry
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted */) return;
      if (url.startsWith('file:')) return;
      this.showOffline('offline', description);
    });

    // Stay on the ClyoCloud server; everything else opens in the default browser
    wc.on('will-navigate', (e, url) => {
      if (url.startsWith('file:') || this.isServerUrl(url)) return;
      e.preventDefault();
      shell.openExternal(url);
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (this.isServerUrl(url)) {
        // e.g. a file opened in a new tab: a separate app window on the same session
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true, backgroundColor: '#000000', icon: this.iconPath,
            webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
          },
        };
      }
      if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      const key = input.key.toLowerCase();
      const handled = (() => {
        if ((ctrl && key === 'r') || key === 'f5') { input.shift ? wc.reloadIgnoringCache() : wc.reload(); return true; }
        if (input.alt && key === 'arrowleft') { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return true; }
        if (input.alt && key === 'arrowright') { if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return true; }
        if (ctrl && (key === '=' || key === '+')) { wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4)); return true; }
        if (ctrl && key === '-') { wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3)); return true; }
        if (ctrl && key === '0') { wc.setZoomLevel(0); return true; }
        if (key === 'f11') { this.win?.setFullScreen(!this.win.isFullScreen()); return true; }
        if (ctrl && input.shift && key === 'i') { wc.toggleDevTools(); return true; }
        return false;
      })();
      if (handled) event.preventDefault();
    });

    // Mouse back/forward buttons
    this.win?.on('app-command', (_e, cmd) => {
      if (cmd === 'browser-backward' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      if (cmd === 'browser-forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    });

    wc.on('context-menu', (_e, p) => {
      const items: MenuItemConstructorOptions[] = [];
      if (p.misspelledWord) {
        p.dictionarySuggestions.slice(0, 4).forEach((s) => items.push({ label: s, click: () => wc.replaceMisspelling(s) }));
        if (items.length) items.push({ type: 'separator' });
      }
      if (p.linkURL) {
        items.push({ label: 'Open link in browser', click: () => shell.openExternal(p.linkURL) });
        items.push({ label: 'Copy link address', click: () => require('electron').clipboard.writeText(p.linkURL) });
        items.push({ type: 'separator' });
      }
      if (p.mediaType === 'image' && p.srcURL) {
        items.push({ label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) });
        items.push({ label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) });
        items.push({ type: 'separator' });
      }
      if (p.isEditable) {
        items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
      } else if (p.selectionText) {
        items.push({ role: 'copy' });
      }
      if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() },
      );
      Menu.buildFromTemplate(items).popup({ window: this.win ?? undefined });
    });
  }

  // ─── Session: sign-in, cookies, downloads ──────────────────────────────────

  private setupSession(): void {
    if (this.sessionReady) return;
    this.sessionReady = true;
    const s = this.appSession;

    // Only the permissions the web UI uses
    s.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications', 'media'].includes(permission));
    });

    // Self-hosted servers often use self-signed certificates (same as the tray companion)
    s.setCertificateVerifyProc((_req, callback) => callback(0));

    s.on('will-download', (_e, item) => this.handleDownload(item));

    // Signing in or out on the website updates the desktop companion too
    s.cookies.on('changed', (_e, cookie: Cookie, cause, removed) => {
      if (cookie.name !== TOKEN_COOKIE || this.writingCookie) return;
      if (!this.cookieBelongsToServer(cookie)) return;
      if (!removed) {
        const username = usernameFromJwt(cookie.value);
        if (!username) return;
        SettingsManager.getInstance().setUsername(username);
        SecureStore.getInstance().saveToken(username, cookie.value);
        this.onAccountChanged();
      } else if (cause === 'explicit' || cause === 'expired-overwrite') {
        const username = SettingsManager.getInstance().getUsername();
        if (username) SecureStore.getInstance().deleteToken(username);
        SettingsManager.getInstance().setUsername('');
        this.onAccountChanged();
      }
    });
  }

  private cookieBelongsToServer(cookie: Cookie): boolean {
    try {
      const host = new URL(this.serverUrl()).hostname;
      const domain = (cookie.domain || '').replace(/^\./, '');
      return domain === host;
    } catch {
      return false;
    }
  }

  /** Puts the tray companion's token into the window's session (or removes it after a sign-out). */
  async syncCookieFromStore(): Promise<void> {
    const base = this.serverUrl();
    if (!base) return;
    this.setupSession();
    const username = SettingsManager.getInstance().getUsername();
    const token = username ? SecureStore.getInstance().readToken(username) : null;
    this.writingCookie = true;
    try {
      if (token) {
        await this.appSession.cookies.set({
          url: base, name: TOKEN_COOKIE, value: token, path: '/',
          expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
          sameSite: 'lax',
        });
      } else {
        await this.appSession.cookies.remove(base, TOKEN_COOKIE);
      }
      await this.appSession.cookies.flushStore();
    } catch (e) {
      console.warn('Could not set the session cookie', e);
    } finally {
      this.writingCookie = false;
    }
  }

  /** After the tray companion signs in or out: update the window's session and reload it. */
  async accountChangedOutside(): Promise<void> {
    await this.syncCookieFromStore();
    if (this.isOpen()) await this.load();
  }

  private handleDownload(item: DownloadItem): void {
    const dir = app.getPath('downloads');
    item.setSavePath(uniquePath(dir, item.getFilename()));
    const win = this.win;
    item.on('updated', () => {
      const total = item.getTotalBytes();
      if (win && !win.isDestroyed()) win.setProgressBar(total > 0 ? item.getReceivedBytes() / total : 2 /* indeterminate */);
    });
    item.once('done', (_e, state) => {
      if (win && !win.isDestroyed()) win.setProgressBar(-1);
      const file = item.getSavePath();
      if (state === 'completed') {
        const n = new Notification({ title: 'Download finished', body: path.basename(file), icon: this.iconPath, silent: true });
        n.on('click', () => shell.showItemInFolder(file));
        n.show();
      } else if (state === 'interrupted') {
        new Notification({ title: 'Download failed', body: path.basename(file), icon: this.iconPath }).show();
      }
    });
  }

  // ─── Window state ──────────────────────────────────────────────────────────

  private stateFile(): string {
    return path.join(app.getPath('userData'), 'app-window.json');
  }

  private loadWindowState(): WindowState {
    const fallback: WindowState = { width: 1280, height: 820, maximized: false };
    try {
      const s = JSON.parse(fs.readFileSync(this.stateFile(), 'utf-8')) as WindowState;
      // Only restore a position that is still on a connected display
      const visible = s.x !== undefined && s.y !== undefined && screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return s.x! >= b.x - 50 && s.y! >= b.y - 50 && s.x! < b.x + b.width - 100 && s.y! < b.y + b.height - 100;
      });
      return { width: Math.max(360, s.width || 1280), height: Math.max(480, s.height || 820), maximized: !!s.maximized, ...(visible ? { x: s.x, y: s.y } : {}) };
    } catch {
      return fallback;
    }
  }

  private saveWindowState(): void {
    if (!this.isOpen()) return;
    const w = this.win!;
    const b = w.getNormalBounds();
    const state: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.isMaximized() };
    try {
      fs.writeFileSync(this.stateFile(), JSON.stringify(state));
    } catch {}
  }
}

/** The web UI's JWT carries { user: { name } }; read it without verifying (the server does that). */
function usernameFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    if (payload?.isPartial) return null; // half-way through 2FA
    return typeof payload?.user?.name === 'string' ? payload.user.name : null;
  } catch {
    return null;
  }
}

/** Downloads/name.ext, or "name (2).ext" if that exists. */
function uniquePath(dir: string, fileName: string): string {
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '_') || 'download';
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  let candidate = path.join(dir, safe);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}
