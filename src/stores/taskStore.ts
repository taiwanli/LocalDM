import type {
  Category,
  DownloadTask,
  StatusBucket,
  StatusCounters,
  ThemePreference,
} from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';

export const DEMO_TASKS: DownloadTask[] = [
  {
    id: 'demo-1',
    url: 'https://example.com/models/model.gguf',
    filename: 'model.gguf',
    savePath: 'D:/Downloads/LocalDM/model',
    category: 'model',
    status: 'downloading',
    totalBytes: 2_576_980_378,
    doneBytes: 1_083_124_121,
    speedBps: 29_779_524,
    etaSeconds: 49,
    canResume: true,
    mediaKind: 'direct',
    segments: [
      { start: 0, end: 644245094, done: 300000000 },
      { start: 644245094, end: 1288490189, done: 220000000 },
      { start: 1288490189, end: 1932735283, done: 280000000 },
      { start: 1932735283, end: 2576980378, done: 283124121 },
    ],
    headers: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-2',
    url: 'https://example.com/ubuntu.iso',
    filename: 'ubuntu-24.04-desktop-amd64.iso',
    savePath: 'D:/Downloads/LocalDM/other',
    category: 'other',
    status: 'completed',
    totalBytes: 5_905_580_032,
    doneBytes: 5_905_580_032,
    speedBps: 0,
    etaSeconds: 0,
    canResume: false,
    mediaKind: 'direct',
    segments: [],
    headers: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-3',
    url: 'https://example.com/archive.zip',
    filename: 'archive.zip',
    savePath: 'D:/Downloads/LocalDM/archive',
    category: 'archive',
    status: 'paused',
    totalBytes: 1_073_741_824,
    doneBytes: 357_564_416,
    speedBps: 0,
    etaSeconds: null,
    canResume: true,
    mediaKind: 'direct',
    segments: [],
    headers: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export function countStatuses(tasks: DownloadTask[]): StatusCounters {
  const byCategory = Object.fromEntries(
    Object.keys(CATEGORY_LABELS).map((k) => [k, 0]),
  ) as Record<Category, number>;

  let active = 0;
  let completed = 0;
  for (const t of tasks) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    if (t.status === 'completed') completed += 1;
    else if (
      t.status === 'downloading' ||
      t.status === 'probing' ||
      t.status === 'queued' ||
      t.status === 'merging' ||
      t.status === 'paused'
    )
      active += 1;
  }
  return { all: tasks.length, active, completed, byCategory };
}

export function filterTasks(
  tasks: DownloadTask[],
  bucket: StatusBucket,
  category: Category | null,
): DownloadTask[] {
  return tasks.filter((t) => {
    if (
      bucket === 'active' &&
      !(
        t.status === 'downloading' ||
        t.status === 'queued' ||
        t.status === 'probing' ||
        t.status === 'paused' ||
        t.status === 'merging'
      )
    )
      return false;
    if (bucket === 'completed' && t.status !== 'completed') return false;
    if (category && t.category !== category) return false;
    return true;
  });
}

export function totalSpeed(tasks: DownloadTask[]): number {
  return tasks.reduce((sum, t) => sum + (t.status === 'downloading' ? t.speedBps : 0), 0);
}

export function themeFromBridge(pref: ThemePreference | undefined): ThemePreference {
  return pref ?? 'follow';
}
