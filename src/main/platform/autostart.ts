import os from 'os';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export class AutostartManager {
  private static instance: AutostartManager;

  private constructor() {}

  public static getInstance(): AutostartManager {
    if (!AutostartManager.instance) {
      AutostartManager.instance = new AutostartManager();
    }
    return AutostartManager.instance;
  }

  public setLaunchAtLogin(enabled: boolean): void {
    const platform = os.platform();

    if (platform === 'win32' || platform === 'darwin') {
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled
        });
      } catch (e) {
        console.error('Failed to set login item settings via Electron:', e);
      }
    }

    if (platform === 'linux') {
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopFile = path.join(autostartDir, 'clyocloud.desktop');

      if (enabled) {
        try {
          if (!fs.existsSync(autostartDir)) {
            fs.mkdirSync(autostartDir, { recursive: true });
          }
          const execPath = process.execPath;
          const content = `[Desktop Entry]
Type=Application
Version=1.0
Name=ClyoCloud
Comment=ClyoCloud Companion Client
Exec="${execPath}" --hidden
Icon=clyocloud
Terminal=false
Categories=Network;FileTransfer;
StartupNotify=false
X-GNOME-Autostart-enabled=true
`;
          fs.writeFileSync(desktopFile, content, 'utf8');
        } catch (e) {
          console.error('Failed to write Linux autostart file:', e);
        }
      } else {
        try {
          if (fs.existsSync(desktopFile)) {
            fs.unlinkSync(desktopFile);
          }
        } catch (e) {
          console.error('Failed to delete Linux autostart file:', e);
        }
      }
    }
  }

  public isLaunchAtLogin(): boolean {
    const platform = os.platform();
    if (platform === 'win32' || platform === 'darwin') {
      return app.getLoginItemSettings().openAtLogin;
    }
    if (platform === 'linux') {
      const desktopFile = path.join(os.homedir(), '.config', 'autostart', 'clyocloud.desktop');
      return fs.existsSync(desktopFile);
    }
    return false;
  }
}
