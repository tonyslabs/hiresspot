import { contextBridge, ipcRenderer } from 'electron';
import { pathToFileURL } from 'node:url';

const api = {
  spotify: {
    login: () => ipcRenderer.invoke('spotify:login') as Promise<string>,
    logout: () => ipcRenderer.invoke('spotify:logout') as Promise<string>
  },
  system: {
    openFolderDialog: () => ipcRenderer.invoke('system:openFolderDialog') as Promise<string | null>
  },
  library: {
    scanFolder: (dir: string) => ipcRenderer.invoke('library:scanFolder', dir) as Promise<Track[]>
  },
  utils: {
    toFileURL: (p: string) => `local-audio://${pathToFileURL(p).pathname}`
  },
  file: {
    read: async (path: string): Promise<ArrayBuffer> => {
      const buf: Buffer = await ipcRenderer.invoke('file:read', path);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  }
};

contextBridge.exposeInMainWorld('api', api);
