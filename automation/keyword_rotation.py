"""
automation/keyword_rotation.py
──────────────────────────────────────────────────────────────────────────────
AEO Keyword Rotation — Daily Ranking API + DeepSeek + Langfuse
──────────────────────────────────────────────────────────────────────────────

What this does:
1. Loads a fixed keyword list from keywords.json.
2. Fetches last 7 days of ranking data from the AEO ranking API for every keyword.
3. Applies the 5-of-7 top-3 lock rule:
     ≥5 days with rankingPosition ≤ 3 → keyword is LOCKED (no further optimization).
4. Among active keywords, selects the one with the lowest current rankingPosition
   (most recent day's data). Tiebreaks by `priority` (lowest number wins).
5. Generates AEO-optimized content (FAQ or blog snippet) for the selected keyword
   via DeepSeek, using the keyword's `ground_truth` as the factual anchor.
6. Logs all decisions + the DeepSeek generation to Langfuse:
     - trace   : rotation_run_YYYY-MM-DD
     - score   : top3_stability = top3_days / 7  (per keyword)
     - generation: DeepSeek content call
7. Writes generated content to automation/logs/content_YYYY-MM-DD.json.
8. Persists lock state to rotation_state.json.

Environment variables (.env):
  AEO_API_TOKEN       — Bearer token for the ranking API (required)
  AEO_API_BASE        — API base URL (default: https://jjm59vpn3y.us-east-1.awsapprunner.com)
  CLIENT_ID           — Client ID sent to ranking API (default: 5)
  PLATFORM            — Platform slug (default: chatgpt)
  DEEPSEEK_API_KEY    — DeepSeek API key (required for content generation)
  LANGFUSE_SECRET_KEY — Langfuse secret key (required for observability)
  LANGFUSE_PUBLIC_KEY — Langfuse public key (required for observability)
  LANGFUSE_HOST       — Langfuse host (default: https://us.cloud.langfuse.com)

Usage:
  python3 automation/keyword_rotation.py
  python3 automation/keyword_rotation.py --dry-run            # skip DeepSeek + no state write
  python3 automation/keyword_rotation.py --keywords path/to/keywords.json
  python3 automation/keyword_rotation.py --state   path/to/rotation_state.json
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

# ── Paths ─────────────────────────────────────────────────────────────────────
AUTOMATION_DIR = Path(__file__).resolve().parent
REPO_ROOT      = AUTOMATION_DIR.parent
load_dotenv(REPO_ROOT / ".env")

# ── Ranking API config ────────────────────────────────────────────────────────
AEO_API_TOKEN = os.getenv("AEO_API_TOKEN", "")
AEO_API_BASE  = os.getenv("AEO_API_BASE", "https://jjm59vpn3y.us-east-1.awsapprunner.com")
CLIENT_ID     = os.getenv("CLIENT_ID", "5")
PLATFORM      = os.getenv("PLATFORM", "chatgpt")

# ── DeepSeek config ───────────────────────────────────────────────────────────
DEEPSEEK_API_KEY  = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL    = "deepseek-chat"

# ── Langfuse ──────────────────────────────────────────────────────────────────
from langfuse import Langfuse  # type: ignore

LANGFUSE_HOST = os.getenv("LANGFUSE_HOST", "https://us.cloud.langfuse.com")
langfuse = Langfuse(
    secret_key=os.getenv("LANGFUSE_SECRET_KEY", ""),
    public_key=os.getenv("LANGFUSE_PUBLIC_KEY", ""),
    host=LANGFUSE_HOST,
)

# ── Constants ─────────────────────────────────────────────────────────────────
TOP3_THRESHOLD    = 3    # rankingPosition <= this is "top 3"
LOCK_MIN_DAYS     = 5    # days in top 3 out of last 7 needed to lock
WINDOW_DAYS       = 7
RANKING_API_LIMIT = 1000  # API default; 242 records for clientId=5 so one call is always enough


# ═════════════════════════════════════════════════════════════════════════════
# DATA TYPES
# ═════════════════════════════════════════════════════════════════════════════

@dataclass
class KeywordConfig:
    keyword: str
    ground_truth: str
    priority: int = 1


@dataclass
class RankingWindow:
    """Aggregated 7-day ranking data for one keyword."""
    keyword: str
    top3_days: int          # days with rankingPosition <= TOP3_THRESHOLD
    current_rank: Optional[int]  # most recent day's rank (None = no data)
    all_records: list[dict] = field(default_factory=list)

    @property
    def top3_stability(self) -> float:
        return round(self.top3_days / WINDOW_DAYS, 4)

    @property
    def is_locked(self) -> bool:
        return self.top3_days >= LOCK_MIN_DAYS


# ═════════════════════════════════════════════════════════════════════════════
# CONFIG LOADING
# ═════════════════════════════════════════════════════════════════════════════

def load_keywords(path: Path) -> list[KeywordConfig]:
    with open(path) as f:
        data = json.load(f)
    return [
        KeywordConfig(
            keyword=k["keyword"],
            ground_truth=k["ground_truth"],
            priority=k.get("priority", 1),
        )
        for k in data["keywords"]
    ]


def load_state(path: Path) -> dict:
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=2, default=str)


# ═════════════════════════════════════════════════════════════════════════════
# RANKING API
# ═════════════════════════════════════════════════════════════════════════════

def _date_from_record(record: dict) -> Optional[str]:
    """Return YYYY-MM-DD from a ranking record.  Primary field is 'date'; 'timestamp' is fallback."""
    for field_name in ("date", "timestamp", "createdAt"):
        val = record.get(field_name)
        if val:
            return str(val)[:10]
    return None


async def fetch_rankings_window(
    http: httpx.AsyncClient,
    date_from: str,
    date_to: str,
) -> list[dict]:
    """
    Fetch all ranking records for the given date window.

    Response shape: { meta: { total, limit, offset, returned }, data: [...] }
    Paginates via offset if meta.returned < meta.total.
    """
    url     = f"{AEO_API_BASE}/api/ranking-reports"
    headers = {"Authorization": f"Bearer {AEO_API_TOKEN}"}
    base_params = {
        "clientId": CLIENT_ID,
        "platform": PLATFORM,
        "status":   "success",
        "dateFrom": date_from,
        "dateTo":   date_to,
        "limit":    RANKING_API_LIMIT,
    }

    all_records: list[dict] = []
    offset = 0

    while True:
        resp = await http.get(
            url,
            params={**base_params, "offset": offset},
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        body = resp.json()

        records = body.get("data", []) if isinstance(body, dict) else body
        if not isinstance(records, list):
            raise ValueError(f"Unexpected ranking API response shape: {type(body)}")

        all_records.extend(records)

        # meta.total tells us the full result set size
        meta  = body.get("meta", {}) if isinstance(body, dict) else {}
        total = meta.get("total", len(all_records))
        if len(all_records) >= total or len(records) == 0:
            break
        offset += len(records)

    return all_records


def _keyword_matches(record_kw: str, target: str) -> bool:
    """Case-insensitive, stripped match between API keyword field and target."""
    return record_kw.strip().lower() == target.strip().lower()


def build_ranking_window(
    keyword: str,
    all_records: list[dict],
    date_from: str,
) -> RankingWindow:
    """
    Filter API records for a single keyword and compute the 7-day window stats.
    Records must fall within [date_from … date_from + 6 days].
    """
    # Collect records for this keyword, sorted newest first
    kw_records = sorted(
        [
            r for r in all_records
            if _keyword_matches(r.get("keyword", r.get("query", "")), keyword)
            and _date_from_record(r) is not None
            and _date_from_record(r) >= date_from
        ],
        key=lambda r: _date_from_record(r) or "",
        reverse=True,
    )

    top3_days    = 0
    current_rank = None

    seen_dates: set[str] = set()
    for rec in kw_records:
        d = _date_from_record(rec)
        if d in seen_dates:
            continue  # one record per day per keyword
        seen_dates.add(d)

        pos = rec.get("rankingPosition")
        if pos is None:
            continue

        # Most recent day's rank
        if current_rank is None:
            current_rank = int(pos)

        if int(pos) <= TOP3_THRESHOLD:
            top3_days += 1

    return RankingWindow(
        keyword=keyword,
        top3_days=top3_days,
        current_rank=current_rank,
        all_records=kw_records,
    )


# ═════════════════════════════════════════════════════════════════════════════
# ROTATION SELECTION
# ═════════════════════════════════════════════════════════════════════════════

def select_rotation_target(
    keywords: list[KeywordConfig],
    windows: dict[str, RankingWindow],
    state: dict,
) -> Optional[KeywordConfig]:
    """
    Among active (non-locked) keywords, return the one with the lowest
    current rankingPosition. Tiebreak: lower priority number wins.
    Keywords with no ranking data are de-prioritized (treated as rank=999).
    """
    candidates = []
    for kw in keywords:
        win  = windows.get(kw.keyword)
        locked_in_state = state.get(kw.keyword, {}).get("locked", False)
        locked_by_window = win.is_locked if win else False
        if locked_in_state or locked_by_window:
            continue
        rank = (win.current_rank if win and win.current_rank is not None else 999)
        candidates.append((rank, kw.priority, kw))

    if not candidates:
        return None

    candidates.sort(key=lambda t: (t[0], t[1]))
    return candidates[0][2]


# ═════════════════════════════════════════════════════════════════════════════
# CONTENT GENERATION (DeepSeek)
# ═════════════════════════════════════════════════════════════════════════════

AEO_SYSTEM_PROMPT = """\
You are an AEO (Answer Engine Optimization) content specialist. Write content that
AI answer engines (ChatGPT, Perplexity, Google AI Overviews) will quote verbatim.

