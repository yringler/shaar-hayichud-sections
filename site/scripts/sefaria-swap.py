"""Swap Sefaria text (phrase per line) into already-divided chapter JSON, keeping the
tree, labels, translations and line ids. Usage: sefaria-swap.py SEFARIA_DIR CHAPTERS_DIR N...
SEFARIA_DIR holds cN.json from /api/v3/texts/The_Gate_of_Unity.N?version=hebrew|Neirot, 2023

Chapters must already have line ids (data/tools: yarn assign-line-ids). Every output word
is credited to the old line it came from (a respelled word counts for the old word it
replaces). Within each run of lines, output lines and old line ids are then paired one to
one, in order, keeping as many credited words as possible (see match_ids); an output line
left without an old id gets a new one, and an old id left without a line disappears.
New ids are random and unique across every chapter in CHAPTERS_DIR.
Tests: python3 -m unittest discover -s scripts (from site/)."""
import glob, json, re, secrets, sys
from difflib import SequenceMatcher

HEB = re.compile(r"[א-ת]")
LINE_ID = re.compile(r"^[a-z2-7]{8}$")
ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"


def is_line(c):
    return isinstance(c, dict) and "children" not in c and "text" in c


def new_line_id(taken):
    """Same scheme as data/tools/src/line-id.ts: 8 random lowercase base32 chars."""
    while True:
        i = "".join(ID_ALPHABET[b & 31] for b in secrets.token_bytes(8))
        if i not in taken:
            taken.add(i)
            return i


def corpus_line_ids(ch_dir):
    taken = set()

    def walk(nodes):
        for c in nodes:
            if is_line(c):
                taken.add(c["id"])
            elif isinstance(c, dict):
                walk(c.get("children", []))

    for path in glob.glob(f"{ch_dir}/chapter_*.json"):
        walk(json.load(open(path, encoding="utf-8")))
    return taken


def norm(w):
    return "".join(HEB.findall(w))


def tokenize(text):
    """-> list of (word, sep_after). Tokens without Hebrew letters glue onto the previous one."""
    out = []
    for m in re.finditer(r"(\S+)(\s*)", text):
        word, sep = m.group(1), m.group(2)
        sep = "\n" if "\n" in sep else " "
        if out and not norm(word):
            pw, _ = out[-1]
            out[-1] = (pw + " " + word if not re.match(r"^[.,:;)\]״׳'\"]", word) else pw + word, sep)
        elif not out and not norm(word):
            out.append((word, sep))  # leading punctuation, keep as its own token
        else:
            out.append((word, sep))
    return out


def leaves_of(nodes, acc):
    """-> list of (children array, start, end): each maximal run of Line objects."""
    i = 0
    while i < len(nodes):
        n = nodes[i]
        if isinstance(n, str):
            sys.exit("found a plain-string child: run `yarn assign-line-ids` in data/tools first")
        if is_line(n):
            if not LINE_ID.match(n.get("id", "")):
                sys.exit(f"line without a valid id: {n!r}: run `yarn assign-line-ids` in data/tools first")
            j = i
            while j < len(nodes) and is_line(nodes[j]):
                j += 1
            acc.append((nodes, i, j))
            i = j
        else:
            leaves_of(n.get("children", []), acc)
            i += 1
    return acc


