import { createServer } from 'node:http';
import { Readable } from 'node:stream';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_BODY_BYTES = 16_384;
// Room for a ~25 MB file plus base64 overhead on message sends.
const MAX_MESSAGE_BYTES = 36_000_000;

function json(response, status, body) {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

function readJson(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > maxBytes) return reject(new Error('body_too_large'));
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

// Returns the parsed body, null after responding 415, or throws (→ 503) like before.
async function requireJsonBody(request, response, maxBytes) {
  if (!contentTypeIsJson(request.headers['content-type'])) {
    json(response, 415, { error: 'unsupported_media_type' });
    return null;
  }
  return readJson(request, maxBytes);
}

function validReplyToMessageId(value) {
  return value === undefined
    || (typeof value === 'string' && value.length > 0 && value.length <= 256);
}

function validAttachment(value) {
  return typeof value === 'object'
    && value !== null
    && typeof value.fileName === 'string'
    && value.fileName.length > 0
    && value.fileName.length <= 255
    && !/[\u0000-\u001F\u007F/\\]/.test(value.fileName)
    && typeof value.mimeType === 'string'
    && value.mimeType.length <= 128
    && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value.mimeType)
    && typeof value.data === 'string'
    && value.data.length > 0
    && value.data.length <= 34_000_000
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value.data);
}

function validMessageSend(body) {
  if (!body || body.confirmed !== true) return false;
  if (typeof body.clientMessageId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.clientMessageId)) return false;
  if (!validReplyToMessageId(body.replyToMessageId)) return false;
  const text = typeof body.text === 'string' ? body.text : '';
  if (text.length > 4_000) return false;
  if (body.attachment !== undefined && !validAttachment(body.attachment)) return false;
  return text.trim().length > 0 || body.attachment !== undefined;
}

function attachmentForClient(attachment) {
  const { assetURL, ...metadata } = attachment;
  return {
    ...metadata,
    url: assetURL ? `/api/assets?url=${encodeURIComponent(assetURL)}` : '',
  };
}

