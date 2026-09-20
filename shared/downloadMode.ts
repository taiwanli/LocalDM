import type { DownloadMode, DownloadModePreset } from '../shared/types';
import { DOWNLOAD_MODE_PRESETS } from '../shared/types';

export function resolveDownloadMode(mode: unknown): DownloadMode {
  return mode === 'default' || mode === 'turbo' || mode === 'balanced'
    ? mode
    : 'balanced';
}

export function downloadModePreset(mode: unknown): DownloadModePreset {
  return DOWNLOAD_MODE_PRESETS[resolveDownloadMode(mode)];
}

/** Apply mode preset onto connection/concurrency fields (preset wins when set). */
export function applyModeToEngineDeps<T extends {
  maxConnections?: number;
  maxConnectionsPerServer?: number;
  maxConcurrentTasks?: number;
}>(deps: T, mode: unknown): T {
  const preset = downloadModePreset(mode);
  return {
    ...deps,
    maxConnections: preset.maxConnections,
    maxConnectionsPerServer: preset.maxConnectionsPerServer,
    maxConcurrentTasks: preset.maxConcurrentTasks,
  };
}
