#!/usr/bin/env bash
# start-local.sh — Run the full AEO chat stack locally
# Usage: bash start-local.sh
# ─────────────────────────────────────────────────────
# Starts:
#   1. AEO LLM FastAPI server  →  http://localhost:8000
#   2. LLM Dashboard API       →  http://localhost:8080
#   3. AEO Chat frontend       →  http://localhost:3000

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AEO_LLM_DIR="$(cd "$SCRIPT_DIR/../aeo-llm" && pwd)"

# ── Colour helpers ─────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[start-local]${NC} $*"; }
warn() { echo -e "${YELLOW}[start-local]${NC} $*"; }
die()  { echo -e "${RED}[start-local] ERROR:${NC} $*"; exit 1; }

PYTHON="${PYTHON:-/opt/homebrew/bin/python3.12}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python3

# ── 1. Check prerequisites ─────────────────────────────
command -v pnpm   >/dev/null 2>&1 || die "pnpm not found. Run: npm install -g pnpm"
command -v "$PYTHON" >/dev/null 2>&1 || die "python3.12 not found at $PYTHON. Install with: brew install python@3.12"
command -v node   >/dev/null 2>&1  || die "node not found."

# ── 2. Load .env ───────────────────────────────────────
if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
  die ".env not found. Copy .env.example and fill in DATABASE_URL."
fi
set -a; source "$SCRIPT_DIR/.env"; set +a

[[ -z "$DATABASE_URL" ]] && die "DATABASE_URL is not set in .env"

AEO_LLM_URL="${AEO_LLM_URL:-http://localhost:8000}"

# ── 3. Install Node dependencies ───────────────────────
log "Installing Node dependencies..."
cd "$SCRIPT_DIR"
pnpm install 2>&1 | tail -5

# ── 4. Install Python dependencies for AEO LLM ─────────
log "Checking Python dependencies for AEO LLM..."
"$PYTHON" -m pip install -q fastapi uvicorn chromadb sentence-transformers anthropic openai python-dotenv langfuse 2>&1 | tail -3

# ── 5. Push DB schema ──────────────────────────────────
log "Pushing DB schema..."
cd "$SCRIPT_DIR/lib/db"
DATABASE_URL="$DATABASE_URL" node_modules/.bin/drizzle-kit push --config ./drizzle.config.ts || warn "DB push failed — check DATABASE_URL and ensure PostgreSQL is running."
cd "$SCRIPT_DIR"

# ── 6. Build the API server ────────────────────────────
log "Building API server..."
cd "$SCRIPT_DIR/artifacts/api-server"
pnpm install --ignore-scripts 2>&1 | tail -3
node ./build.mjs
cd "$SCRIPT_DIR"

# ── 7. Launch services ─────────────────────────────────
cleanup() {
  log "Shutting down all services..."
  kill "$PID_AEO" "$PID_API" "$PID_FRONT" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 7a. AEO LLM FastAPI server
log "Starting AEO LLM API on :8000..."
cd "$AEO_LLM_DIR/path_b_rag"
"$PYTHON" 4_aeo_api.py &
PID_AEO=$!
sleep 3  # give it time to load the vector DB

# 7b. LLM Dashboard API server (Express)
log "Starting LLM Dashboard API on :8080..."
cd "$SCRIPT_DIR/artifacts/api-server"
PORT=8080 DATABASE_URL="$DATABASE_URL" AEO_LLM_URL="$AEO_LLM_URL" \
  node --enable-source-maps ./dist/index.mjs &
PID_API=$!
sleep 2

# 7c. AEO Chat frontend (Vite)
log "Starting AEO Chat frontend on :3000..."
cd "$SCRIPT_DIR/artifacts/aeo-chat"
pnpm install --ignore-scripts 2>&1 | tail -3
PORT=3000 BASE_PATH="/" API_SERVER_PORT=8080 \
  node_modules/.bin/vite --config vite.config.ts &
PID_FRONT=$!

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  AEO LLM API  →  http://localhost:8000/docs"
log "  Dashboard API →  http://localhost:8080/api/health"
log "  Chat UI       →  http://localhost:3000"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Press Ctrl+C to stop all services."

wait
