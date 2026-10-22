/**
 * Tactical check of one tile for the move preview: after a move, can the
 * opponent force the capture of the unit standing on `target`, and how soon?
 *
 * A boolean search on the vector engine: the attacker tries to capture the unit,
 * its owner tries to keep it, and the attacker gets a fixed number of its own
 * moves (rounds roll over as in the game). The unit is safe once it moves away.
 * Only moves that can matter for the tile are searched in full: moves from or to
 * its closed neighbourhood and captures. Every other unit keeps two stand-in
 * moves, its destinations nearest to and farthest from the tile, so rank order
 * and tempo (who must move what, and when) stay exact.
 */
import { applyMove, closed, coords, hashKey, legalMoves, PASS, playable, Side, VectorState } from './vectorEngine';

export interface TileSafety {
  /** lost: falls whatever its owner does; threatened: falls unless the owner reacts */
  status: 'lost' | 'threatened' | 'safe';
  /** The attacker's move (1 = its next one) on which the unit falls or is threatened */
  attackerMove?: number;
  /** Moves from the analysed state: a forcing line (lost) or the threat (threatened) */
  line: number[];
  /** threatened: the owner's moves that keep the unit, at the first of its turns on
   *  the line where ignoring the tile loses it */
  defences: number[];
  /** threatened: which of the owner's moves that is (1 = its next one) */
  ownerMove?: number;
  /** Attacker moves fully checked (safe means safe for this many) */
  horizon: number;
  /** The attacker's next-move captures of any of the owner's units */
  immediate: number[];
}

const dist = (a: number, b: number) => {
  const p = coords[a], q = coords[b];
  return (Math.abs(p.q - q.q) + Math.abs(p.r - q.r) + Math.abs(p.q + p.r - q.q - q.r)) / 2;
};

class OutOfNodes extends Error {}

export function analyzeTile(
  s0: VectorState,
  target: number,
  maxAttackerMoves = 4,
  maxNodes = 300_000,
  reduce = true // stand-ins for moves away from the tile (false: every legal move, for testing)
): TileSafety | null {
  const D = (Math.sign(s0.u[target]) || 0) as Side | 0;
  if (!D) return null;
  const A = -D as Side;
  const region = new Set(closed[target].filter((t) => playable[t]));
  let nodes = 0;

  const isActive = (s: VectorState, m: number) => region.has(m >> 7) || region.has(m & 127) || s.u[m & 127] !== 0;

  // Legal moves, with the moves that cannot touch the tile reduced to stand-ins
  function candidates(s: VectorState): number[] {
    const all = legalMoves(s);
    if (all[0] === PASS || !reduce) return all;
    const active: number[] = [];
    const standIns = new Map<number, [number, number, number, number]>(); // from -> near, d, far, d
    for (const m of all) {
      if (isActive(s, m)) {
        active.push(m);
        continue;
      }
      const d = dist(m & 127, target), e = standIns.get(m >> 7);
      if (!e) standIns.set(m >> 7, [m, d, m, d]);
      else {
        if (d < e[1]) { e[0] = m; e[1] = d; }
        if (d > e[3]) { e[2] = m; e[3] = d; }
      }
    }
    // Strongest moves first: captures on the tile, then moves into its neighbourhood
    const score = (m: number) => ((m & 127) === target ? 2 : region.has(m & 127) ? 1 : 0);
    active.sort((a, b) => score(b) - score(a));
    for (const [near, , far] of standIns.values()) {
      active.push(near);
      if (far !== near) active.push(far);
    }
    return active;
  }

  // Returns true/false when the unit's fate is decided, null to keep searching.
  // A game won elsewhere ends the question without a capture on the tile.
  function decided(s: VectorState, k: number): boolean | null {
    const v = s.u[target];
    if (v * D <= 0) return v * A > 0; // captured, or moved away
    if (s.winner) return false;
    return k === 0 ? false : null;
  }

  // Can the attacker force the capture within k of its moves? With `passive`, the
  // owner only plays stand-in moves when it has any (it ignores the tile)
  const tables = [false, true].map(() => Array.from({ length: maxAttackerMoves + 1 }, () => new Map<number, boolean>()));
  function falls(s: VectorState, k: number, passive: boolean): boolean {
    const done = decided(s, k);
    if (done !== null) return done;
    if (++nodes > maxNodes) throw new OutOfNodes();
    const tt = tables[passive ? 1 : 0][k];
    const key = hashKey(s);
    const hit = tt.get(key);
    if (hit !== undefined) return hit;
    const result =
      s.side === A
        ? candidates(s).some((m) => falls(applyMove(s, m), k - 1, passive))
        : ownerMoves(s, passive).every((m) => falls(applyMove(s, m), k, passive));
    tt.set(key, result);
    return result;
  }
  function ownerMoves(s: VectorState, passive: boolean): number[] {
    const moves = candidates(s);
    const quiet = passive ? moves.filter((m) => m !== PASS && !isActive(s, m)) : [];
    return quiet.length ? quiet : moves;
  }

  // Follows a line the search proved (k attacker moves, the given mode)
  function lineOf(k: number, passive: boolean): number[] {
    const line: number[] = [];
    let s = s0;
    while (decided(s, k) === null) {
      const attacker = s.side === A;
      const moves = attacker ? candidates(s) : ownerMoves(s, passive);
      const m = attacker ? moves.find((x) => falls(applyMove(s, x), k - 1, passive)) ?? moves[0] : moves[0];
      line.push(m);
      s = applyMove(s, m);
      if (attacker) k--;
    }
    return line;
  }

  const result = (
    status: TileSafety['status'],
    horizon: number,
    line: number[] = [],
    defences: number[] = [],
    attackerMove?: number,
    ownerMove?: number
  ): TileSafety => ({ status, attackerMove, line, defences, ownerMove, horizon, immediate });
  const immediate =
    s0.side === A && !s0.winner ? legalMoves(s0).filter((m) => m !== PASS && s0.u[m & 127] * D > 0) : [];
  let horizon = 0;
  try {
    for (let k = 1; k <= maxAttackerMoves; k++) {
      if (falls(s0, k, false)) return result('lost', k, lineOf(k, false), [], k);
      horizon = k;
    }
  } catch (e) {
    if (!(e instanceof OutOfNodes)) throw e;
  }
  if (horizon === 0) return result('safe', horizon);

  // Not lost: the earliest threat if the owner ignores the tile, and the first
  // owner move on that line where ignoring it stops working
  try {
    for (let k = 1; k <= horizon; k++) {
      if (!falls(s0, k, true)) continue;
      const line = lineOf(k, true);
      let s = s0, used = 0, own = 0;
      for (const m of line) {
        if (s.side === A) used++;
        else {
          own++;
          const holds = candidates(s).filter((x) => x !== PASS && !falls(applyMove(s, x), horizon - used, false));
          if (!holds.some((x) => !isActive(s, x))) return result('threatened', horizon, line, holds, k, own);
        }
        s = applyMove(s, m);
      }
      return result('threatened', horizon, line, [], k);
    }
  } catch (e) {
    if (!(e instanceof OutOfNodes)) throw e;
  }
  return result('safe', horizon);
}
