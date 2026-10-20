import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { SyncManifest } from '../../shared/types';

export class SyncManifestManager {
  private static instance: SyncManifestManager;
  private manifestsDir: string;

  private constructor() {
    this.manifestsDir = path.join(app.getPath('userData'), 'manifests');
    if (!fs.existsSync(this.manifestsDir)) {
      try {
        fs.mkdirSync(this.manifestsDir, { recursive: true });
      } catch (e) {
        console.error('Failed to create manifests directory:', e);
      }
    }
  }

  public static getInstance(): SyncManifestManager {
    if (!SyncManifestManager.instance) {
      SyncManifestManager.instance = new SyncManifestManager();
    }
    return SyncManifestManager.instance;
  }

  private manifestPath(pairId: string): string {
    const safeId = pairId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.manifestsDir, `${safeId}.json`);
  }

  public loadManifest(pairId: string): SyncManifest {
    const filePath = this.manifestPath(pairId);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error(`Failed to load manifest for pair ${pairId}:`, e);
    }
    return { items: {} };
  }

  public saveManifest(pairId: string, manifest: SyncManifest): void {
    const filePath = this.manifestPath(pairId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf8');
    } catch (e) {
      console.error(`Failed to save manifest for pair ${pairId}:`, e);
    }
  }

  public removeManifest(pairId: string): void {
    const filePath = this.manifestPath(pairId);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.error(`Failed to remove manifest for pair ${pairId}:`, e);
    }
  }
}
