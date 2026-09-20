import type { DownloadTask } from '../../shared/types';

/** In-memory task queue/state machine — M2 wires persistence + engine. */
export class TaskStore {
  private tasks = new Map<string, DownloadTask>();

  list(): DownloadTask[] {
    return [...this.tasks.values()];
  }

  get(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  upsert(task: DownloadTask): void {
    this.tasks.set(task.id, task);
  }

  remove(id: string): void {
    this.tasks.delete(id);
  }
}

export const taskStore = new TaskStore();
