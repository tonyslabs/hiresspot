import { createContext, useContext, type ReactNode } from 'react';
import type { PlatformAPI } from '@hiresspot/core';

const PlatformContext = createContext<PlatformAPI | null>(null);

export const PlatformProvider = ({ platform, children }: { platform: PlatformAPI; children: ReactNode }) => (
  <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
);

export const usePlatform = (): PlatformAPI => {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('usePlatform: falta <PlatformProvider>');
  return platform;
};
