import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { deleteMailsByUids } from './mail-delete.js';
import { syncMailbox } from './mail-sync.js';
import type { MailProvider } from './config.js';

const PORT = Number(process.env.PORT || 3847);
const ROOT = resolve(process.cwd());
const WEB_DIR = resolve(ROOT, 'web');
const DATA_DIR = resolve(ROOT, 'data');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string) {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function safePath(base: string, urlPath: string): string | null {
  const normalized = resolve(base, '.' + urlPath);
  if (!normalized.startsWith(base)) return null;
  return normalized;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleSync(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}') as { provider?: string };
    const provider: MailProvider = body.provider === 'qq' ? 'qq' : '163';
    const result = await syncMailbox(provider);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }
}

async function handleDelete(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as { provider?: string; uids?: unknown };

    const provider: MailProvider = body.provider === 'qq' ? 'qq' : '163';
    const uids = Array.isArray(body.uids)
      ? body.uids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];

    if (uids.length === 0) {
      sendJson(res, 400, { error: 'uids 不能为空' });
      return;
    }

    if (uids.length > 500) {
      sendJson(res, 400, { error: '单次最多删除 500 封' });
      return;
    }

    const result = await deleteMailsByUids(provider, uids);
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/delete') {
    await handleDelete(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/sync') {
    await handleSync(req, res);
    return;
  }

  let filePath: string | null = null;

  if (url.pathname === '/' || url.pathname === '/index.html') {
    filePath = join(WEB_DIR, 'index.html');
  } else if (url.pathname.startsWith('/data/')) {
    filePath = safePath(DATA_DIR, url.pathname.slice('/data'.length));
  } else if (url.pathname.startsWith('/web/')) {
    filePath = safePath(WEB_DIR, url.pathname.slice('/web'.length));
  } else {
    filePath = safePath(WEB_DIR, url.pathname);
  }

  if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
    return;
  }

  const ext = extname(filePath);
  const type = MIME[ext] || 'application/octet-stream';
  send(res, 200, readFileSync(filePath), type);
});

server.listen(PORT, () => {
  console.log(`碎纸相簿已启动: http://localhost:${PORT}`);
  console.log(`删除接口: POST http://localhost:${PORT}/api/delete`);
  console.log(`同步接口: POST http://localhost:${PORT}/api/sync`);
  console.log(`QQ: ${resolve(DATA_DIR, 'mails-qq')} · 163: ${resolve(DATA_DIR, 'mails')}`);
  console.log(`按 Ctrl+C 停止`);
});
