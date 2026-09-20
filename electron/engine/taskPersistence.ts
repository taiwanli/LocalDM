import fs from 'node:fs';
import path from 'node:path';
import type { DownloadTask } from '../../shared/types';

const ACTIVE_STATUSES = new Set<DownloadTask['status']>(['probing', 'downloading', 'merging']);

export function tasksStatePath(userDataDir: string): string {
  return path.join(userDataDir, 'tasks-state.json');
}

function isDownloadTask(value: unknown): value is DownloadTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<DownloadTask>;
  return (
    typeof task.id === 'string' &&
    Boolean(task.id) &&
    typeof task.url === 'string' &&
    typeof task.status === 'string' &&
    typeof task.savePath === 'string'
  );
}

/** Map in-flight statuses to a safe restart state; keep finished/failed as-is. */
export function normalizeTasksForRestore(tasks: DownloadTask[]): DownloadTask[] {
  return tasks.map((task) => {
    const base: DownloadTask = { ...task, speedBps: 0, etaSeconds: null };
    if (!ACTIVE_STATUSES.has(task.status)) return base;
    if (task.doneBytes > 0) {
      return { ...base, status: 'paused', canResume: true };
    }
    return { ...base, status: 'queued', canResume: task.mediaKind !== 'direct' || task.doneBytes > 0 };
  });
}

export function saveTasksState(userDataDir: string, tasks: DownloadTask[]): void {
  const file = tasksStatePath(userDataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify(tasks, null, 2);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, payload, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows may fail rename if antivirus holds the target — fall back to direct write.
    fs.writeFileSync(file, payload, 'utf8');
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function loadTasksState(userDataDir: string): DownloadTask[] {
  try {
    const raw = JSON.parse(fs.readFileSync(tasksStatePath(userDataDir), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isDownloadTask);
  } catch {
    return [];
  }
}
