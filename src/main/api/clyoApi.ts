import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { ClyoFile, ServerStats } from '../../shared/types';
import { SettingsManager } from '../storage/settings';
import { SecureStore } from '../storage/secureStore';
import { getDeviceModelString } from '../platform/device';

export class ClyoAPIClient {
  private static instance: ClyoAPIClient;
  private thumbnailCache: Map<string, string> = new Map(); // Base64 data URLs

  private constructor() {}

  public static getInstance(): ClyoAPIClient {
    if (!ClyoAPIClient.instance) {
      ClyoAPIClient.instance = new ClyoAPIClient();
    }
    return ClyoAPIClient.instance;
  }

  private getBaseUrl(): string {
    let base = SettingsManager.getInstance().getServerUrl().trim();
    if (!base) {
      base = 'http://localhost:6969';
    }
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      if (base.startsWith('localhost') || base.startsWith('127.0.0.1') || /^192\.168\./.test(base) || /^10\./.test(base)) {
        base = `http://${base}`;
      } else {
        base = `https://${base}`;
      }
    }
    if (base.endsWith('/')) {
      base = base.slice(0, -1);
    }
    return base;
  }

  private async safeFetch(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err: any) {
      if (err.name === 'TypeError' && err.message === 'fetch failed') {
        const cause = err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : '';
        throw new Error(`Cannot reach server at ${this.getBaseUrl()}${cause ? ` (${cause})` : ''}. Please check the server address and network.`);
      }
      throw err;
    }
  }

  private getAuthToken(): string | null {
    const username = SettingsManager.getInstance().getUsername();
    if (!username) return null;
    return SecureStore.getInstance().readToken(username);
  }

  private makeHeaders(tokenOverride?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'ClyoDesktopClient/1.0',
      'X-Device-Model': getDeviceModelString()
    };
    const token = tokenOverride || this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  public async login(username: string, password: string): Promise<{ token?: string; requires2fa?: boolean; tempToken?: string }> {
    const url = `${this.getBaseUrl()}/api/login`;
    const res = await this.safeFetch(url, {
      method: 'POST',
      headers: {
        ...this.makeHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.statusMessage || data.message || data.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    if (data.requires2fa) {
      return { requires2fa: true, tempToken: data.tempToken };
    }
    if (data.token) {
      return { token: data.token };
    }
    throw new Error('Unexpected login response format');
  }

  public async verify2FA(tempToken: string, code: string): Promise<string> {
    const url = `${this.getBaseUrl()}/api/2fa/verify-login`;
    const res = await this.safeFetch(url, {
      method: 'POST',
      headers: {
        ...this.makeHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tempToken, code, token: code })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.statusMessage || data.message || data.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    if (data.token) {
      return data.token;
    }
    throw new Error('Verification failed');
  }

  public async verifyToken(token: string): Promise<boolean> {
    try {
      const url = `${this.getBaseUrl()}/api/verify`;
      const res = await this.safeFetch(url, {
        headers: this.makeHeaders(token)
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  public async fetchFiles(remotePath: string = ''): Promise<ClyoFile[]> {
    const url = new URL(`${this.getBaseUrl()}/api/files`);
    if (remotePath) {
      url.searchParams.set('path', remotePath);
    }
    const res = await this.safeFetch(url.toString(), {
      headers: this.makeHeaders()
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch files: HTTP ${res.status}`);
    }
    return (await res.json()) as ClyoFile[];
  }

  public async fetchWallpapers(): Promise<ClyoFile[]> {
    const url = `${this.getBaseUrl()}/api/wallpapers`;
    const res = await this.safeFetch(url, {
      headers: this.makeHeaders()
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch wallpapers: HTTP ${res.status}`);
    }
    return (await res.json()) as ClyoFile[];
  }

  public async fetchStats(): Promise<ServerStats> {
    const url = `${this.getBaseUrl()}/api/stats`;
    const res = await this.safeFetch(url, {
      headers: this.makeHeaders()
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch server stats: HTTP ${res.status}`);
    }
    return (await res.json()) as ServerStats;
  }

  public async createFolder(folderName: string, remotePath: string): Promise<void> {
    const url = `${this.getBaseUrl()}/api/folder`;
    const res = await this.safeFetch(url, {
      method: 'POST',
      headers: {
        ...this.makeHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ folderName, path: remotePath })
    });
    if (!res.ok) {
      throw new Error(`Failed to create folder: HTTP ${res.status}`);
    }
  }

  public async renameFile(oldPath: string, newName: string): Promise<void> {
    const url = `${this.getBaseUrl()}/api/rename`;
    const res = await this.safeFetch(url, {
      method: 'POST',
      headers: {
        ...this.makeHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ oldPath, newName })
    });
    if (!res.ok) {
      throw new Error(`Failed to rename file: HTTP ${res.status}`);
    }
  }

  public async deleteFile(remotePath: string, permanent: boolean = false): Promise<void> {
    const url = `${this.getBaseUrl()}/api/files`;
    const res = await this.safeFetch(url, {
      method: 'DELETE',
      headers: {
        ...this.makeHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: remotePath, permanent })
    });
    if (!res.ok) {
      throw new Error(`Failed to delete file: HTTP ${res.status}`);
    }
  }

  public async uploadFiles(filePaths: string[], remotePath: string): Promise<void> {
    const url = `${this.getBaseUrl()}/api/upload`;
    const formData = new FormData();
    formData.append('path', remotePath);

    for (const filePath of filePaths) {
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) continue;

      const buffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);
      const mimeType = (mime.lookup(filePath) as string) || 'application/octet-stream';
      const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
      formData.append('files', blob, filename);
    }

    const res = await this.safeFetch(url, {
      method: 'POST',
      headers: this.makeHeaders(),
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Upload failed: HTTP ${res.status}`);
    }
  }

  public async uploadBuffer(buffer: Buffer, filename: string, remotePath: string, mimeType: string = 'image/png'): Promise<void> {
    const url = `${this.getBaseUrl()}/api/upload`;
    const formData = new FormData();
    formData.append('path', remotePath);

    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append('files', blob, filename);

    const res = await this.safeFetch(url, {
      method: 'POST',
      headers: this.makeHeaders(),
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Upload failed: HTTP ${res.status}`);
    }
  }

  public async downloadFile(remoteFilePath: string, localDestination: string): Promise<void> {
    const cleaned = remoteFilePath.replace(/^\/+/, '');
    const encoded = encodeURI(cleaned);
    const url = `${this.getBaseUrl()}/file/${encoded}`;

    const res = await this.safeFetch(url, {
      headers: this.makeHeaders()
    });

    if (!res.ok) {
      throw new Error(`Download failed: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const dir = path.dirname(localDestination);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(localDestination, buffer);
  }

  public async fetchThumbnailDataUrl(remotePath: string): Promise<string | null> {
    const cleaned = remotePath.replace(/^\/+/, '');
    if (this.thumbnailCache.has(cleaned)) {
      return this.thumbnailCache.get(cleaned)!;
    }

    const encoded = encodeURI(cleaned);
    // 1. Try /thumbnail first
    try {
      const thumbUrl = `${this.getBaseUrl()}/thumbnail/${encoded}`;
      const res = await this.safeFetch(thumbUrl, { headers: this.makeHeaders() });
      if (res.ok) {
        const ct = res.headers.get('content-type') || 'image/jpeg';
        const buffer = Buffer.from(await res.arrayBuffer());
        const dataUrl = `data:${ct};base64,${buffer.toString('base64')}`;
        this.thumbnailCache.set(cleaned, dataUrl);
        return dataUrl;
      }
    } catch {
      // fallback
    }

    // 2. Fallback to /file
    try {
      const fileUrl = `${this.getBaseUrl()}/file/${encoded}`;
      const res = await this.safeFetch(fileUrl, { headers: this.makeHeaders() });
      if (res.ok) {
        const ct = res.headers.get('content-type') || 'image/jpeg';
        const buffer = Buffer.from(await res.arrayBuffer());
        const dataUrl = `data:${ct};base64,${buffer.toString('base64')}`;
        this.thumbnailCache.set(cleaned, dataUrl);
        return dataUrl;
      }
    } catch {
      // ignore
    }

    return null;
  }

  public getShareableFileUrl(remotePath: string): string {
    const cleaned = remotePath.replace(/^\/+/, '');
    return `${this.getBaseUrl()}/file/${encodeURI(cleaned)}`;
  }
}
