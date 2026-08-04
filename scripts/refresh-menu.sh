#!/bin/zsh
# refresh-menu.sh
# Rebuilds menu.json from Google Sheets + Square inventory, then commits and pushes.
# Designed to run every 10 minutes via launchd.

set -e

REPO="/Users/openclaw-user/.openclaw/workspace/square-digital-menu-poc"
LOG="/Users/openclaw-user/.openclaw/workspace/square-digital-menu-poc/logs/refresh.log"
# Credentials — sourced from environment or secrets file
GITHUB_TOKEN=$(python3 -c "import json; print(json.load(open('/Users/openclaw-user/.openclaw/secrets/menu-refresh.json'))['github_token'])" 2>/dev/null || echo "")
GOOGLE_SHEETS_ID=$(python3 -c "import json; print(json.load(open('/Users/openclaw-user/.openclaw/secrets/menu-refresh.json'))['sheets_id'])" 2>/dev/null || echo "")
SQUARE_TOKEN=$(python3 -c "import json; print(json.load(open('/Users/openclaw-user/.openclaw/secrets/square.json'))['access_token'])")

mkdir -p "$(dirname "$LOG")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting menu refresh..." >> "$LOG"

cd "$REPO"

# Add node/npm to PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Build menu.json from Sheets + Square
GOOGLE_SHEETS_ID="$GOOGLE_SHEETS_ID" \
SQUARE_ACCESS_TOKEN="$SQUARE_TOKEN" \
npm run build-menu-sheets >> "$LOG" 2>&1

# Commit and push if changed
git add output/menu.json

if git diff --cached --quiet; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] No changes — skipping push." >> "$LOG"
else
  git -c user.name="menu-refresh[bot]" \
      -c user.email="menu-refresh@fivedaughtersbakery.com" \
      commit -m "chore: auto-refresh menu.json [$(date '+%H:%M')]" >> "$LOG" 2>&1

  GIT_ASKPASS='' git -c credential.helper='' \
    push "https://${GITHUB_TOKEN}@github.com/jwal7000/menu-display.git" main >> "$LOG" 2>&1

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pushed updated menu.json." >> "$LOG"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done." >> "$LOG"
