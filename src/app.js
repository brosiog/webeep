import { createServer } from 'node:http';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_BODY_BYTES = 16_384;

function json(response, status, body) {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > MAX_BODY_BYTES) return reject(new Error('body_too_large'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    request.on('error', () => reject(new Error('invalid_body')));
  });
}

function contentTypeIsJson(value) {
  return typeof value === 'string' && value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function validTextSend(body) {
  return body?.confirmed === true
    && typeof body.text === 'string'
    && body.text.trim().length > 0
    && body.text.length <= 4_000
    && typeof body.clientMessageId === 'string'
    && /^[A-Za-z0-9_-]{8,128}$/.test(body.clientMessageId);
}

export function createApp({ service }) {
  const idempotentSends = new Map();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { status: 'ok' });
      if (request.method === 'GET' && url.pathname === '/api/chats') return json(response, 200, { items: await service.listChats() });
      if (request.method === 'GET' && url.pathname === '/api/unread-count') return json(response, 200, { total: await service.getUnreadCount() });

      const sendMatch = request.method === 'POST' && url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      if (sendMatch) {
        if (!contentTypeIsJson(request.headers['content-type'])) return json(response, 415, { error: 'unsupported_media_type' });
        const body = await readJson(request);
        if (body?.confirmed !== true) return json(response, 400, { error: 'confirmation_required' });
        if (!validTextSend(body)) return json(response, 400, { error: 'invalid_request' });
        const chatId = decodeURIComponent(sendMatch[1]);
        const key = `${chatId}:${body.clientMessageId}`;
        if (!idempotentSends.has(key)) {
          idempotentSends.set(key, service.sendText({ chatId, text: body.text, clientMessageId: body.clientMessageId })
            .then((result) => ({ id: result.id, status: 'sent' }))
            .catch((error) => { idempotentSends.delete(key); throw error; }));
        }
        return json(response, 201, await idempotentSends.get(key));
      }

      const messageMatch = request.method === 'GET' && url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      if (messageMatch) {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json(response, 400, { error: 'invalid_request' });
        return json(response, 200, { items: await service.listMessages(decodeURIComponent(messageMatch[1]), limit) });
      }

      if (request.method === 'GET' && url.pathname === '/api/search') {
        const query = url.searchParams.get('q');
        const limit = Number(url.searchParams.get('limit') ?? 20);
        if (typeof query !== 'string' || query.trim().length === 0 || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100) return json(response, 400, { error: 'invalid_request' });
        return json(response, 200, { items: await service.search(query, limit) });
      }

      return json(response, 404, { error: 'not_found' });
    } catch {
      return json(response, 503, { error: 'service_unavailable' });
    }
  });

  return {
    get port() { return server.address()?.port; },
    listen(port, host = '127.0.0.1') { return new Promise((resolve) => server.listen(port, host, resolve)); },
    close() { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
    server,
  };
}