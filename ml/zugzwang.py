"""Measures the cost of the obligation to move in the endgame tablebases.

  ml/.venv/bin/python ml/zugzwang.py [samples per table = 2000000]

In Dominion each side must move its highest-ranked unmoved unit that can move,
so a King (or General) often has to leave a good square. For sampled positions
where a heavy unit is due to move, the same position with that unit already
marked as moved is looked up: the difference is exactly what the obligation
costs (or gains). Outcomes are compared as win > never resolved > loss for the
side to move. Three cases:
  own King      the side to move's King is unmoved
  own General   the side to move's King has moved, its General has not
  opp King      the opponent's King is unmoved (its obligation, seen by the mover)
Also counted: mutual zugzwang, where whoever is to move loses.
"""
import json
import sys

import numpy as np

from hexdata import P, SYMS, TB_DIR, load_table, table_names


def decode(raws, n):
    side_bit = raws & 1
    rest = raws >> 1
    mb = rest % (1 << n)
    rest //= 1 << n
    tiles = np.zeros((len(raws), n), np.int64)
    for i in range(n - 1, -1, -1):
        tiles[:, i] = rest % P
        rest //= P
    return tiles, mb, side_bit


def canonical(tiles, mb, side_bit, ranks):
    """Smallest raw over the 12 symmetries, identical units sorted by tile."""
    n = len(ranks)
    pairs = [i for i in range(n - 1) if ranks[i] == ranks[i + 1]]  # at most pairs with two Kings
    best = None
    for g in SYMS:
        tt = g[tiles]
        mm = np.stack([(mb >> i) & 1 for i in range(n)], 1)
        for i in pairs:
            swap = tt[:, i] > tt[:, i + 1]
            tt[swap, i], tt[swap, i + 1] = tt[swap, i + 1], tt[swap, i].copy()
            mm[swap, i], mm[swap, i + 1] = mm[swap, i + 1], mm[swap, i].copy()
        x = np.zeros(len(tiles), np.int64)
        for i in range(n):
            x = x * P + tt[:, i]
        m = np.zeros(len(tiles), np.int64)
        for i in range(n):
            m |= mm[:, i] << i
        x = (x * (1 << n) + m) * 2 + side_bit
        best = x if best is None else np.minimum(best, x)
    return best


def outcome(v, side):
    """+1 win, 0 never resolved, -1 loss for the side to move."""
    return np.sign(v) * side


def main():
    samples = int(sys.argv[1]) if len(sys.argv) > 1 else 2_000_000
    rng = np.random.default_rng(0)
    print(f'{"table":7} {"case":12} {"n":>8}  {"hurts":>6} {"helps":>6}   mutual zugzwang')
    for name in table_names():
        meta, bits, val = load_table(name)
        ranks = np.array(meta['ranks'])
        n = len(ranks)
        raws = np.flatnonzero(np.unpackbits(bits, bitorder='little')).astype(np.int64)
        ids = rng.choice(len(raws), size=min(samples, len(raws)), replace=False)
        tiles, mb, side_bit = decode(raws[ids], n)
        side = np.where(side_bit == 1, -1, 1)
        base = outcome(val[ids], side)

        def lookup(t, m, sb):
            c = canonical(t, m, sb, ranks)
            j = np.searchsorted(raws, c)
            assert (raws[j] == c).all()
            return val[j]

        # Mutual zugzwang: the same position with the other side to move
        other = outcome(lookup(tiles, mb, side_bit ^ 1), -side)
        mutual = np.mean((base < 0) & (other < 0))

        cases = []
        for label, rank_of, due in (
            ('own King', lambda s: 4 * s, lambda bit, s: True),
            ('own General', lambda s: 3 * s, lambda bit, s: ((mb >> np.argmax(ranks[None] == (4 * s)[:, None], 1)) & 1) == 1),
            ('opp King', lambda s: -4 * s, lambda bit, s: True),
        ):
            target = rank_of(side)
            has = ranks[None] == target[:, None]
            present = has.any(1)
            idx = np.argmax(has, 1)
            unmoved = ((mb >> idx) & 1) == 0
            sel = present & unmoved & due(idx, side)
            if not sel.any():
                continue
            flipped = mb[sel] | (np.int64(1) << idx[sel])
            after = outcome(lookup(tiles[sel], flipped, side_bit[sel]), side[sel])
            hurts = np.mean(after > base[sel])  # better for the mover without the obligation
            helps = np.mean(after < base[sel])
            cases.append((label, sel.sum(), hurts, helps))
        for k, (label, cnt, hurts, helps) in enumerate(cases):
            tail = f'   {100 * mutual:5.2f}%' if k == 0 else ''
            print(f'{name if k == 0 else "":7} {label:12} {cnt:8}  {100 * hurts:5.1f}% {100 * helps:5.1f}%{tail}', flush=True)


if __name__ == '__main__':
    main()
