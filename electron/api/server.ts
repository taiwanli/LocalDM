import http from 'node:http';
import type { CapturePayload } from '../../shared/types';
import { CAPTURE_PATH, parseCaptureBody } from './protocol';

export interface LocalApiTaskHandlers {
  list: () => unknown[];
  get: (id: string) => unknown | undefined;
  create: (body: {
    url: string;
    headers?: Record<string, string>;
    title?: string;
    suggestedFilename?: string;
    category?: string;
  }) => Promise<unknown>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  remove: (id: string, deleteFiles: boolean) => Promise<void>;
}

export interface LocalApiSettingsHandlers {
  get: () => unknown;
  update: (partial: Record<string, unknown>) => Promise<unknown>;
}

export interface LocalApiDeps {
  port: number;
  token: string;
  /** When true, non-health endpoints require Bearer token. Capture still allows loopback fallback. */
  requireToken: boolean;
  onCapture: (payload: CapturePayload) => Promise<unknown>;
  tasks: LocalApiTaskHandlers;
  settings?: LocalApiSettingsHandlers;
  /** Exposed on GET /health so the extension can follow desktop system-takeover. */
  getSystemTakeoverEnabled?: () => boolean;
}

const MAX_BODY = 256 * 1024;

export class LocalApiServer {
  private server: http.Server | null = null;
  private boundPort = 0;

  constructor(private deps: LocalApiDeps) {}

  get port(): number {
    return this.boundPort || this.deps.port;
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}${CAPTURE_PATH}`;
  }

  private tokenFromRequest(req: http.IncomingMessage): string {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    return (url.searchParams.get('token') || '').trim();
  }

  private isAuthorized(req: http.IncomingMessage, mode: 'strict' | 'capture'): boolean {
    const presented = this.tokenFromRequest(req);
    if (presented && presented === this.deps.token) return true;
    if (mode === 'capture') {
      // Personal-use default: loopback capture works without token so extension can cold-start.
      return true;
    }
    if (!this.deps.requireToken) return true;
    return false;
  }

  async start(): Promise<number> {
    if (this.server) return this.port;
    const server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.deps.port, '127.0.0.1', () => {
        const address = server.address();
        this.boundPort = typeof address === 'object' && address ? address.port : this.deps.port;
        resolve();
      });
    });
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = null;
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new Error('body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url ?? '/';
    const url = new URL(rawUrl, `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';

    // Browser pages / extension content scripts may call the local API directly.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'GET' && pathname === '/health') {
      this.json(res, 200, {
        ok: true,
        app: 'LocalDM',
        port: this.port,
        systemTakeoverEnabled: Boolean(this.deps.getSystemTakeoverEnabled?.()),
      });
      return;
    }

    if (method === 'GET' && (pathname === '/tasks' || pathname === '/events')) {
      if (!this.isAuthorized(req, 'strict')) {
        this.json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const tasks = this.deps.tasks.list();
      this.json(res, 200, { ok: true, tasks, ts: Date.now() });
      return;
    }

    const taskMatch = pathname.match(/^\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const taskId = decodeURIComponent(taskMatch[1]);
      if (!this.isAuthorized(req, 'strict')) {
        this.json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      if (method === 'GET') {
        const task = this.deps.tasks.get(taskId);
        if (!task) {
          this.json(res, 404, { ok: false, error: 'task_not_found' });
          return;
        }
        this.json(res, 200, { ok: true, task });
        return;
      }
      if (method === 'DELETE') {
        const deleteFiles = url.searchParams.get('deleteFiles') === '1';
        await this.deps.tasks.remove(taskId, deleteFiles);
        this.json(res, 200, { ok: true });
        return;
      }
    }

    const actionMatch = pathname.match(/^\/tasks\/([^/]+)\/(pause|resume)$/);
    if (actionMatch && method === 'POST') {
      const taskId = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2] as 'pause' | 'resume';
      if (!this.isAuthorized(req, 'strict')) {
        this.json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const task = this.deps.tasks.get(taskId);
      if (!task) {
        this.json(res, 404, { ok: false, error: 'task_not_found' });
        return;
      }
      if (action === 'pause') await this.deps.tasks.pause(taskId);
      else await this.deps.tasks.resume(taskId);
      this.json(res, 200, { ok: true, task: this.deps.tasks.get(taskId) });
      return;
    }

    if (pathname === '/tasks' && method === 'POST') {
      if (!this.isAuthorized(req, 'strict')) {
        this.json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      try {
        const body = JSON.parse((await this.readBody(req)) || '{}') as Record<string, unknown>;
        const urlValue = String(body.url || '');
        const task = await this.deps.tasks.create({
          url: urlValue,
          headers: (body.headers as Record<string, string> | undefined) || undefined,
          title: body.title ? String(body.title) : undefined,
          suggestedFilename: body.suggestedFilename
            ? String(body.suggestedFilename)
            : undefined,
          category: body.category ? String(body.category) : undefined,
        });
        this.json(res, 200, { ok: true, task });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.json(res, 400, { ok: false, error: message });
      }
      return;
    }

    if (pathname === CAPTURE_PATH && method === 'POST') {
      if (!this.isAuthorized(req, 'capture')) {
        this.json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      try {
        const payload = parseCaptureBody(await this.readBody(req));
        const task = await this.deps.onCapture(payload);
        this.json(res, 200, { ok: true, task });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.json(res, 400, { ok: false, error: message });
      }
      return;
    }

    if (pathname === '/settings') {
      if (!this.deps.settings) {
        this.json(res, 404, { ok: false, error: 'not_implemented' });
        return;
      }
      if (!this.isAuthorized(req, 'strict')) {
        this.json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      if (method === 'GET') {
        this.json(res, 200, { ok: true, settings: this.deps.settings.get() });
        return;
      }
      if (method === 'PUT') {
        try {
          const body = JSON.parse((await this.readBody(req)) || '{}') as Record<string, unknown>;
          const settings = await this.deps.settings.update(body);
          this.json(res, 200, { ok: true, settings });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.json(res, 400, { ok: false, error: message });
        }
        return;
      }
    }

    this.json(res, 404, { ok: false, error: 'not_found' });
  }
}
