# 🌌 ClyoCloud Desktop Client (Windows & Linux)

A lightweight, high-performance companion application for **ClyoCloud**, delivering 100% feature and visual parity with the native macOS client for both **Windows 10/11** and **Linux** desktop environments.

It lives in your system notification tray with a frosted-glass popover, real-time two-way folder synchronization, drag-and-drop cloud uploads, 1-click cloud wallpaper desktop management, an instant clipboard uploader with global hotkey support, and standalone wizard installers built with **InstallerFramework**.

---

## 🚀 Key Features

* **⚡ Native System Tray Integration**:
  * Clean monochrome tray icon (cloud idle, active rotating blue sync icon during transfers).
  * Left-click opens the frosted-glass popover anchored to the tray; right-click opens a quick utility context menu (`Open Web`, `Sync All Now`, `Upload Clipboard`, `Preferences`, `Quit`).
  * Seamless auto-hide on blur (clicking outside the window), matching macOS NSPopover behavior (automatically disabled on tiling environments like HyDE/Hyprland so the window remains open alongside other desktop windows).

* **📂 Drag-and-Drop Upload Zone**:
  * Glassmorphic drag target accepting multiple files or folders from Windows File Explorer / Linux file managers.
  * Destination folder picker (upload to cloud root `/` or any specific remote folder).
  * Real-time transfer progress tracking and recent activity history.

* **🖼️ Cloud Desktop Wallpaper Gallery**:
  * Dedicated scrollable 2-column grid fetching cloud wallpapers from `/api/wallpapers`.
  * Authenticated thumbnail caching via `/thumbnail/{path}` with fallback to `/file/{path}`.
  * Instant 1-click **"Set as Desktop"** action with native OS integrations:
    * **Windows**: Sets wallpaper via `user32.dll` `SystemParametersInfoW`.
    * **Linux**: Automatic detection and native configuration for GNOME, KDE Plasma, XFCE, MATE, Cinnamon, and X11 tools (`feh`, `nitrogen`).
  * Dynamic visual feedback ("Applied!" with checkmark).
  * **HyDE (Hyprland) support**: when `~/.config/hyde/themes` exists, the button becomes **"Add Wallpaper to Theme"** and only downloads the image into the active theme's `wallpapers/` folder (theme read from `~/.local/state/hyde/staterc`). It never changes the current wallpaper; pick it yourself with HyDE's wallpaper selector.

* **🔄 Real-Time Two-Way Folder Synchronization**:
  * Cross-platform kernel filesystem monitoring via **chokidar** (`ReadDirectoryChangesW` on Windows, `inotify` on Linux) with zero CPU overhead.
  * Two-way differential reconciliation engine comparing remote files (`/api/files`) against local directories.
  * **Phase 1 Local Rename Detection**: Detects file renames and moves locally and executes server-side renames (`/api/rename`) without re-uploading large data.
  * **Phase 2 3-Way Reconciliation**: Handles additions, modifications, remote downloads, local uploads, and conflicts (preserving local copies as `(Conflict <timestamp>)`).
  * Automatic exclusion of metadata and temp files (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `.cloudinfo`, `.tmp`, `.crdownload`).

* **📸 Screenshot & Clipboard Uploader**:
  * Click **"Upload Clipboard"** or press **`Ctrl + Alt + U`** (or `Cmd + Alt + U`) anywhere on your system to grab the image from your clipboard, upload it directly to ClyoCloud, copy the shareable file URL back to your clipboard, and fire an OS desktop notification.

* **🔑 Dual Authentication**:
  * **Quick Device Token / QR Payload**: Paste a device token or QR JSON payload from ClyoCloud settings. Automatically reports device model (e.g. `Windows 11 (build 22631, x64)` or `Linux (Ubuntu 24.04, x64)`) to the server.
  * **Standard Credentials**: Username and password with support for TOTP 2FA codes and recovery scratch keys.
  * Tokens stored securely via Electron `safeStorage` (Windows DPAPI / Linux Secret Service) with restricted permissions fallback.

