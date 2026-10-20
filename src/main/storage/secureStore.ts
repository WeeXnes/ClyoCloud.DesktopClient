import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';

export class SecureStore {
  private static instance: SecureStore;
  private memoryCache: Map<string, string> = new Map();
  private tokenDir: string;

  private constructor() {
    this.tokenDir = path.join(app.getPath('userData'), 'tokens');
    if (!fs.existsSync(this.tokenDir)) {
      try {
        fs.mkdirSync(this.tokenDir, { recursive: true, mode: 0o700 });
      } catch (e) {
        console.error('Failed to create tokens directory:', e);
      }
    }
  }

  public static getInstance(): SecureStore {
    if (!SecureStore.instance) {
      SecureStore.instance = new SecureStore();
    }
    return SecureStore.instance;
  }

  private tokenPath(account: string): string {
    const safeAccount = account.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.tokenDir, `token_${safeAccount}.dat`);
  }

  public saveToken(account: string, token: string): void {
    this.memoryCache.set(account, token);

    try {
      const filePath = this.tokenPath(account);
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(token);
        fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
      } else {
        // Fallback to base64 with restricted 0600 permissions
        const encoded = Buffer.from(token, 'utf8').toString('base64');
        fs.writeFileSync(filePath, encoded, { encoding: 'utf8', mode: 0o600 });
      }
    } catch (e) {
      console.error('Failed to securely persist token:', e);
    }
  }

  public readToken(account: string): string | null {
    if (this.memoryCache.has(account)) {
      return this.memoryCache.get(account) || null;
    }

    try {
      const filePath = this.tokenPath(account);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const buffer = fs.readFileSync(filePath);
        try {
          const decrypted = safeStorage.decryptString(buffer);
          this.memoryCache.set(account, decrypted);
          return decrypted;
        } catch {
          // If decryption fails (e.g. was stored unencrypted or on different key), attempt base64 fallback
          const raw = buffer.toString('utf8');
          const decoded = Buffer.from(raw, 'base64').toString('utf8');
          if (decoded && decoded.includes('.')) {
            this.memoryCache.set(account, decoded);
            return decoded;
          }
        }
      } else {
        const raw = fs.readFileSync(filePath, 'utf8');
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        if (decoded) {
          this.memoryCache.set(account, decoded);
          return decoded;
        }
      }
    } catch (e) {
      console.error('Failed to read secure token:', e);
    }
    return null;
  }

  public deleteToken(account: string): void {
    this.memoryCache.delete(account);
    try {
      const filePath = this.tokenPath(account);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      console.error('Failed to delete token file:', e);
    }
  }
}
