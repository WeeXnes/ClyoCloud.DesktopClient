#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const isUninstall = process.argv.includes('--uninstall');
const isForce = process.argv.includes('--force');

// When npm runs `npm install` for dependency resolution, it invokes lifecycle scripts
// named "install". In that case, do not run the full desktop installation unless explicit.
const isNpmInstallLifecycle =
  process.env.npm_lifecycle_event === 'install' &&
  process.env.npm_command === 'install' &&
  !isForce;

if (isNpmInstallLifecycle) {
  console.log('\n============================================================');
  console.log('  ClyoCloud Desktop dependencies installed successfully!');
  console.log('  To install ClyoCloud into your system applications & shortcuts:');
  console.log('    npm run install');
  console.log('============================================================\n');
  process.exit(0);
}

function exec(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  cp.execSync(cmd, { stdio: 'inherit', cwd: rootDir, ...opts });
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      if (fs.existsSync(destPath)) {
        try {
          fs.unlinkSync(destPath);
        } catch (_) {
          // On Linux/Windows if file is busy, attempt rename first
          try {
            const tmpBackup = `${destPath}.old-${Date.now()}`;
            fs.renameSync(destPath, tmpBackup);
            try { fs.unlinkSync(tmpBackup); } catch (__) {}
          } catch (__) {}
        }
      }
      fs.copyFileSync(srcPath, destPath);
      try {
        const stat = fs.statSync(srcPath);
        fs.chmodSync(destPath, stat.mode);
      } catch (_) {}
    }
  }
}

