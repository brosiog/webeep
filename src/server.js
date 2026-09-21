import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createApp } from './app.js';
import { createContactStore } from './contacts.js';
import { createBeeperService, createMockService } from './service.js';

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
