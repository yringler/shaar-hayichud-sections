"""Swap Sefaria text (phrase per line) into already-divided chapter JSON, keeping the
tree, labels and translations. Usage: sefaria-swap.py SEFARIA_DIR CHAPTERS_DIR N...
SEFARIA_DIR holds cN.json from /api/v3/texts/The_Gate_of_Unity.N?version=hebrew|Neirot, 2023"""
import json, re, sys
from difflib import SequenceMatcher

HEB = re.compile(r"[א-ת]")


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
    for idx, n in enumerate(nodes):
        if isinstance(n, str):
            acc.append((nodes, idx))
        else:
            leaves_of(n.get("children", []), acc)
    return acc


def swap(old_tree, sefaria_lines, report):
    leaf_refs = leaves_of(old_tree, [])
    old_toks, owner = [], []  # owner[k] = leaf index of old token k
    for li, (arr, idx) in enumerate(leaf_refs):
        for t in tokenize(arr[idx]):
            old_toks.append((t[0], " "))
            owner.append(li)
    new_toks = tokenize("\n".join(s.strip() for s in sefaria_lines if s.strip()))

    a = [norm(w) for w, _ in old_toks]
    b = [norm(w) for w, _ in new_toks]
    sm = SequenceMatcher(None, a, b, autojunk=False)

    out = [[] for _ in leaf_refs]  # per-leaf token lists
    stats = {"old_words": len(a), "swapped": 0, "kept": 0, "inserted": 0, "big": []}

    def text(toks):
        return " ".join(w for w, _ in toks)

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
                out[owner[k]].append(new_toks[j])
            stats["swapped"] += i2 - i1
        elif use_new:
            if op == "insert":
                li = owner[i1 - 1] if i1 > 0 else owner[0]
            else:
                li = owner[i1]
            out[li].extend(new_toks[j1:j2])
            stats["inserted" if op == "insert" else "swapped"] += (j2 - j1) if op == "insert" else (i2 - i1)
        else:
            for k in range(i1, i2):
                out[owner[k]].append(old_toks[k])
            stats["kept"] += i2 - i1

    for li, (arr, idx) in enumerate(leaf_refs):
        toks = out[li]
        if not toks:
            continue  # leaf had no words (empty string) – leave untouched
        s = "".join(w + sep for w, sep in toks).strip()
        arr[idx] = s
    return stats


def main():
    sef_dir, ch_dir = sys.argv[1], sys.argv[2]
    for n in map(int, sys.argv[3:]):
        path = f"{ch_dir}/chapter_{n:02d}.json"
        raw = open(path, encoding="utf-8").read()
        tree = json.loads(raw)
        lines = json.load(open(f"{sef_dir}/c{n}.json"))["versions"][0]["text"]
        stats = swap(tree, lines, None)
        indent = "\t" if raw.startswith("[\n\t") else 2
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(tree, ensure_ascii=False, indent=indent) + ("\n" if raw.endswith("\n") else ""))
        print(f"ch{n}: old={stats['old_words']} swapped={stats['swapped']} kept={stats['kept']} inserted={stats['inserted']}")
        for kind, o, nw in stats["big"]:
            print(f"   [{kind}] OLD: {o[:150]}\n{'':6}NEW: {nw[:150]}")


main()
