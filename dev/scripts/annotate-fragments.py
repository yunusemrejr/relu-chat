#!/usr/bin/env python3
"""
annotate-fragments.py — Annotate KB fragments with metadata for the WASM policy engine.

Usage:
    python annotate-fragments.py <path-to-knowledge.js>

Output:
    <path-without-ext>-annotated.json

Does NOT overwrite the original .js file — output is JSON only.
"""

import re
import json
import sys
import os
import math

# ---------------------------------------------------------------------------
# Heuristic config
# ---------------------------------------------------------------------------

CATEGORY_STYLE_MAP = {
    "def": "formal",
    "int": "intuitive",
    "ex": "example",
    "form": "proof",
    "app": "intuitive",
}

STYLE_CREATIVITY = {
    "formal": 0.05,
    "intuitive": 0.3,
    "example": 0.15,
    "proof": 0.1,
    "analogy": 0.25,
}

FORMULA_PATTERNS = [
    re.compile(r'\\\w+\{'),
    re.compile(r'\$'),
    re.compile(r'\\\['),
    re.compile(r'\\\('),
    re.compile(r'\\sum'),
    re.compile(r'\\frac'),
    re.compile(r'\\text'),
    re.compile(r'\\cdot'),
    re.compile(r'\\sigma'),
    re.compile(r'\\alpha'),
    re.compile(r'\\mu'),
    re.compile(r'\\lambda'),
    re.compile(r'\\in'),
    re.compile(r'\\infty'),
    re.compile(r'\\mathbb'),
    re.compile(r'\\mathcal'),
]

def estimate_tokens(text):
    words = len(text.split())
    return max(1, math.ceil(words * 1.3))

def has_formula(text):
    return any(p.search(text) for p in FORMULA_PATTERNS)

def compute_difficulty(text):
    score = 1
    if has_formula(text):
        score = max(score, 3)
    lower = text.lower()
    if any(kw in lower for kw in ("maximize", "minimize", "prove", "theorem", "lemma", "converges")):
        score = max(score, 3)
    if any(kw in lower for kw in ("convex", "gradient", "optimization", "bayesian", "posterior", "heteroscedastic")):
        score = max(score, 2)
    return score

def compute_style(category):
    return CATEGORY_STYLE_MAP.get(category, "intuitive")

def compute_creativity(style):
    return STYLE_CREATIVITY.get(style, 0.15)

def compute_requires(entry_id, related):
    return [r for r in related if r != entry_id]

# ---------------------------------------------------------------------------
# JS escape handling
# ---------------------------------------------------------------------------

def unescape_js(s):
    s = s.replace("\\'", "'")
    s = s.replace('\\"', '"')
    s = s.replace('\\n', '\n')
    s = s.replace('\\t', '\t')
    s = s.replace('\\\\', '\\')
    return s

def extract_js_strings(s):
    """Yield plain-text contents of all JS single-quoted strings (handles \\' escapes)."""
    # Pattern: opening ', then (non-quote-non-backslash OR backslash+any char)*, closing '
    for m in re.finditer(r"'((?:[^'\\]|\\.)*)'", s):
        yield unescape_js(m.group(1))

# ---------------------------------------------------------------------------
# Brace/array-aware tokeniser
# ---------------------------------------------------------------------------

def find_matching(source, start_pos, open_ch, close_ch):
    """Return the index just past the matching close_ch starting from start_pos.
    open_ch and close_ch are single chars like '{', '}', '[', ']', '(', ')'.
    Skips over strings and nested structures."""
    depth = 0
    in_str = False
    str_char = None
    i = start_pos
    while i < len(source):
        c = source[i]
        if in_str:
            if c == '\\' and i + 1 < len(source):
                i += 2
                continue
            if c == str_char:
                in_str = False
        else:
            if c in ('"', "'"):
                in_str = True
                str_char = c
            elif c == open_ch:
                depth += 1
            elif c == close_ch:
                depth -= 1
                if depth == 0:
                    return i + 1  # position after the closing char
        i += 1
    return -1  # not found

# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def parse_knowledge_js(path):
    with open(path, "r", encoding="utf-8") as f:
        source = f.read()

    entries = []
    pos = 0

    while pos < len(source):
        km = source.find("kb(", pos)
        if km == -1:
            break
        # Find matching ) for the kb(...) call
        call_end = find_matching(source, km, '(', ')')
        if call_end == -1:
            break
        call = source[km:call_end]

        # --- Parse the arguments of kb(...) ---
        # We know the structure: kb('id', 'name', [aliases...], 'summary', {f:...}, [related...])
        # Strategy: walk through the call and extract args by finding matching ] or }

        # Find the end of the first string arg (entry id)
        str_vals = list(extract_js_strings(call))
        if len(str_vals) < 2:
            pos = call_end
            continue

        # Find where the third argument ([...]) ends, then next string is summary
        # Walk the call character by character, tracking nesting level
        arg_positions = []  # list of (end_pos, is_string, value)
        depth = 0
        in_str = False
        str_char = None
        str_start = -1
        i = 0
        while i < len(call):
            c = call[i]
            if in_str:
                if c == '\\' and i + 1 < len(call):
                    i += 2
                    continue
                if c == str_char:
                    arg_positions.append((i + 1, True, unescape_js(call[str_start+1:i])))
                    in_str = False
            else:
                if c in ('"', "'"):
                    in_str = True
                    str_char = c
                    str_start = i
                elif c in ('[', '{', '('):
                    depth += 1
                elif c in (']', '}', ')'):
                    depth -= 1
            i += 1

        # We expect: str(id), str(name), arr(aliases), str(summary), obj(f), arr(related)
        # Find the pattern: after the aliases array closes, the next arg is the summary string
        # arg_positions entries alternate between non-string (array/obj) end and string end
        # Actually each entry records where a value ENDS
        # We need to reconstruct: a string starts and ends, then maybe an array/obj starts and ends

        # Simpler: re-parse the call by finding structural positions
        # 1. entry_id: first string value
        # 2. name: second string value
        # 3. aliases: the [..] that follows name's closing quote
        # 4. summary: next string after aliases close
        # 5. f-dict: the {...} after summary's closing quote
        # 6. related: the [...] after f-dict's closing brace

        # Find positions of structural elements
        # Method: find the text of each quoted string with their positions
        quoted_spans = [(m.start(), m.end(), unescape_js(m.group(1)))
                        for m in re.finditer(r"'((?:[^'\\]|\\.)*)'", call)]

        # Find array/object spans
        bracket_spans = []  # (start, end, type='arr'|'obj')
        for idx, (ch, och) in enumerate([('[', ']'), ('{', '}')]):
            for m in re.finditer(re.escape(ch), call):
                s = m.start()
                e = find_matching(call, s, ch, och)
                if e != -1:
                    bracket_spans.append((s, e, 'arr' if ch == '[' else 'obj'))
        bracket_spans.sort(key=lambda x: x[0])

        # Now match args: the call is a sequence of (value, comma_or_end) segments
        # We know the first two values are strings at quoted_spans[0] and [1]
        if len(quoted_spans) < 2:
            pos = call_end
            continue

        entry_id = quoted_spans[0][2]
        name     = quoted_spans[1][2]

        # The third argument is a [...], find the first bracket_span after name's end
        name_end = quoted_spans[1][1]
        aliases_span = None
        for bs in bracket_spans:
            if bs[0] >= name_end and bs[2] == 'arr':
                aliases_span = bs
                break

        if not aliases_span:
            pos = call_end
            continue

        # Summary is the next quoted string after aliases_span[1]
        summary = ""
        for qs in quoted_spans:
            if qs[0] >= aliases_span[1]:
                summary = qs[2]
                break

        # f-dict is the next {...} after summary
        f_dict_span = None
        for bs in bracket_spans:
            if bs[0] >= aliases_span[1] and bs[2] == 'obj':
                f_dict_span = bs
                break

        if not f_dict_span:
            pos = call_end
            continue

        # related is the last [...] after f_dict_span
        related = []
        last_arr = None
        for bs in bracket_spans:
            if bs[0] >= f_dict_span[1] and bs[2] == 'arr':
                last_arr = bs
        if last_arr:
            arr_text = source[km + last_arr[0] : km + last_arr[1]]
            related = [unescape_js(s) for s in extract_js_strings(arr_text)]

        # Extract fragments from f-dict
        f_text = call[f_dict_span[0] : f_dict_span[1]]
        frags = {}
        for cat in ("def", "int", "ex", "form", "app"):
            # Find category key and its array
            cat_match = re.search(rf'{cat}\s*:', f_text)
            if not cat_match:
                frags[cat] = []
                continue
            # Find the [ after the :
            arr_start = f_text.find('[', cat_match.end())
            if arr_start == -1:
                frags[cat] = []
                continue
            arr_end = find_matching(f_text, arr_start, '[', ']')
            if arr_end == -1:
                frags[cat] = []
                continue
            arr_content = f_text[arr_start:arr_end]
            frags[cat] = [t.strip() for t in extract_js_strings(arr_content) if t.strip()]

        entries.append({
            "id": entry_id,
            "name": name,
            "summary": summary,
            "f": frags,
            "related": related,
        })
        pos = call_end

    return entries

# ---------------------------------------------------------------------------
# Build annotated output
# ---------------------------------------------------------------------------

def annotate_entries(entries):
    output = {}
    for entry in entries:
        eid = entry["id"]
        frags_out = {}
        for cat, texts in entry["f"].items():
            frags_out[cat] = []
            for i, text in enumerate(texts):
                style = compute_style(cat)
                frags_out[cat].append({
                    "id": f"frag_{eid.replace('.', '_')}_{cat}_{i+1:03d}",
                    "text": text,
                    "meta": {
                        "truth_confidence": 0.95,
                        "difficulty": compute_difficulty(text),
                        "style": style,
                        "creativity": compute_creativity(style),
                        "requires": compute_requires(eid, entry["related"]),
                        "avoid_with": [],
                        "compatible_with": [],
                        "source_confidence": 0.9,
                        "length_tokens": estimate_tokens(text),
                    }
                })
        output[eid] = {
            "entry_id": eid,
            "name": entry["name"],
            "summary": entry["summary"],
            "related": entry["related"],
            "fragments": frags_out,
        }
    return output

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python annotate-fragments.py <knowledge.js>", file=sys.stderr)
        sys.exit(1)

    src_path = sys.argv[1]
    if not os.path.isfile(src_path):
        print(f"Error: file not found: {src_path}", file=sys.stderr)
        sys.exit(1)

    entries = parse_knowledge_js(src_path)
    annotated = annotate_entries(entries)

    base = os.path.splitext(src_path)[0]
    out_path = base + "-annotated.json"

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(annotated, f, indent=2, ensure_ascii=False)

    print(f"Annotated {len(entries)} entries → {out_path}")


if __name__ == "__main__":
    main()
