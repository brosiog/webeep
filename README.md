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
- `POST /api/chats/:chatId/messages` with `{ "text", "confirmed": true, "clientMessageId" }` (optional `replyToMessageId` sends it as a reply; optional `attachment: { fileName, mimeType, data }` with base64 `data` uploads and attaches a file up to 25 MB — `text` may then be empty)
- `POST /api/chats/:chatId/read` marks a chat read
- `POST /api/chats/:chatId/messages/:messageId/reactions` with `{ "emoji" }`
- `DELETE /api/chats/:chatId/messages/:messageId/reactions/:emoji`

## Themes

The gear button in the rail opens settings with a theme switcher:

- **Aero** (default): glass panels, gradients, glow, and system light/dark via `prefers-color-scheme`.
- **Minimal**: the original flat monochrome look, also with system light/dark support.

The choice persists in `localStorage` (`beeper-theme`) and is applied before first paint, so there is no flash on reload. Both themes share the same UI and features; only presentation differs.

## Notifications

The 🔔 button beside Refresh opts into notifications, which are checked on every poll:

- **System notifications** (Notification API) for new messages in chats you are not actively viewing. Clicking one opens that chat. These need browser permission; on plain-`http` LAN origins the browser may withhold it, in which case the button reports it as blocked.
- **In-app toasts** for the same events whenever the tab is visible — click a toast to jump to the chat.
- **Tab title badge** with the total unread count, always on.

Only genuinely new arrivals notify: opening a chat marks its messages seen, and your own messages never trigger. While the tab is hidden the app keeps polling chats (thread refresh pauses) so background arrivals still surface; note browsers may throttle hidden-tab timers to about one poll per minute.

Message projections include a `reactions` array (`[{ key, participant }]`) when the bridge reports reactions, and a `replyToMessageId` when the message is a reply. Standalone `REACTION` echo messages from the bridge are hidden from threads and search, since their emoji already appears as a chip on the target message. The UI renders quoted context above replies (click to jump to the original) and a ↩ button on each message to reply with a quoted preview bar. The UI groups reactions by emoji; clicking a chip removes your reaction, and the 🙂 button opens a small emoji palette to add one.

The UI sends immediately on Enter (Shift+Enter inserts a newline) and always sets `confirmed: true` on text-send requests.