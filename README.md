# Beeper Web

A small, dependency-free browser UI for the local Beeper Desktop API bridge. The Node backend exposes a narrow chat, unread-count, message-thread, search, and confirmed-text-send API; the browser uses only those endpoints.

## Run locally

Requirements: Node.js 20 or later and a configured local Beeper Desktop API bridge.

```sh
cp .env.example .env
# Set BEEPER_ACCESS_TOKEN and BEEPER_BASE_URL in .env through your local deployment process.
set -a; . ./.env; set +a
npm start
```

The backend defaults to `127.0.0.1:3000`. For an isolated UI demonstration that does not contact a bridge, set `BEEPER_MODE=mock` before starting.

```sh
BEEPER_MODE=mock npm start
```

Quality checks:

```sh
npm test
npm run lint
```

## Deployment boundary

Caddy is the only public listener bound to `0.0.0.0`. The Beeper web backend stays loopback-only (`127.0.0.1:3000`), and the Beeper Desktop bridge/backend stays loopback-only as well. Use `deploy/Caddyfile.example` so Caddy admits only `192.168.86.0/24`; keep the host firewall restricted to `192.168.86.0/24` too.

Install the application under `/opt/beeper-web`, place the real environment file at `/etc/beeper-web.env`, and install `deploy/beeper-web.service`. Do not place credentials in this repository.

Bridge QR login and any OAuth authorization are user-performed steps in the Beeper client/bridge. This application does not automate QR scans, OAuth, bridge setup, or account access.

## HTTP API used by the UI

- `GET /api/chats`
- `GET /api/unread-count`
- `GET /api/chats/:chatId/messages?limit=50`
- `GET /api/search?q=...&limit=20`
- `POST /api/chats/:chatId/messages` with `{ "text", "confirmed": true, "clientMessageId" }`

The UI asks for browser confirmation before it issues a text-send request.