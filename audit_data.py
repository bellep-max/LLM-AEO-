#!/usr/bin/env python3
"""
Comprehensive data audit for LLM Dashboard.
Compares reference Excel against sessions.csv, rankings.csv, and daily CSV files.
"""

import pandas as pd
import openpyxl
from pathlib import Path
from collections import defaultdict
import sys

BASE = Path("/Users/seolocalph/Downloads/LLM-Dashboard")
REF_XLSX = BASE / "csv" / "Client and business.xlsx"
SESSIONS_CSV = BASE / "artifacts/api-server/data/sessions.csv"
RANKINGS_CSV = BASE / "artifacts/api-server/data/rankings.csv"

DAILY_FILES = {
    "2026-06-01": BASE / "csv" / "daily-sessions-2026-06-01.csv",
    "2026-06-02": BASE / "csv" / "jun02_ALL_SUCCESS_consolidated.csv",
    "2026-06-03": BASE / "csv" / "jun03_daily_ALL_SUCCESS_consolidated.csv",
    "2026-06-04": BASE / "csv" / "jun04_daily_ALL_SUCCESS_consolidated.csv",
    "2026-06-05": BASE / "csv" / "jun05_daily_ALL_SUCCESS_consolidated.csv",
    "2026-06-06": BASE / "csv" / "jun06_daily_ALL_SUCCESS_consolidated.csv",
    "2026-06-08": BASE / "csv" / "jun08_daily_ALL_SUCCESS_consolidated.csv",
}

SEP = "=" * 80

def load_reference():
    """Load and normalize the Excel reference file."""
    wb = openpyxl.load_workbook(REF_XLSX)
    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))  # skip header

    # Forward-fill client name (merged cells leave None in following rows)
    ref_data = []
    current_client = None
    for client_name, account_user, biz_name in rows:
        if client_name is not None:
            current_client = str(client_name).strip()
        if biz_name is not None:
            biz_stripped = str(biz_name).strip()
            if biz_stripped:
                ref_data.append({
                    "client_name": current_client,
                    "biz_name": biz_stripped,
                })

    df = pd.DataFrame(ref_data)
    return df

def normalize(s):
    """Lowercase + strip for fuzzy comparison."""
    if pd.isna(s) or s is None:
        return ""
    return str(s).strip().lower()

def load_sessions():
    df = pd.read_csv(SESSIONS_CSV, low_memory=False)
    df["date_str"] = pd.to_datetime(df["date"], format="mixed", utc=True).dt.strftime("%Y-%m-%d")
    return df

