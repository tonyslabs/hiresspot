import { contextBridge, ipcRenderer } from 'electron';
import type { PlatformAPI } from '@hiresspot/core';

const api: PlatformAPI = {
  library: {
    getRoots: () => ipcRenderer.invoke('library:getRoots'),
    addRoot: () => ipcRenderer.invoke('library:addRoot'),
    removeRoot: (root) => ipcRenderer.invoke('library:removeRoot', root),
    scan: (root) => ipcRenderer.invoke('library:scan', root)
  },
  media: {
    urlFor: (track) => `hires-media://audio/${encodeURIComponent(track.path ?? track.sourceId)}`,
    sanitizedFlacUrl: (upstreamUrl) => `hires-media://flac/${encodeURIComponent(upstreamUrl)}`,
    coverPixels: async (url) => {
      const r = (await ipcRenderer.invoke('media:coverPixels', url)) as { width: number; height: number; data: Uint8Array } | null;
      return r ? { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) } : null;
    }
  },
  http: (url, options) => ipcRenderer.invoke('http:request', url, { timeoutMs: options?.timeoutMs }),
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },
  secrets: {
    isAvailable: () => ipcRenderer.invoke('secrets:isAvailable'),
    get: (key) => ipcRenderer.invoke('secrets:get', key),
    set: (key, value) => ipcRenderer.invoke('secrets:set', key, value),
    delete: (key) => ipcRenderer.invoke('secrets:delete', key)
  },
  power: {
    setPlaying: (playing) => ipcRenderer.invoke('power:playing', !!playing)
  },
  spotify: {
    status: () => ipcRenderer.invoke('spotify:status'),
    login: () => ipcRenderer.invoke('spotify:login'),
    logout: () => ipcRenderer.invoke('spotify:logout'),
    api: (path) => ipcRenderer.invoke('spotify:api', path)
  }
};

contextBridge.exposeInMainWorld('hiresspot', api);
