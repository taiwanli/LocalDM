import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.TEST_PORT || 18765);
const FILE_SIZE = Number(process.env.TEST_FILE_SIZE || 5 * 1024 * 1024);
const FILE_PATH = path.join(process.cwd(), 'scripts', '.tmp-test-payload.bin');

export function ensurePayload(): Buffer {
  if (!fs.existsSync(FILE_PATH) || fs.statSync(FILE_PATH).size !== FILE_SIZE) {
    const buffer = crypto.randomBytes(FILE_SIZE);
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    fs.writeFileSync(FILE_PATH, buffer);
  }
  return fs.readFileSync(FILE_PATH);
}

export function startRangeServer(payload: Buffer, port = PORT): Promise<http.Server> {
  const etag = `"${crypto.createHash('sha1').update(payload).digest('hex')}"`;
  const server = http.createServer((req, res) => {
    const range = req.headers.range;
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': String(payload.length),
        'Accept-Ranges': 'bytes',
        ETag: etag,
        'Last-Modified': new Date().toUTCString(),
        'Content-Type': 'application/octet-stream',
      });
      res.end();
      return;
    }
    if (range) {
      const match = /bytes=(\d+)-(\d+)?/.exec(range);
      if (!match) {
        res.writeHead(400).end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : payload.length - 1;
      if (start >= payload.length || end >= payload.length || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${payload.length}` }).end();
        return;
      }
      const chunk = payload.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${payload.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunk.length),
        ETag: etag,
        'Content-Type': 'application/octet-stream',
      });
      res.end(chunk);
      return;
    }
    res.writeHead(200, {
      'Content-Length': String(payload.length),
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Content-Type': 'application/octet-stream',
    });
    res.end(payload);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (require.main === module) {
  const payload = ensurePayload();
  void startRangeServer(payload).then((server) => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : PORT;
    console.log(`[local-test-server] listening http://127.0.0.1:${port}/file size=${payload.length}`);
  });
}