function validReactionKey(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 32
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function validAssetURL(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4_096
    && /^(?:mxc|localmxc|file):\/\//.test(value);
}

export function createApp({ service, contacts = { async getLabelsForChats() { return {}; }, async list() { return []; }, async setLabel() {} } }) {
  const idempotentSends = new Map();
  async function chatsWithLabels() {
    const chats = await service.listChats();
    const labels = await contacts.list(chats);
    const labelByChatId = new Map(labels.filter((contact) => contact.name).map((contact) => [contact.chatId, contact.name]));
    return chats.map((chat) => ({ ...chat, title: labelByChatId.get(chat.id) ?? chat.title }));
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { status: 'ok' });
      if (request.method === 'GET' && url.pathname === '/api/chats') return json(response, 200, { items: await chatsWithLabels() });
      if (request.method === 'GET' && url.pathname === '/api/unread-count') return json(response, 200, { total: await service.getUnreadCount() });

      if (request.method === 'GET' && url.pathname === '/api/assets') {
        const assetURL = url.searchParams.get('url');
        if (!validAssetURL(assetURL)) return json(response, 400, { error: 'invalid_request' });
        // file:// URLs reach into the bridge host filesystem, so only serve ones
        // the bridge itself handed us in a recent thread or search projection.
        if (assetURL.startsWith('file:') && (typeof service.isAssetAllowed !== 'function' || !service.isAssetAllowed(assetURL))) {
          return json(response, 404, { error: 'not_found' });
        }
        const asset = await service.serveAsset(assetURL);
        if (!asset.ok) return json(response, asset.status || 502, { error: 'asset_unavailable' });
        const headers = {};
        for (const header of ['content-type', 'content-length', 'accept-ranges']) {
          const value = asset.headers.get(header);
          if (value) headers[header] = value;
        }
        response.writeHead(200, headers);
        if (!asset.body) return response.end();
        return Readable.fromWeb(asset.body).pipe(response);
      }

      if (request.method === 'GET' && url.pathname === '/api/contacts') return json(response, 200, { items: await contacts.list(await service.listChats()) });
      const contactMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/contacts\/([^/]+)$/);
      if (contactMatch) {
        const body = await requireJsonBody(request, response);
        if (!body) return;
        if (typeof body?.name !== 'string' || body.name.length > 100) return json(response, 400, { error: 'invalid_request' });
        const contactId = decodeURIComponent(contactMatch[1]);
        const chats = await service.listChats();
        const contact = (await contacts.list(chats)).find((item) => item.id === contactId);
        if (!contact) return json(response, 404, { error: 'not_found' });
        await contacts.setLabel(contact.number, body.name);
        return json(response, 200, { ...contact, name: body.name.trim() });
      }

      const reactionPostMatch = request.method === 'POST' && url.pathname.match(/^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/reactions$/);
      if (reactionPostMatch) {
        const body = await requireJsonBody(request, response);
        if (!body) return;
        if (!validReactionKey(body?.emoji)) return json(response, 400, { error: 'invalid_request' });
        if (typeof service.sendReaction !== 'function') return json(response, 501, { error: 'not_supported' });
        const chatId = decodeURIComponent(reactionPostMatch[1]);
        const messageId = decodeURIComponent(reactionPostMatch[2]);
        return json(response, 201, { status: 'reacted', ...(await service.sendReaction({ chatId, messageId, emoji: body.emoji })) });
      }

      const reactionDeleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/reactions\/([^/]+)$/);
      if (reactionDeleteMatch) {
        if (typeof service.removeReaction !== 'function') return json(response, 501, { error: 'not_supported' });
        const chatId = decodeURIComponent(reactionDeleteMatch[1]);
        const messageId = decodeURIComponent(reactionDeleteMatch[2]);
        const emoji = decodeURIComponent(reactionDeleteMatch[3]);
        if (!validReactionKey(emoji)) return json(response, 400, { error: 'invalid_request' });
        return json(response, 200, { status: 'removed', ...(await service.removeReaction({ chatId, messageId, emoji })) });
      }

      const sendMatch = request.method === 'POST' && url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      if (sendMatch) {
        const body = await requireJsonBody(request, response, MAX_MESSAGE_BYTES);
        if (!body) return;
        if (body?.confirmed !== true) return json(response, 400, { error: 'confirmation_required' });
        if (!validMessageSend(body)) return json(response, 400, { error: 'invalid_request' });
        const chatId = decodeURIComponent(sendMatch[1]);
        const key = `${chatId}:${body.clientMessageId}`;
        if (!idempotentSends.has(key)) {
          idempotentSends.set(key, service.sendText({ chatId, text: body.text ?? '', clientMessageId: body.clientMessageId, ...(body.replyToMessageId ? { replyToMessageId: body.replyToMessageId } : {}), ...(body.attachment ? { attachment: body.attachment } : {}) })
            .then((result) => ({ id: result.id, status: 'sent' }))
            .catch((error) => { idempotentSends.delete(key); throw error; }));
        }
        return json(response, 201, await idempotentSends.get(key));
      }

      const messageMatch = request.method === 'GET' && url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      if (messageMatch) {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json(response, 400, { error: 'invalid_request' });
        const chatId = decodeURIComponent(messageMatch[1]);
        const [messages, chats] = await Promise.all([service.listMessages(chatId, limit), service.listChats()]);
        const savedLabels = await contacts.getLabelsForChats(chats);
        const labelByNumber = new Map(Object.entries(savedLabels).filter(([, name]) => name));
        return json(response, 200, { items: messages.map((message) => ({
          ...message,
          sender: labelByNumber.get(message.sender) ?? message.sender,
          attachments: (message.attachments ?? []).map(attachmentForClient),
        })) });
      }

      if (request.method === 'GET' && url.pathname === '/api/search') {
        const query = url.searchParams.get('q');
        const limit = Number(url.searchParams.get('limit') ?? 20);
        if (typeof query !== 'string' || query.trim().length === 0 || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100) return json(response, 400, { error: 'invalid_request' });
        const [messages, chats] = await Promise.all([service.search(query, limit), service.listChats()]);
        const chatTitleById = new Map(chats.map((chat) => [chat.id, chat.title]));
        return json(response, 200, { items: messages.map((message) => ({
          ...message,
          chatTitle: chatTitleById.get(message.chatId) ?? message.chatTitle ?? 'Unknown chat',
        })) });
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
