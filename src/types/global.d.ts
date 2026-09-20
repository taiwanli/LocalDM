import type { LocalDmBridge } from '@shared/ipc';

declare global {
  interface Window {
    localdm?: LocalDmBridge;
  }
}

export {};
