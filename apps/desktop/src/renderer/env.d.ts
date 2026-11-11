import type { PlatformAPI } from '@hiresspot/core';

declare global {
  interface Window {
    /** Expuesto por el preload (contextBridge). */
    hiresspot: PlatformAPI;
  }
}

export {};
