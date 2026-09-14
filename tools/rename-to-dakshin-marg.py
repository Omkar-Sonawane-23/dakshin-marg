#!/usr/bin/env python3
"""
One-shot product rename: POLARIS-X -> Dakshin Marg.

Only the *product* name is rewritten. The IMO **POLARIS** risk methodology
(MSC.1/Circ.1519 RIO, POLARIS Table 1.2, `polaris-overland-risk`,
`polaris_category`, `POLARIS_SEVERITY`, `polarisClass`, ...) is a published
international standard and is deliberately left untouched.

Usage:  python3 tools/rename-to-dakshin-marg.py [--check]
        --check  → report only, write nothing
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".cache"}
# This script's own pattern table must survive the rewrite untouched.
SKIP_FILES = {"tools/rename-to-dakshin-marg.py"}
SKIP_EXT = {".mp4", ".webm", ".mov", ".jpg", ".jpeg", ".png", ".gif", ".ico", ".br", ".woff",
            ".woff2", ".pyc", ".mp3", ".wav", ".m4a", ".zip", ".gz", ".pdf"}

# ── ordered identifier rules (most specific first) ──────────────────────────
IDENT_RULES: list[tuple[str, str]] = [
    (r"START-POLARIS-X", "START-DAKSHIN-MARG"),        # Windows launcher filename
    (r"POLARIS-X-demo", "Dakshin-Marg-demo"),          # video artefacts
    (r"POLARIS-X-narration", "Dakshin-Marg-narration"),
    (r"POLARIS-X-prototype", "DakshinMarg-prototype"),  # HTTP User-Agent: no spaces
    (r"polaris-x-backend", "dakshin-marg-backend"),     # npm package / service name
    (r"polaris-x", "dakshin-marg"),                     # kebab-case identifier
    (r"polaris_x", "dakshin_marg"),                     # MongoDB database name
    (r"polaris-theme", "dakshin-marg-theme"),           # localStorage key
    (r"POLARIS_BASE", "DAKSHIN_MARG_BASE"),             # env override in verify script
]

# Files where `POLARIS-X` is rendered as an all-caps wordmark (logo lockups,
# window titles, banners). Everywhere else prose gets title case.
WORDMARK_FILES = {
    "frontend/index.html",
    "frontend/src/components/TopBar.tsx",
    "frontend/src/App.tsx",
    "START-POLARIS-X.bat",
    "START-DAKSHIN-MARG.bat",
    "docs/video/tools/card_title.html",
    "docs/video/tools/card_end.html",
    "tools/demo-video/src/cards/title.html",
    "tools/demo-video/src/cards/end.html",
}

BRAND_RE = re.compile(r"POLARIS-X")


def rewrite(text: str, rel: str) -> str:
    caps = rel.replace("\\", "/") in WORDMARK_FILES
    # Identifier/filename rules first so `START-POLARIS-X.bat` becomes
    # `START-DAKSHIN-MARG.bat` (never `START-Dakshin Marg.bat`).
    for pattern, replacement in IDENT_RULES:
        text = re.sub(pattern, replacement, text)
    # Whatever is left is prose/wordmark usage of the product name.
    return BRAND_RE.sub("DAKSHIN MARG" if caps else "Dakshin Marg", text)


def main() -> int:
    check = "--check" in sys.argv
    total = 0
    touched: list[str] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if os.path.splitext(name)[1].lower() in SKIP_EXT:
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, ROOT)
            if rel.replace("\\", "/") in SKIP_FILES:
                continue
            try:
                with open(full, "r", encoding="utf-8") as fh:
                    original = fh.read()
            except (UnicodeDecodeError, OSError):
                continue
            hits = len(BRAND_RE.findall(original)) + sum(
                len(re.findall(p, original)) for p, _ in IDENT_RULES
            )
            updated = rewrite(original, rel)
            if updated != original:
                total += hits
                touched.append(rel)
                if check:
                    print(f"  would rewrite  {rel}  ({hits})")
                else:
                    with open(full, "w", encoding="utf-8") as fh:
                        fh.write(updated)
    print(f"{'Would rewrite' if check else 'Rewrote'} {total} product-name "
          f"occurrence(s) across {len(touched)} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
