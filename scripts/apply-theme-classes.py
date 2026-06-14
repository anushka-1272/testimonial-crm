#!/usr/bin/env python3
"""Replace hardcoded light-theme Tailwind classes with semantic theme tokens."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REPLACEMENTS: list[tuple[str, str]] = [
    ("text-[#6e6e73]", "text-muted"),
    ("text-[#1d1d1f]", "text-foreground"),
    ("text-[#aeaeb2]", "text-muted/80"),
    ("text-[#6b7280]", "text-muted"),
    ("text-[#9ca3af]", "text-muted"),
    ("bg-[#f5f5f7]", "bg-background"),
    ("border-[#f0f0f0]", "border-border-subtle"),
    ("border-[#e5e5e5]", "border-border"),
    ("border-[#d4d4d8]", "border-border"),
    ("border-[#d1d5db]", "border-border"),
    ("bg-[#fafafa]", "bg-background/80"),
    ("border-gray-100", "border-border"),
    ("border-gray-200", "border-border"),
    ("text-gray-400", "text-muted"),
    ("text-gray-500", "text-muted"),
    ("text-gray-600", "text-muted"),
    ("text-gray-700", "text-foreground/80"),
    ("text-gray-800", "text-foreground"),
    ("hover:bg-[#f5f5f7]", "hover:bg-background"),
    ("hover:bg-[#fafafa]", "hover:bg-background"),
    ("hover:bg-[#f0f0f0]", "hover:bg-background"),
    ("hover:text-[#1d1d1f]", "hover:text-foreground"),
    ("shadow-[0_4px_16px_rgba(0,0,0,0.08)]", "shadow-card"),
    ("shadow-[0_2px_8px_rgba(0,0,0,0.06)]", "shadow-segment"),
    ("bg-[#f3f4f6]", "bg-border/40"),
    ("bg-gray-50", "bg-background/80"),
    ("has-[:checked]:bg-[#fafafa]", "has-[:checked]:bg-background/80"),
    ("has-[:checked]:border-[#1d1d1f]", "has-[:checked]:border-foreground"),
    ("disabled:bg-gray-100", "disabled:opacity-40"),
    ("disabled:text-gray-400", "disabled:opacity-40"),
    ("disabled:border-gray-200", "disabled:opacity-40"),
    ("disabled:bg-[#d1d5db]", "disabled:opacity-40"),
    ("disabled:text-[#6b7280]", "disabled:opacity-40"),
    ("disabled:text-[#9ca3af]", "disabled:opacity-40"),
    ("disabled:border-[#d1d5db]", "disabled:opacity-40"),
]

PRIMARY_BG_RE = re.compile(
    r"(bg-foreground(?:/[\d]+)?(?: [^\"'`]*?)? )text-white"
)
PRIMARY_HOVER_RE = re.compile(r"hover:bg-\[#2d2d2f\]", re.MULTILINE)
PRIMARY_BG_HEX_RE = re.compile(r"bg-\[#1d1d1f\]", re.MULTILINE)
OUTLINE_BORDER_RE = re.compile(r"border-\[#1d1d1f\]", re.MULTILINE)
DUP_DISABLED_RE = re.compile(r"disabled:opacity-40 disabled:opacity-40")


def migrate(text: str) -> str:
    for old, new in REPLACEMENTS:
        if old == "bg-white":
            continue
        text = text.replace(old, new)
    # Replace bg-white but not bg-white/10, text-white, etc.
    text = re.sub(r"(?<![\w-])bg-white(?![/\w])", "bg-elevated", text)
    text = PRIMARY_BG_HEX_RE.sub("bg-foreground", text)
    text = PRIMARY_HOVER_RE.sub("hover:opacity-90", text)
    text = OUTLINE_BORDER_RE.sub("border-foreground", text)
    text = PRIMARY_BG_RE.sub(r"\1text-background", text)
    text = DUP_DISABLED_RE.sub("disabled:opacity-40", text)
    # Tab active count badge
    text = text.replace("text-white/80", "text-background/80")
    return text


def main() -> int:
    globs = [
        "app/dashboard/**/*.tsx",
        "components/**/*.tsx",
        "app/login/page.tsx",
        "app/reset-password/page.tsx",
    ]
    paths: set[Path] = set()
    for pattern in globs:
        paths.update(ROOT.glob(pattern))

    changed = 0
    for path in sorted(paths):
        original = path.read_text()
        updated = migrate(original)
        if updated != original:
            path.write_text(updated)
            changed += 1
            print(f"updated {path.relative_to(ROOT)}")

    print(f"\n{changed} file(s) updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
