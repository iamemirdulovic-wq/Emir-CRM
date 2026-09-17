#!/usr/bin/env bash
#
# One-time server preparation. Run this once over SSH, before the first deploy.
# It is safe to run again: every step checks before it acts.
#
#   bash server-setup.sh /home/uXXXXXXXX/crm
#
# It creates the directory layout, writes a .env template for you to fill in,
# and checks that this machine can actually run the CRM. It never touches the
# database and never writes a password.

set -euo pipefail

DEPLOY_PATH="${1:-}"
if [ -z "$DEPLOY_PATH" ]; then
  echo "Usage: bash server-setup.sh <deploy path>"
  echo "   eg: bash server-setup.sh \$HOME/crm"
  exit 1
fi

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  WRONG %s\n' "$1"; }

say "1. Checking this server can run the CRM"

if ! command -v node > /dev/null 2>&1; then
  bad "Node.js is not installed, or is not on PATH for this shell."
  echo
  echo "  If hPanel has a Node.js / Application Manager page, enable it there and"
  echo "  run this again. If it has no such page, this plan cannot host the CRM"
  echo "  and you need a VPS. Stop here and say so."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  bad "Node $(node -v) is too old. The CRM needs 18 or newer; 22 is what it is tested on."
  exit 1
fi
ok "Node $(node -v)"

if ! command -v npm > /dev/null 2>&1; then
  bad "npm is missing, which is unusual alongside Node. Ask Hostinger support."
  exit 1
fi
ok "npm $(npm -v)"

if command -v pm2 > /dev/null 2>&1; then
  ok "pm2 $(pm2 -v)"
else
  say "   Installing pm2, which keeps the API and worker running"
  npm install -g pm2
  if command -v pm2 > /dev/null 2>&1; then
    ok "pm2 $(pm2 -v)"
  else
    bad "pm2 installed but is not on PATH. Add npm's global bin to PATH and re-run."
    echo "  Try: export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
    exit 1
  fi
fi

say "2. Creating the directory layout at $DEPLOY_PATH"

mkdir -p "$DEPLOY_PATH/releases"
mkdir -p "$DEPLOY_PATH/shared/var/uploads"
mkdir -p "$DEPLOY_PATH/shared/logs"
ok "releases/  shared/var/uploads/  shared/logs/"

# Uploaded import files and logs are nobody else's business.
chmod 700 "$DEPLOY_PATH/shared/var/uploads" "$DEPLOY_PATH/shared/logs"
ok "permissions tightened on uploads and logs"

say "3. The environment file"

ENV_FILE="$DEPLOY_PATH/shared/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env already exists — left exactly as it is"
else
  KEY="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
  cat > "$ENV_FILE" <<ENVFILE
# Emir CRM — live configuration. This file never leaves this server.
NODE_ENV=production
PORT=3000
APP_URL=https://CHANGE-ME.example.ae

# Required in production: the session cookie must not travel over plain http.
COOKIE_SECURE=true
TRUST_PROXY=true

# --- Database -------------------------------------------------------------
# Create these in hPanel under Databases, then paste them here.
DB_HOST=localhost
DB_PORT=3306
DB_USER=CHANGE-ME
DB_PASSWORD=CHANGE-ME
DB_NAME=CHANGE-ME

# --- Security -------------------------------------------------------------
# Generated fresh for this server. Changing it makes stored tokens unreadable.
ENCRYPTION_KEY=$KEY

# --- WhatsApp -------------------------------------------------------------
# Not connected yet. The server refuses to start on "log" unless you say you
# mean it; with this set, messages are recorded as not sent and the inbox says
# so, which is honest. Switch to "cloud" once the number is approved.
WHATSAPP_PROVIDER=log
ALLOW_FAKE_WHATSAPP=1

# --- Email (optional) -----------------------------------------------------
# Fill these in to get email into the shared inbox. Safe to leave blank.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=
IMAP_HOST=
IMAP_USER=
IMAP_PASSWORD=

# --- Background worker ----------------------------------------------------
WORKER_ENABLED=true
WORKER_ID=worker-1
ENVFILE
  chmod 600 "$ENV_FILE"
  ok "wrote $ENV_FILE with a freshly generated ENCRYPTION_KEY"
fi

say "4. What is left for you"

NEEDS_EDIT=0
if grep -q 'CHANGE-ME' "$ENV_FILE" 2>/dev/null; then
  NEEDS_EDIT=1
  echo "  Edit $ENV_FILE and replace every CHANGE-ME:"
  echo "    APP_URL      the address the CRM will live at, https://crm.yourdomain.ae"
  echo "    DB_USER      from hPanel -> Databases -> MySQL Databases"
  echo "    DB_PASSWORD  the same"
  echo "    DB_NAME      the same"
  echo
  echo "  Then run:  nano $ENV_FILE"
else
  ok "no CHANGE-ME left in .env"
fi

echo
echo "  Your deploy path, which GitHub needs as the DEPLOY_PATH secret:"
echo "    $DEPLOY_PATH"
echo
if [ "$NEEDS_EDIT" -eq 1 ]; then
  echo "  Fill in .env first, then push to main and the deploy runs on its own."
else
  echo "  Ready. Push to main and the deploy runs on its own."
fi