function removeDirRecursive(dir) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[!] Could not completely remove directory ${dir}: ${e.message}`);
    }
  }
}

async function run() {
  const platform = os.platform();

  if (isUninstall) {
    console.log('==> Uninstalling ClyoCloud Desktop Client...');
    if (platform === 'linux') {
      const installDir = path.join(os.homedir(), '.local', 'share', 'clyocloud');
      const desktopApp = path.join(os.homedir(), '.local', 'share', 'applications', 'clyocloud.desktop');
      const desktopShortcut = path.join(os.homedir(), 'Desktop', 'clyocloud.desktop');
      const cliSymlink = path.join(os.homedir(), '.local', 'bin', 'clyocloud');
      const iconShare = path.join(os.homedir(), '.local', 'share', 'icons', 'clyocloud.png');
      const iconHicolor = path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'clyocloud.png');

      removeDirRecursive(installDir);
      if (fs.existsSync(desktopApp)) fs.unlinkSync(desktopApp);
      if (fs.existsSync(desktopShortcut)) fs.unlinkSync(desktopShortcut);
      if (fs.existsSync(cliSymlink)) fs.unlinkSync(cliSymlink);
      if (fs.existsSync(iconShare)) fs.unlinkSync(iconShare);
      if (fs.existsSync(iconHicolor)) fs.unlinkSync(iconHicolor);

      try {
        cp.execSync('update-desktop-database ~/.local/share/applications 2>/dev/null || true');
      } catch (_) {}

      console.log('✓ ClyoCloud has been uninstalled successfully.');
    } else if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const installDir = path.join(localAppData, 'Programs', 'ClyoCloud');
      const startMenuDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ClyoCloud');
      const desktopShortcut = path.join(os.homedir(), 'Desktop', 'ClyoCloud.lnk');

      removeDirRecursive(installDir);
      removeDirRecursive(startMenuDir);
      if (fs.existsSync(desktopShortcut)) fs.unlinkSync(desktopShortcut);

      console.log('✓ ClyoCloud has been uninstalled successfully.');
    } else {
      console.log(`Uninstall is not implemented for platform ${platform}.`);
    }
    return;
  }

  console.log('============================================================');
  console.log('       Installing ClyoCloud Desktop Client (npm workflow)   ');
  console.log('============================================================\n');

  // 1. Ensure dependencies installed
  if (!fs.existsSync(path.join(rootDir, 'node_modules'))) {
    console.log('==> Installing npm dependencies...');
    exec('npm install');
  }

  // 2. Build TypeScript and renderer assets
  console.log('\n==> [1/3] Building application bundle...');
  exec('npm run build');

  // 3. Package unpacked binary
  console.log('\n==> [2/3] Packaging native binaries with electron-builder...');
  let payloadSource = '';
  let targetDir = '';
  let targetExecutable = '';

  if (platform === 'linux') {
    exec('npx electron-builder --dir --linux');
    payloadSource = path.join(rootDir, 'release', 'linux-unpacked');
    targetDir = path.join(os.homedir(), '.local', 'share', 'clyocloud');
    targetExecutable = path.join(targetDir, 'clyocloud');
  } else if (platform === 'win32') {
    exec('npx electron-builder --dir --win');
    exec('node scripts/patch-win-exe.js');
    payloadSource = path.join(rootDir, 'release', 'win-unpacked');
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    targetDir = path.join(localAppData, 'Programs', 'ClyoCloud');
    targetExecutable = path.join(targetDir, 'clyocloud.exe');
  } else {
    throw new Error(`Platform ${platform} is not currently supported by ClyoCloud Desktop.`);
  }

  if (!fs.existsSync(payloadSource)) {
    throw new Error(`Expected unpacked build at '${payloadSource}', but directory does not exist.`);
  }

  // 4. Ensure root icons in payload
  const iconPngSrc = fs.existsSync(path.join(rootDir, 'installer', 'app.png'))
    ? path.join(rootDir, 'installer', 'app.png')
    : path.join(rootDir, 'assets', 'icon.png');
  const iconIcoSrc = fs.existsSync(path.join(rootDir, 'installer', 'app.ico'))
    ? path.join(rootDir, 'installer', 'app.ico')
    : path.join(rootDir, 'assets', 'icon.ico');

  if (fs.existsSync(iconPngSrc)) {
    fs.copyFileSync(iconPngSrc, path.join(payloadSource, 'clyocloud.png'));
    fs.copyFileSync(iconPngSrc, path.join(payloadSource, 'icon.png'));
  }
  if (fs.existsSync(iconIcoSrc)) {
    fs.copyFileSync(iconIcoSrc, path.join(payloadSource, 'app.ico'));
    fs.copyFileSync(iconIcoSrc, path.join(payloadSource, 'icon.ico'));
  }

  // 5. Deploy to destination directory
  console.log(`\n==> [3/3] Deploying files to ${targetDir}...`);
  copyDirRecursive(payloadSource, targetDir);

  // 6. Create OS Shortcuts & System Integration
  if (platform === 'linux') {
    // Ensure Linux executables have correct permissions
    const binaries = ['clyocloud', 'chrome_crashpad_handler', 'chrome-sandbox'];
    for (const bin of binaries) {
      const p = path.join(targetDir, bin);
      if (fs.existsSync(p)) {
        try { fs.chmodSync(p, 0o755); } catch (_) {}
      }
    }

    // Copy icon to user icon theme directories for system-wide lookup
    const userIconsDir = path.join(os.homedir(), '.local', 'share', 'icons');
    const hicolorAppsDir = path.join(userIconsDir, 'hicolor', '256x256', 'apps');
    fs.mkdirSync(userIconsDir, { recursive: true });
    fs.mkdirSync(hicolorAppsDir, { recursive: true });

    if (fs.existsSync(iconPngSrc)) {
      try {
        fs.copyFileSync(iconPngSrc, path.join(userIconsDir, 'clyocloud.png'));
        fs.copyFileSync(iconPngSrc, path.join(hicolorAppsDir, 'clyocloud.png'));
      } catch (_) {}
    }

    // Application Menu shortcut
    const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
    fs.mkdirSync(appsDir, { recursive: true });

    const desktopFileContent = `[Desktop Entry]