* **📦 Modern Installer Wizards (InstallerFramework)**:
  * Single-file, standalone setup wizards for Windows (`ClyoCloud-Setup-Windows.exe`) and Linux (`ClyoCloud-Setup-Linux`) built using [InstallerFramework](https://code.weexnes.dev/InstallerFramework.git) (Avalonia UI).
  * Features welcome page, license agreement, destination directory selection, shortcut creation, live extraction progress bar, and completion launch.

* **🚀 Launch at System Login**:
  * Automatic boot configuration supporting:
    * **Windows**: Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` and Electron login item settings.
    * **Linux**: XDG Autostart `~/.config/autostart/clyocloud.desktop`.

---

## 🛠 Building & Running

### Prerequisites
* Node.js 18+ (tested on Node 24)
* npm 9+
* .NET SDK 8.0+ (for building installer wizards)

### Build & Run
```bash
cd DesktopClient

# Install dependencies (if not already installed)
npm install

# Compile TypeScript and bundle assets
npm run build

# Launch the desktop client
npm start
```

### Direct System Installation (Clone & Install)
You can install ClyoCloud directly into your desktop environment with application launcher shortcuts, desktop icons, and terminal command integration identical to running the setup wizard:

```bash
git clone https://code.weexnes.dev/ClyoCloud/DesktopClient.git
cd DesktopClient
npm install
npm run install   # or 'make install'
```

To remove the installation:
```bash
npm run uninstall # or 'make uninstall'
```

### Packaging Binaries & Installers

#### 1. Quick Installer Build (All Platforms)
```bash
# Setup the installer framework environment
make installer-setup

# Build both Linux & Windows single-file installers
make installer-all
```
Output files will be generated in `installer/publish/`:
* Windows: `installer/publish/win-x64/ClyoCloud-Setup-Windows.exe`
* Linux: `installer/publish/linux-x64/ClyoCloud-Setup-Linux`

#### 2. Individual Platform Builds
* **Linux Installer Only**: `make installer-linux`
* **Windows Installer Only**: `make installer-win`
* **Direct Electron Packages**: `make package-linux` or `make package-win`

---

## 🔄 OneDev CI/CD Pipeline

The repository includes a ready-to-run [`.onedev-buildspec.yml`](file:///home/coder/ClyoDev/DesktopClient/.onedev-buildspec.yml) configured with the `Builder` job executor. It automatically:
1. Checks out the code repository
2. Runs `npm install` and `npm run build`
3. Packages unpacked application payloads for Linux and Windows (`electron-builder --dir`)
4. Clones and configures `InstallerFramework`
5. Compiles standalone single-file installer wizards (`ClyoCloud-Setup-Windows.exe` and `ClyoCloud-Setup-Linux`)
6. Extracts the current version from `package.json` into `version.txt`
7. Publishes all installer binaries as build artifacts in OneDev

---

## 📁 Project Architecture

```
DesktopClient/
├── .onedev-buildspec.yml      # Automated OneDev CI/CD pipeline
├── package.json               # Dependencies, build scripts, electron-builder config
├── tsconfig.json              # TypeScript configuration
├── Makefile                   # Quick build, run, package, and installer targets
├── scripts/
│   └── build.js               # Esbuild compilation & asset pipeline
├── assets/                    # App & tray icons
│   ├── icon.png               # ClyoCloud application icon (1024x1024)
│   ├── icon.ico               # Windows application icon
│   ├── tray-idle.png          # Monochrome tray icon (cloud)
│   └── tray-syncing.png       # Animated/active tray icon (sync)
├── installer/                 # Standalone InstallerFramework project
│   ├── ClyoCloudInstaller.csproj # .NET 8 installer project definition
│   ├── Program.cs             # Fluent installer wizard definition (Avalonia UI)
│   ├── setup.sh / setup.ps1   # InstallerFramework clone & restore script
│   └── build.sh / build.ps1   # Single-file installer publish script
└── src/
    ├── shared/
    │   └── types.ts           # Shared data models (ClyoFile, ServerStats, SyncFolderPair)
    ├── main/
    │   ├── index.ts           # App lifecycle, single-instance lock, IPC handlers
    │   ├── tray.ts            # Tray creation, context menu, popover positioning & toggling
    │   ├── api/
    │   │   └── clyoApi.ts     # REST API client (login, 2FA, files, stats, upload, download)
    │   ├── sync/
    │   │   ├── syncEngine.ts  # 2-way differential sync engine (rename detection, 3-way reconciliation)
    │   │   ├── watcher.ts     # chokidar filesystem watcher with debounce
    │   │   └── manifest.ts    # Per-pair state manifest manager
    │   ├── platform/
    │   │   ├── wallpaper.ts   # Windows (user32.dll) & Linux (GNOME/KDE/XFCE/feh) wallpaper setter
    │   │   ├── hyde.ts        # HyDE detection: download wallpapers into the active theme folder
    │   │   ├── autostart.ts   # Windows Registry & Linux XDG autostart manager
    │   │   └── device.ts      # OS release & device model detection
    │   ├── clipboard/
    │   │   └── uploader.ts    # Clipboard image grab, upload, share link copy, notification
    │   └── storage/
    │       ├── settings.ts    # Settings persistence (settings.json)
    │       └── secureStore.ts # Safe storage (DPAPI/libsecret with fallback)
    ├── preload/
    │   └── preload.ts         # Secure typed contextBridge API
    └── renderer/
        ├── index.html         # Popover UI layout
        ├── styles/
        │   ├── main.css       # Frosted glass design system, typography, animations
        │   └── components.css # Tabs, dropzone, cards, modal, switches
        └── src/
            └── app.ts         # Reactive state manager, tabs controller, UI logic
```
