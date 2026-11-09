"""Write the OpenAPI document used to generate packages/api-client.

    uv run python -m app.export_openapi openapi.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.main import create_app

if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
    out.write_text(json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {out}")
