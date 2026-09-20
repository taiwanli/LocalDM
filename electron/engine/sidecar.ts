import fs from 'node:fs';
import path from 'node:path';
import type { DownloadTask, SegmentProgress } from '../../shared/types';

export interface SidecarData {
  url: string;
  etag: string | null;
  lastModified: string | null;
  totalLength: number;
  segments: SegmentProgress[];
  partPath: string;
  updatedAt: string;
}

export function sidecarPath(userDataDir: string, taskId: string): string {
  return path.join(userDataDir, 'tasks', `${taskId}.meta.json`);
}

export function partPathFor(savePath: string, filename: string): string {
  return path.join(savePath, `${filename}.part`);
}

export function writeSidecar(userDataDir: string, taskId: string, data: SidecarData): void {
  const file = sidecarPath(userDataDir, taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

export function readSidecar(userDataDir: string, taskId: string): SidecarData | null {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath(userDataDir, taskId), 'utf8')) as SidecarData;
  } catch {
    return null;
  }
}

export function deleteSidecar(userDataDir: string, taskId: string): void {
  try {
    fs.unlinkSync(sidecarPath(userDataDir, taskId));
  } catch {
    /* ignore */
  }
}

export function canResumeFromSidecar(
  sidecar: SidecarData | null,
  remote: { size: number; etag: string | null; lastModified: string | null },
): boolean {
  if (!sidecar) return false;
  if (remote.size > 0 && sidecar.totalLength !== remote.size) return false;
  if (sidecar.etag && remote.etag && sidecar.etag !== remote.etag) return false;
  if (
    sidecar.etag == null &&
    remote.etag == null &&
    sidecar.lastModified &&
    remote.lastModified &&
    sidecar.lastModified !== remote.lastModified
  ) {
    return false;
  }
  return true;
}

export function taskFromSidecar(id: string, sidecar: SidecarData): Partial<DownloadTask> {
  return {
    id,
    url: sidecar.url,
    totalBytes: sidecar.totalLength,
    segments: sidecar.segments,
  };
}
