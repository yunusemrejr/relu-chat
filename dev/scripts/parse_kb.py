#!/usr/bin/env python3
"""
Robust parser for knowledge-base.js files.
Parses the JS kb() function calls and extracts fragment data.
"""

import re, json, sys, os

def parse_kb_file(filepath):
    """Parse a knowledge-base.js file and return list of topic dicts."""
    with open(filepath, 'r') as f:
        text = f.read()
    
    topics = []
    # Split on kb(' to find each topic
    parts = text.split("kb('")
    
    for part in parts[1:]:
        try:
            topic = parse_kb_part(part)
            if topic:
                topics.append(topic)
        except Exception as e:
            # Extract topic id for error message
            tid = part.split("'")[0] if "'" in part else "unknown"
            print(f"  Warning: failed to parse topic '{tid}': {e}", file=sys.stderr)
            continue
    
    return topics

def parse_kb_part(part):
    """Parse a single kb() call content (without the leading kb(')."""
    
    # 1. Extract topic_id (up to the closing quote before first comma)
    id_end = find_closing_quote(part, 0)
    topic_id = part[:id_end]
    
    rest = part[id_end + 1:]  # skip the closing ' and any following chars
    
    # 2. Skip to the name string
    name_start = rest.index("'") + 1
    name_end = find_closing_quote(rest, name_start)
    name = rest[name_start:name_end]
    
    after_name = rest[name_end + 1:]
    
    # 3. Skip aliases array [...]
    # Strip leading comma and whitespace
    after_name = after_name.lstrip()
    if after_name.startswith(','):
        after_name = after_name[1:].lstrip()
    
    alias_end = find_matching_bracket(after_name, '[', ']') if after_name.startswith('[') else 0
    after_aliases = after_name[alias_end:] if alias_end > 0 else after_name
    
    # 4. Extract summary string
    after_aliases = after_aliases.lstrip()
    if after_aliases.startswith(','):
        after_aliases = after_aliases[1:].lstrip()
    
    summ_start = after_aliases.index("'") + 1
    summ_end = find_closing_quote(after_aliases, summ_start)
    summary = after_aliases[summ_start:summ_end]
    
    after_summary = after_aliases[summ_end + 1:]
    
    # 5. Extract fragments object {...}
    after_summary = after_summary.lstrip()
    if after_summary.startswith(','):
        after_summary = after_summary[1:].lstrip()
    
    if not after_summary.startswith('{'):
        return None  # No fragments object
    
    frag_end = find_matching_bracket(after_summary, '{', '}')
    frag_text = after_summary[:frag_end]
    after_frags = after_summary[frag_end:]
    
    # 6. Extract related array (optional)
    related = []
    after_frags = after_frags.lstrip()
    if after_frags.startswith(','):
        after_frags = after_frags[1:].lstrip()
    if after_frags.startswith('['):
        rel_end = find_matching_bracket(after_frags, '[', ']')
        rel_text = after_frags[1:rel_end - 1]
        related = re.findall(r"'([^']*)'", rel_text)
    
    # 7. Parse fragments
    fragments = parse_fragments_obj(frag_text)
    
    return {
        'id': topic_id,
        'name': name,
        'summary': summary,
        'fragments': fragments,
        'related': related
    }

def find_closing_quote(text, start):
    """Find the closing single quote, handling escaped quotes."""
    i = start
    while i < len(text):
        if text[i] == '\\':
            i += 2  # skip escaped char
            continue
        if text[i] == "'":
            return i
        i += 1
    return len(text)

def find_matching_bracket(text, open_ch, close_ch):
    """Find the position after the matching close bracket."""
    depth = 1
    i = 1  # start after opening bracket
    in_str = False
    while i < len(text) and depth > 0:
        ch = text[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == "'":
                in_str = False
            i += 1
            continue
        if ch == "'":
            in_str = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
        i += 1
    return i  # position after closing bracket

def parse_fragments_obj(frag_text):
    """Parse the {def:[...], int:[...], ex:[...], form:[...], app:[...]} object."""
    fragments = {'def': [], 'int': [], 'ex': [], 'form': [], 'app': []}
    
    for ftype in ['def', 'int', 'ex', 'form', 'app']:
        # Find ftype: [...] within frag_text
        pattern = ftype + r"\s*:\s*\["
        m = re.search(pattern, frag_text)
        if not m:
            continue
        
        # Find the matching ] for this array
        # Start from the opening [
        bracket_pos = m.end() - 1  # position of the opening [
        arr_end = find_matching_bracket(frag_text[bracket_pos:], '[', ']') + bracket_pos
        arr_text = frag_text[m.end():arr_end - 1]  # content between [ and ]
        
        # Extract single-quoted strings
        strings = extract_js_strings(arr_text)
        fragments[ftype] = strings
    
    return fragments

def extract_js_strings(text):
    """Extract single-quoted JavaScript strings from text, handling escaping."""
    result = []
    i = 0
    while i < len(text):
        if text[i] == "'":
            j = i + 1
            chars = []
            while j < len(text):
                if text[j] == '\\':
                    # Check next char
                    if j + 1 < len(text):
                        next_ch = text[j + 1]
                        if next_ch == "'":
                            chars.append("'")
                        elif next_ch == '\\':
                            chars.append("\\")
                        elif next_ch == 'n':
                            chars.append("\n")
                        else:
                            chars.append('\\' + next_ch)
                        j += 2
                    else:
                        j += 1
                elif text[j] == "'":
                    break
                else:
                    chars.append(text[j])
                    j += 1
            result.append(''.join(chars))
            i = j + 1
        else:
            i += 1
    return result

if __name__ == '__main__':
    filepath = sys.argv[1] if len(sys.argv) > 1 else None
    if not filepath:
        print("Usage: python3 parse_kb.py <path/to/knowledge-base.js>")
        sys.exit(1)
    
    topics = parse_kb_file(filepath)
    print(json.dumps(topics, indent=2, ensure_ascii=False))
