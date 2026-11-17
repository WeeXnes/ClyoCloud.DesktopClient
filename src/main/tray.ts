import path from 'path';
import { AppWindowManager } from './appWindow';
import { app, Tray, Menu, BrowserWindow, screen, nativeImage, shell } from 'electron';
import { SettingsManager } from './storage/settings';
import { SyncEngine } from './sync/syncEngine';
import { ClipboardUploader } from './clipboard/uploader';

export class TrayManager {
  private static instance: TrayManager;
  private tray: Tray | null = null;
  private popoverWindow: BrowserWindow | null = null;
  private idleIconPath: string;
  private syncingIconPath: string;

  private constructor() {
    this.idleIconPath = path.join(__dirname, '../../assets/tray-idle.png');
    this.syncingIconPath = path.join(__dirname, '../../assets/tray-syncing.png');
  }

  public static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager();
    }
    return TrayManager.instance;
  }

  public setup(popoverWindow: BrowserWindow): void {
    this.popoverWindow = popoverWindow;

    const icon = nativeImage.createFromPath(this.idleIconPath);
    this.tray = new Tray(icon);
    this.tray.setToolTip('ClyoCloud');

    // Left click toggles popover window
    this.tray.on('click', () => {
      this.togglePopover();
    });

    // Right click shows context menu
    this.tray.on('right-click', () => {
      this.showContextMenu();
    });

    // React to sync state changes to toggle tray icon
    SyncEngine.getInstance().addStateListener(() => {
      const isSyncing = SyncEngine.getInstance().isSyncing;
      this.updateTrayIcon(isSyncing);
    });
  }

  public updateTrayIcon(isSyncing: boolean): void {
    if (!this.tray) return;
    const iconPath = isSyncing ? this.syncingIconPath : this.idleIconPath;
    const icon = nativeImage.createFromPath(iconPath);
    this.tray.setImage(icon);
    this.tray.setToolTip(isSyncing ? 'ClyoCloud (Syncing...)' : 'ClyoCloud');
  }

  public togglePopover(): void {
    if (!this.popoverWindow) return;
    if (this.popoverWindow.isVisible()) {
      this.popoverWindow.hide();
    } else {
      this.showPopover();
    }
  }

  public showPopover(tab?: string): void {
    if (!this.popoverWindow || !this.tray) return;

    if (tab) {
      this.popoverWindow.webContents.send('switch-tab', tab);
    }

    const trayBounds = this.tray.getBounds();
    const windowBounds = this.popoverWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });

    let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
    let y = Math.round(trayBounds.y - windowBounds.height - 8);

    // If tray is at the top of the screen (e.g. some Linux panels)
    if (trayBounds.y < display.workArea.y + 100) {
      y = Math.round(trayBounds.y + trayBounds.height + 8);
    }

    // Keep window on screen
    if (x + windowBounds.width > display.workArea.x + display.workArea.width) {
      x = display.workArea.x + display.workArea.width - windowBounds.width - 12;
    }
    if (x < display.workArea.x) {
      x = display.workArea.x + 12;
    }
    if (y + windowBounds.height > display.workArea.y + display.workArea.height) {
      y = display.workArea.y + display.workArea.height - windowBounds.height - 12;
    }
    if (y < display.workArea.y) {
      y = display.workArea.y + 12;
    }

    this.popoverWindow.setPosition(x, y, false);
    this.popoverWindow.show();
    this.popoverWindow.focus();
  }

  public hidePopover(): void {
    if (this.popoverWindow && this.popoverWindow.isVisible()) {
      this.popoverWindow.hide();
    }
  }

  private showContextMenu(): void {
    const username = SettingsManager.getInstance().getUsername();
    const serverUrl = SettingsManager.getInstance().getServerUrl();
    const statusTitle = username ? `ClyoCloud (${username})` : 'ClyoCloud (Not Connected)';

    const menu = Menu.buildFromTemplate([
      { label: statusTitle, enabled: false },
      { type: 'separator' },
      {
        label: 'Open ClyoCloud',
        click: () => {
          AppWindowManager.getInstance().show().catch(console.error);
        }
      },
      {
        label: 'Open in Browser',
        click: () => {
          shell.openExternal(serverUrl);
        }
      },
      {
        label: 'Sync All Folders Now',
        accelerator: 'CmdOrCtrl+S',
        click: () => {
          SyncEngine.getInstance().syncAll().catch(console.error);
        }
      },
      {
        label: 'Upload Clipboard Image',
        accelerator: 'CmdOrCtrl+Alt+U',
        click: () => {
          ClipboardUploader.getInstance().uploadClipboardImage().catch(console.error);
        }
      },
      { type: 'separator' },
      {
        label: 'Preferences...',
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          this.showPopover('Settings');
        }
      },
      {
        label: 'Quit ClyoCloud',
        accelerator: 'CmdOrCtrl+Q',
        click: () => {
          app.quit();
        }
      }
    ]);

    if (this.tray) {
      this.tray.popUpContextMenu(menu);
    }
  }
}
