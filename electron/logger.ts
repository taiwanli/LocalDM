import fs from 'node:fs';
import path from 'node:path';

let logFile: string | null = null;
let tasksLogDir: string | null = null;

export function initLogger(userDataDir: string): void {
  const dir = path.join(userDataDir, 'logs');
  tasksLogDir = path.join(dir, 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(tasksLogDir, { recursive: true });
  logFile = path.join(dir, 'app.log');
  log('logger initialized', logFile);
}

export function log(...parts: unknown[]): void {
  const line = formatLine('', parts);
  try {
    if (logFile) fs.appendFileSync(logFile, line, 'utf8');
  } catch {
    /* ignore log I/O errors */
  }
  console.log(`[LocalDM]${line.trimEnd()}`);
}

export function logError(...parts: unknown[]): void {
  const line = formatLine('ERROR ', parts);
  try {
    if (logFile) fs.appendFileSync(logFile, line, 'utf8');
  } catch {
    /* ignore */
  }
  console.error(`[LocalDM]${line.trimEnd()}`);
}

/** Per-task log under UserData/LocalDM/logs/tasks/<id>.log */
export function logTask(taskId: string, ...parts: unknown[]): void {
  if (!taskId) return;
  const safeId = taskId.replace(/[^\w.-]/g, '_').slice(0, 80);
  if (!tasksLogDir) {
    log('task', safeId, ...parts);
    return;
  }
  const file = path.join(tasksLogDir, `${safeId}.log`);
  const line = formatLine('', parts);
  try {
    fs.mkdirSync(tasksLogDir, { recursive: true });
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    /* ignore */
  }
  try {
    if (logFile) fs.appendFileSync(logFile, line.replace(']', `] task=${safeId}`), 'utf8');
  } catch {
    /* ignore */
  }
}

export function taskLogPath(taskId: string): string {
  const safeId = taskId.replace(/[^\w.-]/g, '_').slice(0, 80);
  return path.join(tasksLogDir || '', `${safeId}.log`);
}

function formatLine(level: string, parts: unknown[]): string {
  return `[${new Date().toISOString()}] ${level}${parts
    .map((item) => (typeof item === 'string' ? item : safeJson(item)))
    .join(' ')}\n`;
}

function safeJson(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ? `${value.message} | ${value.stack.split('\n')[0]}` : value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
