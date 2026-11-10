"""`uv run python -m app.llm.prompts` rewrites prompts.lock.json after you bump a prompt's VERSION."""

from __future__ import annotations

import json
import sys

from app.llm.prompts import LOCK_FILE, lock_entries

entries = lock_entries()
with open(LOCK_FILE) as f:
    old = json.load(f)
for pid, entry in entries.items():
    prev = old.get(pid)
    if prev and prev["hash"] != entry["hash"] and prev["version"] == entry["version"]:
        sys.exit(f"{pid}: text changed but VERSION is still {entry['version']}. Bump it first.")
with open(LOCK_FILE, "w") as f:
    json.dump(entries, f, indent=2)
    f.write("\n")
print(f"Wrote {len(entries)} prompts to {LOCK_FILE}")
