import type { DownloadMode, DownloadModePreset } from './types';
import { DOWNLOAD_MODE_PRESETS } from './types';

export function resolveDownloadMode(mode: unknown): DownloadMode {
  return mode === 'default' ||
    mode === 'turbo' ||
    mode === 'balanced' ||
    mode === 'adaptive'
    ? mode
    : 'adaptive';
}

export function downloadModePreset(mode: unknown): DownloadModePreset {
  return DOWNLOAD_MODE_PRESETS[resolveDownloadMode(mode)];
}

/** Apply mode preset onto connection/concurrency fields (preset wins when set). */
export function applyModeToEngineDeps<
  T extends {
    maxConnections?: number;
    maxConnectionsPerServer?: number;
    maxConcurrentTasks?: number;
  },
>(deps: T, mode: unknown): T {
  const preset = downloadModePreset(mode);
  if (preset.useSettingsConnections) {
    // 自适应：保留用户设置中的连接/并发，只保证有合理默认
    return {
      ...deps,
      maxConnections: deps.maxConnections || preset.maxConnections,
      maxConnectionsPerServer: deps.maxConnectionsPerServer || preset.maxConnectionsPerServer,
      maxConcurrentTasks: deps.maxConcurrentTasks || preset.maxConcurrentTasks,
    };
  }
  return {
    ...deps,
    maxConnections: preset.maxConnections,
    maxConnectionsPerServer: preset.maxConnectionsPerServer,
    maxConcurrentTasks: preset.maxConcurrentTasks,
  };
}
