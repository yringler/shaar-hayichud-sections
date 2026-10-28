"""Tests for sefaria-swap.py's line id carry-over. Run from site/:
python3 -m unittest discover -s scripts"""
import importlib.util
import pathlib
import unittest

_spec = importlib.util.spec_from_file_location("sefaria_swap", pathlib.Path(__file__).with_name("sefaria-swap.py"))
swap_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(swap_mod)

IDS = ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"]


def run(old_texts, new_texts):
    """Swap new_texts into one section of old_texts lines -> [(id or 'NEW', text)]."""
    old_ids = IDS[: len(old_texts)]
    tree = [{"children": [{"id": i, "text": t} for i, t in zip(old_ids, old_texts)]}]
    taken = set(old_ids)
    swap_mod.swap(tree, new_texts, taken)
    return [(c["id"] if c["id"] in old_ids else "NEW", c["text"]) for c in tree[0]["children"]]


class SwapLineIds(unittest.TestCase):
    def test_identical_text_keeps_every_id(self):
        old = ["שלום עולם הזה", "אמר", "דוד הלך לביתו"]
        self.assertEqual(run(old, old), list(zip(IDS, old)))

    def test_respelled_one_word_line_keeps_its_id(self):
        out = run(["שלום עולם הזה", "אמר", "דוד הלך לביתו"], ["שלום עולם הזה", "אומר", "דוד הלך לביתו"])
        self.assertEqual([i for i, _ in out], IDS[:3])
        self.assertEqual(out[1][1], "אומר")

    def test_fully_respelled_line_keeps_its_id(self):
        self.assertEqual(run(["אבא בבא גגא"], ["אבה בבה גגה"]), [("aaaaaaaa", "אבה בבה גגה")])

    def test_boundary_shift_keeps_both_ids(self):
        out = run(["אא בב", "גג דד הה וו זז חח"], ["אא בב גג דד הה", "וו זז חח"])
        self.assertEqual(out, [("aaaaaaaa", "אא בב גג דד הה"), ("bbbbbbbb", "וו זז חח")])

    def test_split_gives_the_id_to_the_larger_part(self):
        out = run(["אא בב גג דד הה וו זז חח"], ["אא", "בב גג דד הה וו זז חח"])
        self.assertEqual(out, [("NEW", "אא"), ("aaaaaaaa", "בב גג דד הה וו זז חח")])

    def test_new_ids_are_valid_and_unique(self):
        tree = [{"children": [{"id": "aaaaaaaa", "text": "אא בב גג"}]}]
        taken = {"aaaaaaaa"}
        swap_mod.swap(tree, ["אא", "בב", "גג"], taken)
        ids = [c["id"] for c in tree[0]["children"]]
        self.assertEqual(len(set(ids)), 3)
        self.assertTrue(all(swap_mod.LINE_ID.match(i) for i in ids))
        self.assertTrue(set(ids) <= taken)


class MatchIds(unittest.TestCase):
    def test_prefers_the_larger_total_over_a_greedy_first_pick(self):
        self.assertEqual(swap_mod.match_ids([{"a": 2, "b": 3}, {"b": 3}], ["a", "b"]), ["a", "b"])

    def test_lines_without_credited_words_get_none(self):
        self.assertEqual(swap_mod.match_ids([{}, {"a": 1}], ["a"]), [None, "a"])


if __name__ == "__main__":
    unittest.main()