Rules:
1. First sentence must directly answer the core question about the keyword.
2. Use the exact keyword phrase naturally in the first paragraph.
3. Include specific numbers or data points from the provided ground truth.
4. Every sentence must be under 25 words.
5. No opinion, no fluff — only factual, scannable content.
6. Format: either a short FAQ (2-3 Q&A pairs) OR a 150-word blog snippet.
   Choose whichever format fits the keyword best.
"""


def _build_user_prompt(keyword: str, ground_truth: str) -> str:
    return (
        f'Keyword: "{keyword}"\n\n'
        f"Ground truth:\n{ground_truth}\n\n"
        f"Write AEO-optimized content for this keyword."
    )


async def generate_content(keyword: str, ground_truth: str) -> str:
    """Call DeepSeek and log the generation to Langfuse (v4 SDK)."""
    messages = [
        {"role": "system", "content": AEO_SYSTEM_PROMPT},
        {"role": "user",   "content": _build_user_prompt(keyword, ground_truth)},
    ]

    gen = langfuse.start_generation(
        name="deepseek-content-generation",
        model=DEEPSEEK_MODEL,
        model_parameters={"temperature": 0.3, "max_tokens": 600},
        input=messages,
    )
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{DEEPSEEK_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type":  "application/json",
                },
                json={
                    "model":       DEEPSEEK_MODEL,
                    "messages":    messages,
                    "temperature": 0.3,
                    "max_tokens":  600,
                },
                timeout=60,
            )
            resp.raise_for_status()
            payload = resp.json()
            content = payload["choices"][0]["message"]["content"]
            usage   = payload.get("usage", {})
            gen.update(
                output=content,
                usage_details={
                    "input":  usage.get("prompt_tokens",     0),
                    "output": usage.get("completion_tokens", 0),
                },
            )
            return content
    except Exception as exc:
        gen.update(level="ERROR", status_message=str(exc))
        raise
    finally:
        gen.end()


# ═════════════════════════════════════════════════════════════════════════════
# LANGFUSE LOGGING  (v4 SDK)
# ═════════════════════════════════════════════════════════════════════════════

def log_keyword_to_langfuse(trace_id: str, kw: str, win: RankingWindow, decision: str) -> None:
    with langfuse.start_as_current_span(
        name="keyword-evaluation",
        input={"keyword": kw},
        output={
            "top3_days":    win.top3_days,
            "current_rank": win.current_rank,
            "locked":       win.is_locked,
            "decision":     decision,
        },
        metadata={"platform": PLATFORM, "window_days": WINDOW_DAYS},
    ):
        langfuse.create_score(
            name="top3_stability",
            value=win.top3_stability,
            trace_id=trace_id,
            comment=f"{win.top3_days}/{WINDOW_DAYS} days in top {TOP3_THRESHOLD}",
            data_type="NUMERIC",
        )


# ═════════════════════════════════════════════════════════════════════════════
# CONTENT LOG
# ═════════════════════════════════════════════════════════════════════════════

def write_content_log(
    log_dir: Path,
    today: str,
    selected: Optional[KeywordConfig],
    content: Optional[str],
    windows: dict[str, RankingWindow],
    state: dict,
) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"content_{today}.json"
    payload = {
        "date": today,
        "selected_keyword": selected.keyword if selected else None,
        "content": content,
        "keyword_summary": {
            kw: {
                "top3_days":     win.top3_days,
                "top3_stability": win.top3_stability,
                "current_rank":  win.current_rank,
                "locked":        win.is_locked or state.get(kw, {}).get("locked", False),
            }
            for kw, win in windows.items()
        },
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"  Content log written → {path}")


# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

async def main(
    keywords_path: Path,
    state_path: Path,
    dry_run: bool = False,
) -> None:
    today     = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)
    date_from = (today - datetime.timedelta(days=WINDOW_DAYS)).isoformat()
    date_to   = yesterday.isoformat()
    run_id    = f"rotation_run_{today.isoformat()}"

    print(f"AEO Keyword Rotation")
    print(f"Date  : {today.isoformat()}")
    print(f"Window: {date_from} → {date_to}")
    print(f"Mode  : {'DRY RUN' if dry_run else 'LIVE'}")
    print()

    # ── Validate env ─────────────────────────────────────────────────────────
    if not AEO_API_TOKEN:
        print("ERROR: AEO_API_TOKEN is not set.", file=sys.stderr)
        sys.exit(1)
    if not dry_run and not DEEPSEEK_API_KEY:
        print("ERROR: DEEPSEEK_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    # ── Load config + state ───────────────────────────────────────────────────
    keywords = load_keywords(keywords_path)
    state    = load_state(state_path)
    print(f"Keywords loaded: {len(keywords)}")

    # ── Fetch ranking window from API ─────────────────────────────────────────
    print(f"Fetching rankings from API …")
    async with httpx.AsyncClient() as http:
        try:
            all_records = await fetch_rankings_window(http, date_from, date_to)
        except httpx.HTTPStatusError as exc:
            print(f"ERROR: Ranking API returned {exc.response.status_code}", file=sys.stderr)
            sys.exit(1)
    print(f"  {len(all_records)} ranking records received")

    # ── Build per-keyword windows ─────────────────────────────────────────────
    windows: dict[str, RankingWindow] = {}
    for kw_cfg in keywords:
        windows[kw_cfg.keyword] = build_ranking_window(kw_cfg.keyword, all_records, date_from)

    # ── Langfuse: outer span = the trace for this run ─────────────────────────
    with langfuse.start_as_current_span(
        name=run_id,
        input={
            "date_from": date_from,
            "date_to":   date_to,
            "keywords":  [k.keyword for k in keywords],
            "platform":  PLATFORM,
            "client_id": CLIENT_ID,
        },
        metadata={"dry_run": dry_run},
    ):
        langfuse.update_current_trace(
            name=run_id,
            tags=["keyword-rotation", PLATFORM],
        )
        trace_id = langfuse.get_current_trace_id()

        # ── Evaluate each keyword; update state ───────────────────────────────
        print()
        print(f"{'Keyword':<45} {'Top3':>5} {'Stab':>6} {'Rank':>6}  Status")
        print("─" * 72)

        for kw_cfg in keywords:
            win        = windows[kw_cfg.keyword]
            kw_state   = state.setdefault(kw_cfg.keyword, {"locked": False, "locked_since": None})
            was_locked = kw_state["locked"]

            # Persist lock once triggered — never auto-unlock
            if win.is_locked and not was_locked:
                kw_state["locked"]       = True
                kw_state["locked_since"] = today.isoformat()

            locked   = kw_state["locked"]
            decision = "locked" if locked else "active"
            rank_str = str(win.current_rank) if win.current_rank else "–"
            status   = "LOCKED" if locked else "active"

            print(
                f"{kw_cfg.keyword:<45} {win.top3_days:>5} {win.top3_stability:>6.2f} "
                f"{rank_str:>6}  {status}"
            )
            log_keyword_to_langfuse(trace_id, kw_cfg.keyword, win, decision)

        # ── Select rotation target ────────────────────────────────────────────
        selected = select_rotation_target(keywords, windows, state)
        print()
        content  = None

        if selected is None:
            print("  All keywords are locked (top-3 for 5+ of last 7 days). Nothing to rotate.")
            langfuse.update_current_trace(output={"result": "all_locked"})
        else:
            win      = windows[selected.keyword]
            rank_str = str(win.current_rank) if win.current_rank else "no ranking data"
            print(f"  Selected for rotation: \"{selected.keyword}\" (current rank: {rank_str})")

            # ── Generate AEO content ──────────────────────────────────────────
            if dry_run:
                print("  [DRY RUN] Skipping DeepSeek content generation.")
            else:
                print(f"  Generating AEO content via DeepSeek …", end=" ", flush=True)
                try:
                    content = await generate_content(selected.keyword, selected.ground_truth)
                    print("done")
                    print()
                    print("─" * 72)
                    print(content)
                    print("─" * 72)
                except Exception as exc:
                    print(f"FAILED: {exc}", file=sys.stderr)

            langfuse.update_current_trace(
                output={
                    "result":            "rotation_selected",
                    "selected_keyword":  selected.keyword,
                    "current_rank":      win.current_rank,
                    "top3_stability":    win.top3_stability,
                    "content_generated": content is not None,
                }
            )

    # ── Write content log ─────────────────────────────────────────────────────
    write_content_log(
        AUTOMATION_DIR / "logs",
        today.isoformat(),
        selected,
        content,
        windows,
        state,
    )

    # ── Persist state ─────────────────────────────────────────────────────────
    if not dry_run:
        save_state(state_path, state)
        print(f"  State saved → {state_path}")

    # ── Flush Langfuse (guarantees all events reach the server) ───────────────
    langfuse.flush()
    print()
    print("Rotation cycle complete.")


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEO Keyword Rotation")
    parser.add_argument(
        "--keywords",
        type=Path,
        default=AUTOMATION_DIR / "keywords.json",
        help="Path to keywords JSON file (default: automation/keywords.json)",
    )
    parser.add_argument(
        "--state",
        type=Path,
        default=AUTOMATION_DIR / "rotation_state.json",
        help="Path to rotation state JSON file (default: automation/rotation_state.json)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch rankings and evaluate keywords, but skip DeepSeek and state write",
    )
    args = parser.parse_args()

    asyncio.run(main(
        keywords_path=args.keywords,
        state_path=args.state,
        dry_run=args.dry_run,
    ))
