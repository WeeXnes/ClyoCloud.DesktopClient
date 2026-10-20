import os from 'os';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import { ClyoFile } from '../../shared/types';
import { ClyoAPIClient } from '../api/clyoApi';

const execAsync = promisify(exec);

export class WallpaperManager {
  private static instance: WallpaperManager;
  private cacheDir: string;

  private constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'wallpapers');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  public static getInstance(): WallpaperManager {
    if (!WallpaperManager.instance) {
      WallpaperManager.instance = new WallpaperManager();
    }
    return WallpaperManager.instance;
  }

  public async setAsDesktopWallpaper(file: ClyoFile): Promise<boolean> {
    const localPath = path.join(this.cacheDir, file.name);

    // 1. Download or verify cached wallpaper
    let needsDownload = true;
    if (fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      if (stats.size === file.size) {
        needsDownload = false;
      }
    }

    if (needsDownload) {
      await ClyoAPIClient.getInstance().downloadFile(file.name, localPath);
    }

    // 2. Apply desktop wallpaper according to platform
    const platform = os.platform();
    if (platform === 'win32') {
      return await this.setWindowsWallpaper(localPath);
    } else if (platform === 'linux') {
      return await this.setLinuxWallpaper(localPath);
    } else if (platform === 'darwin') {
      // Fallback on macOS if run there
      try {
        await execAsync(`osascript -e 'tell application "Finder" to set desktop picture to POSIX file "${localPath}"'`);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private async setWindowsWallpaper(imagePath: string): Promise<boolean> {
    const absPath = path.resolve(imagePath).replace(/'/g, "''");
    // PowerShell script to invoke SystemParametersInfoW with SPI_SETDESKWALLPAPER (0x0014)
    const psCommand = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinWallpaper {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
[WinWallpaper]::SystemParametersInfo(0x0014, 0, '${absPath}', 0x01 | 0x02)
`;
    try {
      await execAsync(`powershell -NoProfile -NonInteractive -Command "${psCommand.replace(/\n/g, ' ')}"`);
      return true;
    } catch (e) {
      console.error('Failed to set Windows wallpaper:', e);
      return false;
    }
  }

  private async setLinuxWallpaper(imagePath: string): Promise<boolean> {
    const absPath = path.resolve(imagePath);
    const fileUri = `file://${absPath}`;
    const desktop = (process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase();

    // 1. GNOME / Budgie / Cinnamon
    if (desktop.includes('gnome') || desktop.includes('budgie') || desktop.includes('unity')) {
      try {
        await execAsync(`gsettings set org.gnome.desktop.background picture-uri "${fileUri}"`);
        await execAsync(`gsettings set org.gnome.desktop.background picture-uri-dark "${fileUri}"`).catch(() => {});
        return true;
      } catch (e) {
        console.warn('GNOME gsettings set failed, trying fallbacks:', e);
      }
    }

    if (desktop.includes('cinnamon')) {
      try {
        await execAsync(`gsettings set org.cinnamon.desktop.background picture-uri "${fileUri}"`);
        return true;
      } catch {
        // continue
      }
    }

    if (desktop.includes('mate')) {
      try {
        await execAsync(`gsettings set org.mate.background picture-filename "${absPath}"`);
        return true;
      } catch {
        // continue
      }
    }

    // 2. KDE Plasma
    if (desktop.includes('kde') || desktop.includes('plasma')) {
      const kdeScript = `
for (let i = 0; i < desktops().length; i++) {
  d = desktops()[i];
  d.wallpaperPlugin = "org.kde.image";
  d.currentConfigGroup = Array("Wallpaper", "org.kde.image", "General");
  d.writeConfig("Image", "${fileUri}");
}
`;
      try {
        await execAsync(`qdbus org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript '${kdeScript.replace(/\n/g, ' ')}'`);
        return true;
      } catch {
        // continue
      }
    }

    // 3. XFCE
    if (desktop.includes('xfce')) {
      try {
        // Query properties for monitors
        const { stdout } = await execAsync('xfconf-query -c xfce4-desktop -l');
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.includes('/last-image') || line.includes('/image-path')) {
            await execAsync(`xfconf-query -c xfce4-desktop -p ${line.trim()} -s "${absPath}"`);
          }
        }
        return true;
      } catch {
        // continue
      }
    }

    // 4. Generic X11 Tools: feh or nitrogen
    try {
      await execAsync(`feh --bg-fill "${absPath}"`);
      return true;
    } catch {
      try {
        await execAsync(`nitrogen --set-zoom-fill "${absPath}" --save`);
        return true;
      } catch {
        // continue
      }
    }

    // Final attempt: gsettings
    try {
      await execAsync(`gsettings set org.gnome.desktop.background picture-uri "${fileUri}"`);
      return true;
    } catch (e) {
      console.error('All Linux wallpaper mechanisms failed:', e);
      return false;
    }
  }
}