def load_daily_csvs():
    """Load all daily CSVs into a dict of {date_str: DataFrame}."""
    daily = {}
    for date_str, path in DAILY_FILES.items():
        if path.exists():
            try:
                df = pd.read_csv(path, low_memory=False)
                # Normalize date column
                if "date" in df.columns:
                    df["date_str"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
                else:
                    df["date_str"] = date_str
                daily[date_str] = df
            except Exception as e:
                print(f"  WARNING: Could not load {path}: {e}")
        else:
            print(f"  WARNING: Missing daily file for {date_str}: {path}")
    return daily


# ─────────────────────────────────────────────────────────────────────────────
print(SEP)
print("LOADING DATA")
print(SEP)

ref_df = load_reference()
print(f"Reference: {len(ref_df)} rows, {ref_df['biz_name'].nunique()} unique biz_names, {ref_df['client_name'].nunique()} unique clients")

sessions_df = load_sessions()
print(f"Sessions: {len(sessions_df)} rows, {sessions_df['biz_name'].nunique()} unique biz_names")

daily_dfs = load_daily_csvs()
print(f"Daily files loaded: {sorted(daily_dfs.keys())}")

# Build reference lookup sets (normalized)
ref_biz_set = set(ref_df["biz_name"].str.strip())
ref_biz_norm = {normalize(b): b for b in ref_biz_set}
ref_client_for_biz = dict(zip(ref_df["biz_name"], ref_df["client_name"]))


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("SECTION 1: BUSINESS NAME MISMATCHES")
print(SEP)

session_biz_set = set(sessions_df["biz_name"].dropna().str.strip().unique())
session_biz_norm = {normalize(b): b for b in session_biz_set}

# In sessions but NOT in reference
in_sessions_not_ref = session_biz_set - ref_biz_set
# Attempt fuzzy match by normalized name
unmatched_strict = []
fuzzy_matches = []
for biz in sorted(in_sessions_not_ref):
    norm = normalize(biz)
    if norm in ref_biz_norm:
        fuzzy_matches.append((biz, ref_biz_norm[norm], "exact-norm-match"))
    else:
        # look for partial matches
        partials = [rb for nb, rb in ref_biz_norm.items() if norm in nb or nb in norm]
        if partials:
            fuzzy_matches.append((biz, partials[0], "partial-match"))
        else:
            unmatched_strict.append(biz)

print(f"\n1a. Business names in sessions.csv NOT in reference ({len(in_sessions_not_ref)} total):")
if fuzzy_matches:
    print(f"  Fuzzy/near matches ({len(fuzzy_matches)}) — likely casing/spacing issues:")
    for sess_name, ref_name, match_type in fuzzy_matches:
        print(f"    SESSION: '{sess_name}' → REF: '{ref_name}'  [{match_type}]")
if unmatched_strict:
    print(f"\n  Completely unmatched ({len(unmatched_strict)}) — NOT in reference at all:")
    for b in unmatched_strict:
        cnt = len(sessions_df[sessions_df["biz_name"] == b])
        print(f"    '{b}'  ({cnt} sessions)")
else:
    print("  None completely unmatched.")

# In reference but NOT in sessions
in_ref_not_sessions = ref_biz_set - session_biz_set
# Also check normalized
in_ref_not_sessions_strict = []
for biz in sorted(in_ref_not_sessions):
    norm = normalize(biz)
    if norm not in session_biz_norm:
        in_ref_not_sessions_strict.append(biz)

print(f"\n1b. Business names in reference NOT in sessions.csv ({len(in_ref_not_sessions)} exact, {len(in_ref_not_sessions_strict)} after fuzzy):")
for b in in_ref_not_sessions_strict:
    client = ref_client_for_biz.get(b, "?")
    print(f"    '{b}'  (client: {client})")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("SECTION 2: CLIENT NAME MISMATCHES")
print(SEP)

# For businesses in both, compare client names
common_biz = ref_biz_set & session_biz_set
mismatches = []
for biz in sorted(common_biz):
    ref_client = ref_client_for_biz.get(biz, "").strip() if ref_client_for_biz.get(biz) else ""
    # Get the predominant client name in sessions for this biz
    sess_clients = sessions_df[sessions_df["biz_name"] == biz]["client_name"].dropna()
    if sess_clients.empty:
        continue
    sess_client_counts = sess_clients.value_counts()
    sess_client = sess_client_counts.index[0].strip() if len(sess_client_counts) > 0 else ""
    if normalize(ref_client) != normalize(sess_client):
        mismatches.append({
            "biz_name": biz,
            "ref_client": ref_client,
            "sessions_client": sess_client,
            "session_count": len(sessions_df[sessions_df["biz_name"] == biz]),
        })

print(f"\nClient name mismatches for businesses in both reference and sessions ({len(mismatches)}):")
for m in mismatches:
    print(f"  Biz: '{m['biz_name']}'")
    print(f"    REF client:      '{m['ref_client']}'")
    print(f"    Sessions client: '{m['sessions_client']}'")
    print(f"    Session count: {m['session_count']}")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("SECTION 3: DATE-BY-DATE SESSION COVERAGE (Jun 1–8)")
print(SEP)

AUDIT_DATES = [f"2026-06-0{d}" for d in range(1, 9)]
# Filter sessions to audit date range
sess_in_range = sessions_df[sessions_df["date_str"].isin(AUDIT_DATES)]

print(f"\nSessions in Jun 1-8 range: {len(sess_in_range)} rows")

# Build a table: date x biz_name → session count
pivot = sess_in_range.groupby(["date_str", "biz_name"]).size().reset_index(name="session_count")

print("\n--- ZERO SESSION BUSINESSES (reference businesses with 0 sessions on a given date) ---")
print("(Only showing dates where a biz had sessions on at least one other day in the range, meaning it should have been running)")

# For each reference biz, check each date
zero_days = []
low_days = []  # 1-3 sessions (possible partial run)
for biz in sorted(ref_biz_set):
    biz_sessions = pivot[pivot["biz_name"] == biz]
    dates_with_sessions = set(biz_sessions["date_str"].tolist())

    if not dates_with_sessions:
        # No sessions at all in the entire range
        continue  # handled in section 1b

    for d in AUDIT_DATES:
        count = biz_sessions[biz_sessions["date_str"] == d]["session_count"].sum()
        if count == 0:
            zero_days.append({"date": d, "biz_name": biz, "session_count": 0})
        elif count < 4:
            low_days.append({"date": d, "biz_name": biz, "session_count": int(count)})

zero_df = pd.DataFrame(zero_days)
low_df = pd.DataFrame(low_days)

print(f"\nTotal zero-session instances: {len(zero_df)}")
print(f"Total low-session (<4) instances: {len(low_df)}")

if not zero_df.empty:
    print("\nZero-session days by date:")
    for d in AUDIT_DATES:
        day_zeros = zero_df[zero_df["date"] == d]
        if not day_zeros.empty:
            print(f"\n  {d}: {len(day_zeros)} businesses with 0 sessions:")
            for _, row in day_zeros.iterrows():
                client = ref_client_for_biz.get(row["biz_name"], "?")
                print(f"    '{row['biz_name']}'  (client: {client})")

# Show businesses with 3+ consecutive zero days
print("\n--- BUSINESSES WITH 3+ CONSECUTIVE ZERO DAYS (keyword fade risk) ---")
for biz in sorted(ref_biz_set):
    biz_sessions = {d: 0 for d in AUDIT_DATES}
    biz_pivot = pivot[pivot["biz_name"] == biz]
    for _, row in biz_pivot.iterrows():
        if row["date_str"] in biz_sessions:
            biz_sessions[row["date_str"]] = row["session_count"]

    counts = [biz_sessions[d] for d in AUDIT_DATES]
    # Check for 3 consecutive zeros
    for i in range(len(counts) - 2):
        if counts[i] == 0 and counts[i+1] == 0 and counts[i+2] == 0:
            zero_start = AUDIT_DATES[i]
            has_any = any(c > 0 for c in counts)
            if has_any:  # only flag if biz normally runs
                client = ref_client_for_biz.get(biz, "?")
                print(f"  '{biz}' (client: {client})")
                for j, d in enumerate(AUDIT_DATES):
                    print(f"    {d}: {counts[j]}")
                break

# 2+ zero days in 7-day window = AT RISK
print("\n--- BUSINESSES AT RISK: 2+ zero-session days in Jun 1-8 window ---")
at_risk = []
for biz in sorted(ref_biz_set):
    biz_sessions = {d: 0 for d in AUDIT_DATES}
    biz_pivot = pivot[pivot["biz_name"] == biz]
    for _, row in biz_pivot.iterrows():
        if row["date_str"] in biz_sessions:
            biz_sessions[row["date_str"]] = row["session_count"]
    counts = [biz_sessions[d] for d in AUDIT_DATES]
    zero_count = sum(1 for c in counts if c == 0)
    has_any = any(c > 0 for c in counts)
    if has_any and zero_count >= 2:
        at_risk.append((biz, zero_count, counts))

print(f"Total at-risk businesses: {len(at_risk)}")
for biz, zero_count, counts in at_risk:
    client = ref_client_for_biz.get(biz, "?")
    summary = " | ".join(f"{d.split('-')[2]}: {c}" for d, c in zip(AUDIT_DATES, counts))
    print(f"  '{biz}' (client: {client}) — {zero_count} zero days — {summary}")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("SECTION 4: DAILY CSV FILES vs sessions.csv CONSISTENCY")
print(SEP)

for date_str, daily_df in sorted(daily_dfs.items()):
    print(f"\n--- {date_str} ---")

    # Get session biz_name counts from daily CSV
    if "biz_name" not in daily_df.columns:
        print(f"  WARNING: No biz_name column in daily file for {date_str}")
        continue

    daily_counts = daily_df.groupby("biz_name").size().to_dict()

    # Get session biz_name counts from sessions.csv for same date
    sess_day = sessions_df[sessions_df["date_str"] == date_str]
    sess_counts = sess_day.groupby("biz_name").size().to_dict()

    daily_biz = set(daily_counts.keys())
    sess_biz = set(sess_counts.keys())

    in_daily_not_sess = daily_biz - sess_biz
    in_sess_not_daily = sess_biz - daily_biz

    if in_daily_not_sess:
        print(f"  Businesses in daily CSV but NOT in sessions.csv ({len(in_daily_not_sess)}):")
        for b in sorted(in_daily_not_sess):
            print(f"    '{b}'  ({daily_counts[b]} sessions in daily)")
    else:
        print(f"  All businesses in daily CSV are present in sessions.csv. ✓")

    if in_sess_not_daily:
        print(f"  Businesses in sessions.csv but NOT in daily CSV ({len(in_sess_not_daily)}):")
        for b in sorted(in_sess_not_daily):
            print(f"    '{b}'  ({sess_counts[b]} sessions in sessions.csv)")
    else:
        print(f"  All businesses in sessions.csv are present in daily CSV. ✓")

    # Count mismatches
    count_mismatches = []
    for biz in daily_biz & sess_biz:
        d_cnt = daily_counts[biz]
        s_cnt = sess_counts[biz]
        if d_cnt != s_cnt:
            count_mismatches.append((biz, d_cnt, s_cnt))

    if count_mismatches:
        print(f"  Session count mismatches for same business ({len(count_mismatches)}):")
        for biz, d_cnt, s_cnt in sorted(count_mismatches):
            print(f"    '{biz}': daily={d_cnt}, sessions.csv={s_cnt}  (diff: {s_cnt - d_cnt:+d})")
    else:
        print(f"  Session counts match for all shared businesses. ✓")

    # Total rows
    print(f"  Daily CSV total rows: {len(daily_df)}, Sessions.csv for {date_str}: {len(sess_day)}")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("SECTION 5: SESSION COUNTS PER BUSINESS — TOTALS AND DATE RANGE")
print(SEP)

biz_stats = sessions_df.groupby("biz_name").agg(
    total_sessions=("id", "count"),
    first_date=("date_str", "min"),
    last_date=("date_str", "max"),
    date_count=("date_str", "nunique"),
).reset_index()

# Compute per-day average
biz_stats["avg_per_day"] = (biz_stats["total_sessions"] / biz_stats["date_count"]).round(1)

# Get Jun 1-8 session count per biz
jun_counts = sess_in_range.groupby("biz_name").size().reset_index(name="jun1_8_count")
biz_stats = biz_stats.merge(jun_counts, on="biz_name", how="left")
biz_stats["jun1_8_count"] = biz_stats["jun1_8_count"].fillna(0).astype(int)

median_total = biz_stats["total_sessions"].median()
q1 = biz_stats["total_sessions"].quantile(0.25)
q3 = biz_stats["total_sessions"].quantile(0.75)

print(f"\nOverall stats: median={median_total:.0f}, Q1={q1:.0f}, Q3={q3:.0f}")
print(f"Range: {biz_stats['total_sessions'].min()} to {biz_stats['total_sessions'].max()}")

# Flag abnormally low (less than half median) or high (3x median)
LOW_THRESHOLD = median_total * 0.3
HIGH_THRESHOLD = median_total * 3.0

print(f"\nAbnormally LOW total sessions (< {LOW_THRESHOLD:.0f}):")
low_biz = biz_stats[biz_stats["total_sessions"] < LOW_THRESHOLD].sort_values("total_sessions")
for _, row in low_biz.iterrows():
    in_ref = "IN-REF" if row["biz_name"] in ref_biz_set else "NOT-IN-REF"
    print(f"  [{in_ref}] '{row['biz_name']}': {row['total_sessions']} sessions over {row['date_count']} days ({row['first_date']} to {row['last_date']}) | Jun1-8: {row['jun1_8_count']}")

print(f"\nAbnormally HIGH total sessions (> {HIGH_THRESHOLD:.0f}):")
high_biz = biz_stats[biz_stats["total_sessions"] > HIGH_THRESHOLD].sort_values("total_sessions", ascending=False)
for _, row in high_biz.iterrows():
    in_ref = "IN-REF" if row["biz_name"] in ref_biz_set else "NOT-IN-REF"
    print(f"  [{in_ref}] '{row['biz_name']}': {row['total_sessions']} sessions over {row['date_count']} days | Jun1-8: {row['jun1_8_count']}")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("SECTION 6: HEALTH MONITOR — BUSINESSES WITH RECENT LOW/ZERO SESSIONS (Jun 1-8)")
print(SEP)

# For each reference business, check Jun 1-8 specifically
print("\nReference businesses with ZERO sessions in all of Jun 1-8:")
zero_in_jun = []
sparse_in_jun = []
for biz in sorted(ref_biz_set):
    jun_count = sess_in_range[sess_in_range["biz_name"] == biz].shape[0]
    expected = 8 * 8  # 8 days * 8 sessions per day minimum
    if jun_count == 0:
        # Check if they have any sessions at all (might be new or ended)
        total = sessions_df[sessions_df["biz_name"] == biz].shape[0]
        zero_in_jun.append((biz, total))
    elif jun_count < 20:  # Less than ~30% of expected
        sparse_in_jun.append((biz, jun_count))

print(f"\nZero sessions Jun 1-8 ({len(zero_in_jun)}):")
for biz, total in sorted(zero_in_jun, key=lambda x: x[1]):
    client = ref_client_for_biz.get(biz, "?")
    print(f"  '{biz}' (client: {client}) — total all time: {total}")

print(f"\nVery sparse sessions Jun 1-8 (<20 total, {len(sparse_in_jun)}):")
for biz, count in sorted(sparse_in_jun, key=lambda x: x[1]):
    client = ref_client_for_biz.get(biz, "?")
    print(f"  '{biz}' (client: {client}) — Jun 1-8 sessions: {count}")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("SECTION 7: RANKINGS.CSV BUSINESS NAME AUDIT")
print(SEP)

rankings_df = pd.read_csv(RANKINGS_CSV, low_memory=False)
print(f"Rankings rows: {len(rankings_df)}")
rank_biz_set = set(rankings_df["biz_name"].dropna().str.strip().unique())

in_rank_not_ref = rank_biz_set - ref_biz_set
in_ref_not_rank = ref_biz_set - rank_biz_set

print(f"\nBusiness names in rankings NOT in reference ({len(in_rank_not_ref)}):")
for b in sorted(in_rank_not_ref):
    cnt = len(rankings_df[rankings_df["biz_name"] == b])
    print(f"  '{b}'  ({cnt} ranking rows)")

print(f"\nBusiness names in reference NOT in rankings ({len(in_ref_not_rank)}):")
for b in sorted(in_ref_not_rank):
    client = ref_client_for_biz.get(b, "?")
    print(f"  '{b}'  (client: {client})")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("SECTION 8: SUMMARY OF CRITICAL ISSUES")
print(SEP)

print(f"""
CRITICAL ISSUES SUMMARY:
1. Biz names in sessions but NOT in reference: {len(unmatched_strict)} completely unmatched + {len(fuzzy_matches)} fuzzy matches
2. Biz names in reference but NOT in sessions: {len(in_ref_not_sessions_strict)}
3. Client name mismatches: {len(mismatches)}
4. Businesses at risk (2+ zero days in Jun 1-8): {len(at_risk)}
5. Reference businesses with zero sessions Jun 1-8: {len(zero_in_jun)}
6. Businesses in rankings not in reference: {len(in_rank_not_ref)}
7. Businesses in reference not in rankings: {len(in_ref_not_rank)}
""")
