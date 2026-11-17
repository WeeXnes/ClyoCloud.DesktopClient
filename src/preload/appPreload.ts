import { contextBridge, ipcRenderer } from 'electron';

// The app window shows the server's web UI. Only the bundled offline/setup page (file://)
// gets this small bridge; remote pages get nothing.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('clyoDesktop', {
    connect: (serverUrl: string) => ipcRenderer.invoke('app-window-connect', serverUrl),
    retry: () => ipcRenderer.invoke('app-window-connect', ''),
  });
}
