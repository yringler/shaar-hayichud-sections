"""Words -> the MMS_FA alphabet (lowercase a-z and apostrophe).

English words are lowercased, digits spelled out; Hebrew words (Sofer writes
them in Hebrew letters) get a simple Ashkenazi-flavoured transliteration: a
consonant skeleton plus the vowel letters, with sav as "s", initial
bet/kaf/pe/tav hard. MMS_FA is a multilingual character model, so a rough
spelling of what was said aligns well enough; badly spelled words just score
low and are interpolated instead of anchoring.

Bump TRANSLITERATION when the output for any word changes: it is recorded in
every data/retimed/ file's `method`.
"""
from __future__ import annotations

import re

TRANSLITERATION = "ashkenazi-v1"

_ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen"
).split()
_TENS = "x x twenty thirty forty fifty sixty seventy eighty ninety".split()


def num_words(n: int) -> str:
    """12 -> "twelve", 1984 -> "onethousandninehundredeightyfour"; "" from 10000 up."""
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + "hundred" + ("" if n % 100 == 0 else num_words(n % 100))
    if n < 10000:
        return num_words(n // 1000) + "thousand" + ("" if n % 1000 == 0 else num_words(n % 1000))
    return ""


_HEB = {
    "א": "", "ב": "v", "ג": "g", "ד": "d", "ה": "h", "ו": "o", "ז": "z", "ח": "ch",
    "ט": "t", "י": "i", "כ": "ch", "ך": "ch", "ל": "l", "מ": "m", "ם": "m", "נ": "n",
    "ן": "n", "ס": "s", "ע": "", "פ": "f", "ף": "f", "צ": "tz", "ץ": "tz", "ק": "k",
    "ר": "r", "ש": "sh", "ת": "s",
}
_HEB_INIT = {"ב": "b", "כ": "k", "פ": "p", "ת": "t", "ו": "v", "י": "y", "א": "a", "ע": "a"}
_NIKUD = re.compile(r"[֑-ׇ]")
_HEBREW_LETTER = re.compile(r"[א-ת]")


def translit_he(word: str) -> str:
    w = _NIKUD.sub("", word)
    w = w.replace("װ", "וו").replace("ױ", "וי").replace("ײ", "יי")
    letters = [c for c in w if c in _HEB]
    out = []
    for i, c in enumerate(letters):
        if i == 0 and c in _HEB_INIT:
            out.append(_HEB_INIT[c])
        elif c == "ו" and i + 1 < len(letters) and letters[i + 1] == "ו":
            out.append("v")
        elif c == "ו" and i > 0 and letters[i - 1] == "ו":
            continue
        elif c == "ה" and i == len(letters) - 1:
            out.append("a")
        else:
            out.append(_HEB[c])
    return "".join(out)


def romanize(word: str) -> tuple[str, bool]:
    """(characters to align, is_hebrew). The characters may be empty (punctuation, huge numbers)."""
    if _HEBREW_LETTER.search(word):
        return re.sub(r"[^a-z]", "", translit_he(word)), True
    s = word.lower().replace("’", "'")
    s = re.sub(r"\d+", lambda m: num_words(int(m.group())), s)
    s = re.sub(r"[^a-z']", "", s).strip("'")
    return s, False
