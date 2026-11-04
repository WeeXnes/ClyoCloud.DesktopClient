import os from 'os';
import path from 'path';
import fs from 'fs';
import { AddToHydeThemeResult, ClyoFile, WallpaperMode } from '../../shared/types';
import { ClyoAPIClient } from '../api/clyoApi';

/**
 * HyDE (https://github.com/HyDE-Project/HyDE) support.
 *
 * HyDE keeps every theme's wallpapers in `$XDG_CONFIG_HOME/hyde/themes/<Theme>/wallpapers`
 * and lets the user pick one through its own wallpaper selector. On HyDE we therefore never
 * apply a wallpaper ourselves; we only download it into the active theme's wallpaper folder.
 */

function configHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function stateHome(): string {
  return process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
}

function hydeThemesDir(): string {
  return path.join(configHome(), 'hyde', 'themes');
}

/** Reads `HYDE_THEME=...` from a shell-style key/value file. */
function readThemeFromFile(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Last assignment wins, like when the file is sourced by a shell.
    let theme: string | null = null;
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?HYDE_THEME\s*=\s*(.*?)\s*$/);
      if (m) {
        const value = m[1].replace(/^(['"])(.*)\1$/, '$2').trim();
        if (value) theme = value;
      }
    }
    return theme;
  } catch {
    return null;
  }
}

function isValidThemeName(name: string): boolean {
  return name.length > 0 && name === path.basename(name) && name !== '.' && name !== '..';
}

export function isHydeInstalled(): boolean {
  if (os.platform() !== 'linux') return false;
  try {
    return fs.statSync(hydeThemesDir()).isDirectory();
  } catch {
    return false;
  }
}

/** Returns the currently selected HyDE theme, or null if it can't be determined. */
export function getActiveHydeTheme(): string | null {
  if (!isHydeInstalled()) return null;

  const candidates = [
    path.join(stateHome(), 'hyde', 'staterc'),
    path.join(stateHome(), 'hyde', 'config'),
    path.join(configHome(), 'hyde', 'hyde.conf'),
  ];

  for (const file of candidates) {
    const theme = readThemeFromFile(file);
    if (theme && isValidThemeName(theme) && fs.existsSync(path.join(hydeThemesDir(), theme))) {
      return theme;
    }
  }
  return null;
}

export function getWallpaperMode(): WallpaperMode {
  if (!isHydeInstalled()) return { mode: 'default' };
  return { mode: 'hyde', hydeTheme: getActiveHydeTheme() ?? undefined };
}

/** Picks a free filename in `dir`, appending " (n)" before the extension on collision. */
function uniquePath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${i})${ext}`);
    i++;
  }
  return candidate;
}

/**
 * Downloads the given cloud wallpaper into the active HyDE theme's `wallpapers` folder.
 * Does NOT change the current wallpaper.
 */
export async function addWallpaperToHydeTheme(file: ClyoFile): Promise<AddToHydeThemeResult> {
  // Resolve the theme at click time so a theme switch while the app is open is respected.
  const theme = getActiveHydeTheme();
  if (!theme) {
    return { success: false, message: 'Could not determine the active HyDE theme' };
  }

  const wallDir = path.join(hydeThemesDir(), theme, 'wallpapers');
  try {
    fs.mkdirSync(wallDir, { recursive: true });

    const filename = path.basename(file.name.replace(/\\/g, '/')).replace(/\0/g, '');
    if (!filename || filename === '.' || filename === '..') {
      return { success: false, theme, message: 'Invalid wallpaper filename' };
    }

    // Same name + same size already in the theme: treat as already added.
    const existing = path.join(wallDir, filename);
    if (fs.existsSync(existing)) {
      const stats = fs.statSync(existing);
      if (file.size && stats.size === file.size) {
        return { success: true, theme, localPath: existing, alreadyExisted: true, message: `Already in ${theme}` };
      }
    }

    const target = uniquePath(wallDir, filename);
    // Download to a hidden temp file first so HyDE never sees a half-written image.
    const tmp = path.join(wallDir, `.${path.basename(target)}.clyo-part`);
    try {
      await ClyoAPIClient.getInstance().downloadFile(file.name, tmp);
      fs.renameSync(tmp, target);
    } finally {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    }

    return { success: true, theme, localPath: target, message: `Added to ${theme}` };
  } catch (err: any) {
    console.error('Failed to add wallpaper to HyDE theme:', err);
    return { success: false, theme, message: err?.message || 'Download failed' };
  }
}
