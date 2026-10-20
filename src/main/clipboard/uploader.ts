import { clipboard, Notification } from 'electron';
import { ClyoAPIClient } from '../api/clyoApi';

export class ClipboardUploader {
  private static instance: ClipboardUploader;
  public isUploading: boolean = false;
  public statusMessage: string | null = null;

  private constructor() {}

  public static getInstance(): ClipboardUploader {
    if (!ClipboardUploader.instance) {
      ClipboardUploader.instance = new ClipboardUploader();
    }
    return ClipboardUploader.instance;
  }

  public async uploadClipboardImage(destinationPath: string = ''): Promise<{ success: boolean; message: string; url?: string }> {
    this.isUploading = true;
    this.statusMessage = 'Reading clipboard...';

    try {
      const image = (clipboard as any).readImage();
      if (image.isEmpty()) {
        const msg = 'No image on clipboard. Copy an image or take a screenshot first.';
        this.statusMessage = msg;
        this.notify('ClyoCloud', msg);
        this.isUploading = false;
        return { success: false, message: msg };
      }

      const pngBuffer = image.toPNG();
      if (!pngBuffer || pngBuffer.length === 0) {
        const msg = 'Failed to extract image from clipboard';
        this.statusMessage = msg;
        this.isUploading = false;
        return { success: false, message: msg };
      }

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `Screenshot_${timestamp}.png`;

      this.statusMessage = `Uploading ${filename}...`;
      await ClyoAPIClient.getInstance().uploadBuffer(pngBuffer, filename, destinationPath, 'image/png');

      const fullRemotePath = destinationPath ? `${destinationPath.replace(/^\/+|\/+$/g, '')}/${filename}` : filename;
      const fileUrl = ClyoAPIClient.getInstance().getShareableFileUrl(fullRemotePath);

      // Copy share URL directly to system clipboard
      clipboard.writeText(fileUrl);

      const successMsg = `Uploaded ${filename} to ClyoCloud. Link copied to clipboard!`;
      this.statusMessage = successMsg;
      this.notify('Upload Succeeded', successMsg);
      this.isUploading = false;
      return { success: true, message: successMsg, url: fileUrl };
    } catch (e: any) {
      const errMsg = `Upload failed: ${e?.message || e}`;
      this.statusMessage = errMsg;
      this.notify('Upload Failed', errMsg);
      this.isUploading = false;
      return { success: false, message: errMsg };
    }
  }

  private notify(title: string, body: string): void {
    if (Notification.isSupported()) {
      new Notification({
        title,
        body,
        silent: false
      }).show();
    }
  }
}