Version=1.0
Type=Application
Name=ClyoCloud
Comment=ClyoCloud Desktop Client
Exec=${targetExecutable} %U
Icon=${path.join(targetDir, 'clyocloud.png')}
Path=${targetDir}
Terminal=false
StartupNotify=true
StartupWMClass=clyocloud
Categories=Network;FileTransfer;Utility;
`;

    const appDesktopPath = path.join(appsDir, 'clyocloud.desktop');
    fs.writeFileSync(appDesktopPath, desktopFileContent, 'utf8');
    fs.chmodSync(appDesktopPath, 0o755);

    // Desktop shortcut (if Desktop directory exists)
    const desktopDir = path.join(os.homedir(), 'Desktop');
    if (fs.existsSync(desktopDir)) {
      const desktopShortcutPath = path.join(desktopDir, 'clyocloud.desktop');
      fs.writeFileSync(desktopShortcutPath, desktopFileContent, 'utf8');
      fs.chmodSync(desktopShortcutPath, 0o755);
    }

    // CLI symlink in ~/.local/bin/clyocloud
    const binDir = path.join(os.homedir(), '.local', 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const symlinkPath = path.join(binDir, 'clyocloud');
    try {
      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }
      fs.symlinkSync(targetExecutable, symlinkPath);
    } catch (e) {
      console.warn(`[!] Could not create CLI symlink at ${symlinkPath}: ${e.message}`);
    }

    try {
      cp.execSync('update-desktop-database ~/.local/share/applications 2>/dev/null || true');
    } catch (_) {}

    console.log('\n============================================================');
    console.log('✓ ClyoCloud Desktop Client installed successfully!');
    console.log(`  Binary Location:     ${targetExecutable}`);
    console.log(`  Desktop Launcher:    ${appDesktopPath}`);
    console.log(`  Terminal Command:    clyocloud (via ~/.local/bin/clyocloud)`);
    console.log('============================================================\n');

  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const startMenuDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ClyoCloud');
    fs.mkdirSync(startMenuDir, { recursive: true });

    const startMenuShortcut = path.join(startMenuDir, 'ClyoCloud.lnk');
    const iconPath = path.join(targetDir, 'app.ico');

    const makeShortcutPs = (shortcutPath) => `
      $ws = New-Object -ComObject WScript.Shell;
      $s = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}');
      $s.TargetPath = '${targetExecutable.replace(/'/g, "''")}';
      $s.WorkingDirectory = '${targetDir.replace(/'/g, "''")}';
      $s.IconLocation = '${iconPath.replace(/'/g, "''")},0';
      $s.Description = 'ClyoCloud Desktop Client';
      $s.Save();
    `.replace(/\r?\n\s*/g, ' ');

    try {
      cp.execSync(`powershell -NoProfile -Command "${makeShortcutPs(startMenuShortcut)}"`, { stdio: 'inherit' });
    } catch (e) {
      console.warn(`[!] Failed to create Start Menu shortcut: ${e.message}`);
    }

    const desktopDir = path.join(os.homedir(), 'Desktop');
    if (fs.existsSync(desktopDir)) {
      const desktopShortcut = path.join(desktopDir, 'ClyoCloud.lnk');
      try {
        cp.execSync(`powershell -NoProfile -Command "${makeShortcutPs(desktopShortcut)}"`, { stdio: 'inherit' });
      } catch (e) {
        console.warn(`[!] Failed to create Desktop shortcut: ${e.message}`);
      }
    }

    console.log('\n============================================================');
    console.log('✓ ClyoCloud Desktop Client installed successfully!');
    console.log(`  Installation Directory: ${targetDir}`);
    console.log(`  Executable:             ${targetExecutable}`);
    console.log(`  Start Menu:             ${startMenuShortcut}`);
    console.log('============================================================\n');
  }
}

run().catch((err) => {
  console.error('\n[X] Installation failed:', err);
  process.exit(1);
});
