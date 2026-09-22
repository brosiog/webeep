import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createApp } from './app.js';
import { createContactStore } from './contacts.js';
import { createBeeperService, createMockService } from './service.js';

// Convenience for `npm start`: fill unset variables from ./.env when present.
// Systemd deployments use EnvironmentFile instead; the real environment wins.
try {
  for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // No .env file; values must come from the environment.
}

const publicDir = new URL('../public/', import.meta.url).pathname;
const app = createApp({
  service: process.env.BEEPER_MODE === 'mock' ? createMockService() : createBeeperService({ accessToken: process.env.BEEPER_ACCESS_TOKEN, baseURL: process.env.BEEPER_BASE_URL }),
  contacts: createContactStore({ filePath: process.env.CONTACTS_FILE ?? `${process.cwd()}/data/contacts.json` }),
});
const apiServer = app.server.listeners('request')[0];
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

app.server.removeAllListeners('request');
app.server.on('request', (request, response) => {
  if (request.url.startsWith('/api/')) return apiServer(request, response);
  const requested = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const file = normalize(join(publicDir, requested));
  if (!file.startsWith(publicDir) || !existsSync(file)) { response.writeHead(404); return response.end(); }
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(response);
});

app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1').then(() => console.log(`beeper-web listening on ${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3000}`));