def swap(old_tree, sefaria_lines, taken):
    leaf_refs = leaves_of(old_tree, [])
    old_toks, owner, src = [], [], []  # owner[k] = leaf index, src[k] = old line id of old token k
    for li, (arr, start, end) in enumerate(leaf_refs):
        for line in arr[start:end]:
            for t in tokenize(line["text"]):
                old_toks.append((t[0], " "))
                owner.append(li)
                src.append(line["id"])
    new_toks = tokenize("\n".join(s.strip() for s in sefaria_lines if s.strip()))

    a = [norm(w) for w, _ in old_toks]
    b = [norm(w) for w, _ in new_toks]
    sm = SequenceMatcher(None, a, b, autojunk=False)

    out = [[] for _ in leaf_refs]  # per-leaf lists of (word, sep, old line id or None)
    stats = {"old_words": len(a), "swapped": 0, "kept": 0, "inserted": 0, "big": [], "new_ids": 0}

    def text(toks):
        return " ".join(t[0] for t in toks)

    for op, i1, i2, j1, j2 in sm.get_opcodes():
        inner_boundary = any(owner[k] != owner[k - 1] for k in range(i1 + 1, i2))
        if op == "equal":
            use_new = True
        elif op == "replace":
            oc, nc = sum(map(len, a[i1:i2])), sum(map(len, b[j1:j2]))
            small = (i2 - i1) <= 3 and (j2 - j1) <= 6
            use_new = not inner_boundary and (small or 0.5 <= nc / max(oc, 1) <= 4.5)
            if (i2 - i1) > 3 or (j2 - j1) > 6:
                stats["big"].append(("replace" + ("->new" if use_new else "->kept"), text(old_toks[i1:i2]), text(new_toks[j1:j2])))
        elif op == "delete":
            use_new = False
            if i2 - i1 > 2:
                stats["big"].append(("delete->kept", text(old_toks[i1:i2]), ""))
        else:  # insert
            use_new = (j2 - j1) <= 4
            if not use_new:
                stats["big"].append(("insert->skipped", "", text(new_toks[j1:j2])))

        if op == "equal":
            # 1:1 word mapping; the run may cross leaf boundaries
            for k, j in zip(range(i1, i2), range(j1, j2)):
                out[owner[k]].append((*new_toks[j], src[k]))
            stats["swapped"] += i2 - i1
        elif use_new:
            if op == "insert":
                li = owner[i1 - 1] if i1 > 0 else owner[0]
            else:
                li = owner[i1]
            if op == "insert":
                out[li].extend((w, sep, None) for w, sep in new_toks[j1:j2])
            else:
                # Respelled words: credit each new word to the aligned old word's line.
                n_old, n_new = i2 - i1, j2 - j1
                out[li].extend(
                    (w, sep, src[i1 + k * n_old // n_new]) for k, (w, sep) in enumerate(new_toks[j1:j2])
                )
            stats["inserted" if op == "insert" else "swapped"] += (j2 - j1) if op == "insert" else (i2 - i1)
        else:
            for k in range(i1, i2):
                out[owner[k]].append((*old_toks[k], src[k]))
            stats["kept"] += i2 - i1

    # Split each leaf into lines and pick ids. Replace runs back to front so earlier
    # indices in the same children array stay valid.
    for li in sorted(range(len(leaf_refs)), key=lambda li: (id(leaf_refs[li][0]), -leaf_refs[li][1])):
        arr, start, end = leaf_refs[li]
        toks = out[li]
        if not toks:
            continue  # leaf had no words – leave untouched
        groups, cur = [], []
        for t in toks:
            cur.append(t)
            if t[1] == "\n":
                groups.append(cur)
                cur = []
        groups.append(cur)
        lines = []
        for g in groups:
            line_text = "".join(w + sep for w, sep, _ in g).strip()
            if not line_text:
                continue
            counts = {}
            for _, _, sid in g:
                if sid is not None:
                    counts[sid] = counts.get(sid, 0) + 1
            lines.append((line_text, counts))
        # Every word of this leaf came from this leaf's old lines, so ids are matched per leaf.
        old_ids = [line["id"] for line in arr[start:end]]
        ids = match_ids([c for _, c in lines], old_ids)
        new_lines = []
        for (line_text, _), kept in zip(lines, ids):
            if kept is None:
                kept = new_line_id(taken)
                stats["new_ids"] += 1
            new_lines.append({"id": kept, "text": line_text})
        arr[start:end] = new_lines
    return stats


def match_ids(counts, old_ids):
    """Pair output lines with old line ids one to one, without crossing (both stay in
    document order), maximizing the total number of words each kept id's line
    contributed. counts[n] maps old id -> words of output line n credited to it.
    -> per output line, the kept old id or None."""
    n, m = len(counts), len(old_ids)
    w = [[counts[i].get(old_ids[j], 0) for j in range(m)] for i in range(n)]
    best = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            take = w[i][j] + best[i + 1][j + 1] if w[i][j] else 0
            best[i][j] = max(take, best[i + 1][j], best[i][j + 1])
    ids, i, j = [None] * n, 0, 0
    while i < n and j < m:
        if w[i][j] and best[i][j] == w[i][j] + best[i + 1][j + 1]:
            ids[i] = old_ids[j]
            i, j = i + 1, j + 1
        elif best[i + 1][j] >= best[i][j + 1]:
            i += 1
        else:
            j += 1
    return ids


def main():
    sef_dir, ch_dir = sys.argv[1], sys.argv[2]
    taken = corpus_line_ids(ch_dir)
    for n in map(int, sys.argv[3:]):
        path = f"{ch_dir}/chapter_{n:02d}.json"
        raw = open(path, encoding="utf-8").read()
        tree = json.loads(raw)
        lines = json.load(open(f"{sef_dir}/c{n}.json"))["versions"][0]["text"]
        stats = swap(tree, lines, taken)
        indent = "\t" if raw.startswith("[\n\t") else 2
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(tree, ensure_ascii=False, indent=indent) + ("\n" if raw.endswith("\n") else ""))
        print(
            f"ch{n}: old={stats['old_words']} swapped={stats['swapped']} kept={stats['kept']} "
            f"inserted={stats['inserted']} new_line_ids={stats['new_ids']}"
        )
        for kind, o, nw in stats["big"]:
            print(f"   [{kind}] OLD: {o[:150]}\n{'':6}NEW: {nw[:150]}")


if __name__ == "__main__":
    main()
