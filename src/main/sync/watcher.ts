import fs from 'fs';
import chokidar, { FSWatcher } from 'chokidar';

export class FolderWatcher {
  private watcher: FSWatcher | null = null;
  private paths: string[] = [];
  private onChangeCallback: () => void;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(onChange: () => void) {
    this.onChangeCallback = onChange;
  }

  public watchPaths(paths: string[]): void {
    this.stop();

    const validPaths = paths.filter(p => fs.existsSync(p));
    this.paths = validPaths;
    if (validPaths.length === 0) return;

    this.watcher = chokidar.watch(validPaths, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        /\.DS_Store$/,
        /Thumbs\.db$/,
        /desktop\.ini$/,
        /\.cloudinfo$/,
        /\.crdownload$/,
        /\.tmp$/
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 200
      }
    });

    this.watcher.on('all', () => {
      this.triggerChange();
    });
  }

  private triggerChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.onChangeCallback();
    }, 2000);
  }

  public stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
    }
  }
}
