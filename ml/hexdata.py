"""Board geometry, position encoding and data sources for the Dominion value network.

A position is three arrays over the 61 playable tiles, in the engine's order
(playableTiles in vectorEngine.ts):
  u      int8   signed rank (+ Blue, - Red, 0 empty)
  moved  uint8  1 if the unit on the tile has moved this round
  side   int8   +1 Blue to move, -1 Red to move
Values are from the side to move's point of view in [-1, 1].

The network sees the board from the side to move ("own" vs "opponent") on a 9x9
axial grid (q + 4, r + 4); the two grid corners outside the hexagon stay empty.
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
TB_DIR = ROOT / 'tablebase'
LETTERS = {1: 'S', 2: 'C', 3: 'G', 4: 'K'}
DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]

# Playable tiles in the engine's order (q ascending, then r)
TILES = [(q, r) for q in range(-4, 5) for r in range(max(-4, -q - 4), min(4, -q + 4) + 1)]
P = len(TILES)  # 61
INDEX = {t: i for i, t in enumerate(TILES)}
GRID = 9
GRID_Q = np.array([q + 4 for q, _ in TILES])
GRID_R = np.array([r + 4 for _, r in TILES])

# Closed neighbourhoods (influence): I = u @ CLOSED
CLOSED = np.eye(P, dtype=np.float32)
for i, (q, r) in enumerate(TILES):
    for dq, dr in DIRS:
        j = INDEX.get((q + dq, r + dr))
        if j is not None:
            CLOSED[i, j] = 1


def _symmetries():
    perms = []
    for refl in range(2):
        for rot in range(6):
            perm = []
            for q, r in TILES:
                if refl:
                    q, r = r, q
                for _ in range(rot):
                    q, r = -r, q + r
                perm.append(INDEX[(q, r)])
            perms.append(perm)
    return np.array(perms)


SYMS = _symmetries()  # SYMS[g][p] = image of tile p
SYMS_INV = np.argsort(SYMS, axis=1)  # u'[p] = u[SYMS_INV[g][p]]

N_PLANES = 14


def encode(u, moved, side):
    """(B, 61) arrays -> (B, 14, 9, 9) float32 planes from the side to move's view."""
    b = len(u)
    own = u.astype(np.int16) * side[:, None].astype(np.int16)  # + own, - opponent
    f = np.zeros((b, N_PLANES, P), dtype=np.float32)
    for rank in range(1, 5):
        f[:, rank - 1] = own == rank
        f[:, 3 + rank] = own == -rank
    m = moved.astype(bool)
    f[:, 8] = m & (own > 0)
    f[:, 9] = m & (own < 0)
    f[:, 10] = (own.astype(np.float32) @ CLOSED) / 8
    # Units of the rank that moves next (highest unmoved rank), ignoring blockage
    for plane, sgn in ((11, 1), (12, -1)):
        ranks = np.where(~m & (own * sgn > 0), own * sgn, 0)
        top = ranks.max(axis=1, keepdims=True)
        f[:, plane] = (ranks == top) & (top > 0)
    f[:, 13] = 1
    grid = np.zeros((b, N_PLANES, GRID, GRID), dtype=np.float32)
    grid[:, :, GRID_Q, GRID_R] = f
    return grid


def board_mask():
    m = np.zeros((GRID, GRID), dtype=np.float32)
    m[GRID_Q, GRID_R] = 1
    return m


def augment(u, moved, rng):
    """Applies a random hexagon symmetry to each position."""
    g = rng.integers(0, len(SYMS), size=len(u))
    inv = SYMS_INV[g]
    return np.take_along_axis(u, inv, axis=1), np.take_along_axis(moved, inv, axis=1)


# Unit values of the engine's evaluation (VALUE in vectorEngine.ts), in Scouts x 100
VALUE = np.array([0, 100, 400, 250, 0])


def material_score(u, side):
    """The engine's material balance from the side to move's view."""
    own = u.astype(int) * side[:, None]
    return np.where(own > 0, VALUE[np.abs(own)], 0).sum(1) - np.where(own < 0, VALUE[np.abs(own)], 0).sum(1)


def material_key(u, side):
    """Material from the side to move's view, e.g. 'KS-KC' (own first)."""
    own = u.astype(int) * side
    half = lambda vals: ''.join(LETTERS[v] for v in sorted(vals, reverse=True))
    return f"{half(own[own > 0])}-{half(-own[own < 0])}"


# ---- Tablebases ---------------------------------------------------------------
def table_names():
    return sorted(p.stem for p in TB_DIR.glob('*.json'))


def load_table(name):
    meta = json.loads((TB_DIR / f'{name}.json').read_text())
    data = np.fromfile(TB_DIR / f'{name}.tb', dtype=np.uint8)
    words = meta['words']
    bits = data[: words * 4]
    val = data[words * 4:].view(np.int16)
    assert len(val) == meta['nodes']
    return meta, bits, val


def sample_table(name, count, rng):
    """Up to `count` random positions of a table as (u, moved, side, value), value from the mover's view."""
    meta, bits, val = load_table(name)
    ranks = np.array(meta['ranks'])
    n = len(ranks)
    ids = np.sort(rng.choice(len(val), size=min(count, len(val)), replace=False))
    raws = np.flatnonzero(np.unpackbits(bits, bitorder='little'))[ids].astype(np.int64)
    side = np.where(raws % 2 == 1, -1, 1).astype(np.int8)
    rest = raws // 2
    mb = rest % (1 << n)
    rest //= 1 << n
    u = np.zeros((len(ids), P), dtype=np.int8)
    moved = np.zeros((len(ids), P), dtype=np.uint8)
    rows = np.arange(len(ids))
    for i in range(n - 1, -1, -1):
        tile = rest % P
        rest //= P
        u[rows, tile] = ranks[i]
        moved[rows, tile] = (mb >> i) & 1
    value = (np.sign(val[ids]) * side).astype(np.float32)
    return u, moved, side, value


# ---- Search-labelled positions (scripts/label-positions.mjs) -------------------
# *.bin files hold RECORDs (search label only), *.rec files GAME_RECORDs, which
# add the result of the game the position came from
RECORD = np.dtype([('u', 'i1', P), ('moved', 'u1', P), ('side', 'i1'), ('units', 'u1'), ('value', '<f4')])
GAME_RECORD = np.dtype(RECORD.descr + [('result', 'i1'), ('pad', 'u1', 3)])


def load_records(path):
    """(u, moved, side, value, result) with result NaN where the file has none."""
    games = str(path).endswith('.rec')
    r = np.fromfile(path, dtype=GAME_RECORD if games else RECORD)
    result = r['result'].astype(np.float32) if games else np.full(len(r), np.nan, np.float32)
    return r['u'], r['moved'], r['side'], r['value'], result
