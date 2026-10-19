"""Replay helpers. Every edit is an exact, unique string swap, as in the
session, so a replay that drifts from the real history fails loudly."""
from pathlib import Path


def apply(path, edits):
    p = Path(path)
    s = p.read_text()
    for edit in edits:
        a, b = edit[0], edit[1]
        count = edit[2] if len(edit) > 2 else 1
        assert s.count(a) == count, (path, a[:90], s.count(a))
        s = s.replace(a, b)
    p.write_text(s)


def write(path, text):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
