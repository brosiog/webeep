#!/usr/bin/env bash
#
# Beeper Web installer wizard: zero → running app in four stages.
# Run with: ./setup.sh   (or: npm run setup)
#
# Everything above the "STAGES" marker is the wizard library: do not hand-edit
# it. Author the per-step stages below the marker.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear wipes the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "Title" shows the opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" clears the screen, then announces a stage and shows progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." prints a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." is a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL opens it in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser; visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

# pause "msg" waits for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY: current value of KEY in ENV_FILE, if any.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# ask KEY "Prompt" reads a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret).
ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" is like ask, but input is hidden.
ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE upserts KEY=VALUE into ENV_FILE (creates it; replaces
# any existing line). Idempotent.
write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE sets a GitHub Actions repo secret via gh. Falls back
# to a warning (and records it) if gh is unavailable or unauthenticated.
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

# set_var NAME VALUE sets a GitHub Actions repo variable (non-secret).
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

# finish clears, then shows a closing summary of everything configured.
finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES: Beeper Web setup. Run from the repo root: ./setup.sh
# ──────────────────────────────────────────────────────────────────────────

TOTAL_STAGES=4

banner "Beeper Web setup"

# ── Stage 1: toolchain + dependencies ─────────────────────────────────────
stage "Prerequisites: Node.js and dependencies"
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js isn't installed."
  say "Install Node.js 20 or later from https://nodejs.org, then re-run ./setup.sh"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  warn "Node.js $(node --version) found, but version 20 or later is required."
  say "Upgrade from https://nodejs.org, then re-run ./setup.sh"
  exit 1
fi
say "Node.js $(node --version) ✓"
if ! command -v npm >/dev/null 2>&1; then
  warn "npm isn't installed (it ships with Node.js from https://nodejs.org)."
  say "Repair your Node.js install, then re-run ./setup.sh"
  exit 1
fi
say "Installing dependencies (npm install)…"
npm install
if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
  note "created $ENV_FILE from .env.example (holds this machine's defaults)"
fi

# ── Stage 2: bridge access token ──────────────────────────────────────────
stage "Beeper Desktop: access token"
say "Beeper Web talks to Beeper Desktop on this machine, and needs a token."
open_url "https://developers.beeper.com/desktop-api/auth"
step "Make sure Beeper Desktop is running."
step "In Beeper Desktop, open Settings → Integrations."
step "Click the + button next to Approved connections and follow the prompts."
step "Copy the token it creates."
ask_secret BEEPER_ACCESS_TOKEN "Paste the access token:"
if [[ -z "$BEEPER_ACCESS_TOKEN" ]]; then
  warn "empty token: the app will start but chats won't load until you set one."
  warn "re-run ./setup.sh any time to fill it in."
fi
write_env BEEPER_ACCESS_TOKEN "$BEEPER_ACCESS_TOKEN"

# ── Stage 3: connection details ───────────────────────────────────────────
stage "Beeper Desktop: connection"
say "Where the Desktop API listens. The defaults fit a standard install."
ask BEEPER_BASE_URL "Bridge base URL:"
ask HOST "Listen address for Beeper Web:"
ask PORT "Port for Beeper Web:"
if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  warn "port '$PORT' isn't numeric; using 3000."
  PORT="3000"
fi
write_env BEEPER_BASE_URL "$BEEPER_BASE_URL"
write_env HOST "$HOST"
write_env PORT "$PORT"
if command -v curl >/dev/null 2>&1 && [[ -n "$BEEPER_ACCESS_TOKEN" ]]; then
  note "Checking the bridge answers…"
  if curl -fsS -m 6 -o /dev/null "$BEEPER_BASE_URL/v1/info" -H "Authorization: Bearer $BEEPER_ACCESS_TOKEN" 2>/dev/null; then
    printf '  %s✓ bridge answered%s\n' "$GREEN" "$RESET"
  else
    warn "the bridge didn't answer; make sure Beeper Desktop is running."
    warn "continuing anyway: the app will show chats once it can reach it."
  fi
fi

# ── Stage 4: launch ───────────────────────────────────────────────────────
stage "Launch"
say "Starting Beeper Web in this terminal. Leave it running while you chat."
LOG_FILE=$(mktemp -t beeper-web-setup-XXXXXX.log)
npm start >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
READY=""
for _ in $(seq 1 30); do
  if curl -fsS -m 2 -o /dev/null "http://localhost:$PORT/api/health" 2>/dev/null; then READY="1"; break; fi
  sleep 1
done
if [[ -z "$READY" ]]; then
  warn "the server didn't answer within 30s. Last log lines:"
  tail -n 10 "$LOG_FILE" || true
  exit 1
fi
open_url "http://localhost:$PORT"

finish
say "Beeper Web is live at http://localhost:$PORT (log: $LOG_FILE)"
say "Stop it any time with Ctrl-C here. Start it again later with: npm start"
wait $SERVER_PID
