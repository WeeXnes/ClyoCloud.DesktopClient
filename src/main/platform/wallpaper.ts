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
    try {
      // 1. Generate safe unique cached filename
      const fileId = Buffer.from(file.name).toString('hex').slice(0, 10);
      const safeBasename = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const localFilename = `${fileId}_${safeBasename}`;
      const localPath = path.join(this.cacheDir, localFilename);

      // 2. Download or verify cached wallpaper
      let needsDownload = true;
      if (fs.existsSync(localPath)) {
        const stats = fs.statSync(localPath);
        if (file.size && stats.size === file.size) {
          needsDownload = false;
        } else if (!file.size && stats.size > 0) {
          needsDownload = false;
        }
      }

      if (needsDownload) {
        await ClyoAPIClient.getInstance().downloadFile(file.name, localPath);
      }

      // 3. Apply desktop wallpaper according to platform
      const platform = os.platform();
      if (platform === 'win32') {
        return await this.setWindowsWallpaper(localPath);
      } else if (platform === 'linux') {
        return await this.setLinuxWallpaper(localPath);
      } else if (platform === 'darwin') {
        try {
          await execAsync(`osascript -e 'tell application "Finder" to set desktop picture to POSIX file "${localPath}"'`);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    } catch (err) {
      console.error('Failed to set wallpaper:', err);
      return false;
    }
  }

  private async setWindowsWallpaper(imagePath: string): Promise<boolean> {
    try {
      const absPath = path.resolve(imagePath);
      // PowerShell script to invoke SystemParametersInfoW with SPI_SETDESKWALLPAPER (0x0014)
      const script = `
$path = [System.IO.Path]::GetFullPath('${absPath.replace(/'/g, "''")}');
if (-not (Test-Path $path)) { exit 1; }
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper -Value $path -ErrorAction SilentlyContinue;
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '2' -ErrorAction SilentlyContinue;
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0' -ErrorAction SilentlyContinue;

try {
    $sig = @'
[DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
'@
    $type = Add-Type -MemberDefinition $sig -Name ('WinWall_' + [System.Guid]::NewGuid().ToString('N')) -Namespace Win32 -PassThru -ErrorAction Stop;
    $res = $type::SystemParametersInfo(0x0014, 0, $path, 3);
    if ($res -ne 0) { exit 0; }
} catch {
    # SystemParametersInfoW via Add-Type failed, fallback to refreshing via rundll32
}

try {
    rundll32.exe user32.dll,UpdatePerUserSystemParameters 1, True
    exit 0
} catch {
    exit 1
}
`.trim();

      const b64 = Buffer.from(script, 'utf16le').toString('base64');
      await execAsync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${b64}`);
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

    // 1. KDE Plasma
    if (desktop.includes('kde') || desktop.includes('plasma')) {
      try {
        await execAsync(`plasma-apply-wallpaperimage "${absPath}"`);
        return true;
      } catch {
        try {
          const kdeScript = `for (let i = 0; i < desktops().length; i++) { d = desktops()[i]; d.wallpaperPlugin = "org.kde.image"; d.currentConfigGroup = Array("Wallpaper", "org.kde.image", "General"); d.writeConfig("Image", "${fileUri}"); }`;
          await execAsync(`qdbus org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript '${kdeScript}'`);
          return true;
        } catch {}
      }
    }

    // 2. GNOME / Budgie / Unity
    if (desktop.includes('gnome') || desktop.includes('budgie') || desktop.includes('unity')) {
      try {
        await execAsync(`gsettings set org.gnome.desktop.background picture-uri "${fileUri}"`);
        await execAsync(`gsettings set org.gnome.desktop.background picture-uri-dark "${fileUri}"`).catch(() => {});
        await execAsync(`gsettings set org.gnome.desktop.background picture-options "zoom"`).catch(() => {});
        return true;
      } catch (e) {
        console.warn('GNOME gsettings set failed:', e);
      }
    }

    // 3. Cinnamon
    if (desktop.includes('cinnamon')) {
      try {
        await execAsync(`gsettings set org.cinnamon.desktop.background picture-uri "${fileUri}"`);
        return true;
      } catch {}
    }

    // 4. MATE
    if (desktop.includes('mate')) {
      try {
        await execAsync(`gsettings set org.mate.background picture-filename "${absPath}"`);
        return true;
      } catch {}
    }

    // 5. XFCE
    if (desktop.includes('xfce')) {
      try {
        const { stdout } = await execAsync('xfconf-query -c xfce4-desktop -l');
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.includes('/last-image') || line.includes('/image-path')) {
            await execAsync(`xfconf-query -c xfce4-desktop -p ${line.trim()} -s "${absPath}"`);
          }
        }
        return true;
      } catch {}
    }

    // 6. Wayland Compositors (swww, hyprpaper)
    try {
      await execAsync(`swww img "${absPath}"`);
      return true;
    } catch {}

    // 7. Generic X11 Tools: feh or nitrogen
    try {
      await execAsync(`feh --bg-fill "${absPath}"`);
      return true;
    } catch {
      try {
        await execAsync(`nitrogen --set-zoom-fill "${absPath}" --save`);
        return true;
      } catch {}
    }

    // Final attempt: gsettings
    try {
      await execAsync(`gsettings set org.gnome.desktop.background picture-uri "${fileUri}"`);
      await execAsync(`gsettings set org.gnome.desktop.background picture-uri-dark "${fileUri}"`).catch(() => {});
      return true;
    } catch (e) {
      console.error('All Linux wallpaper mechanisms failed:', e);
      return false;
    }
  }
}
