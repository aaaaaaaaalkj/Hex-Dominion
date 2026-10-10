/**
 * Dominion on the vector model (dev tooling, not part of the app).
 *
 * The board is embedded in a radius-5 hexagon (one "ghost ring" around the
 * playable radius-4 board) so every tile has a full neighbourhood:
 *   u[t]  signed rank of the unit on tile t (+ Blue/player, - Red/ai, 0 empty)
 *   I     influence vector, I = (Id + Adj) u, kept up to date incrementally
 * Combat is a sign test on I: an attacker of sign g and rank r captures the unit
 * on tile t iff g*I[t] + (attacker adjacent to t ? 0 : r) > 0.
 * A move is a swap of two coordinates of u (a capture also zeroes the victim),
 * so a game is a product of such matrices applied to u.
 *
 * The rules mirror src/utils/gameRules.ts and gameState.ts (rank order, turn
 * hand-over, rounds); scripts/check-vector-engine.mjs verifies that they agree.
 */

export const RADIUS = 5;
export const PLAY_RADIUS = 4;
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// ---- Board ------------------------------------------------------------------
export const coords = [];
for (let q = -RADIUS; q <= RADIUS; q++) {
  for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r++) coords.push({ q, r });
}
export const N = coords.length; // 91
const indexOf = new Map(coords.map((c, i) => [`${c.q},${c.r}`, i]));
export const tileIndex = (q, r) => indexOf.get(`${q},${r}`);
const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
export const playable = coords.map((c) => dist(c, { q: 0, r: 0 }) <= PLAY_RADIUS);
// Closed neighbourhoods on the extended board (influence) and playable neighbours (movement)
export const closed = coords.map((c, i) => [i, ...DIRS.map(([dq, dr]) => tileIndex(c.q + dq, c.r + dr)).filter((j) => j !== undefined)]);
const moveNbrs = coords.map((c, i) => (playable[i] ? closed[i].slice(1).filter((j) => playable[j]) : []));
const adjacent = coords.map((_, i) => new Set(closed[i].slice(1)));
const playableTiles = coords.map((_, i) => i).filter((i) => playable[i]);

// ---- Zobrist hashing (two 26-bit halves combined into one safe integer) -------
let seed = 0x2545f491;
const rand26 = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 6);
const Z = coords.map(() => Array.from({ length: 18 }, () => [rand26(), rand26()]));
const Z_SIDE = [rand26(), rand26()];
const zIndex = (v, moved) => (v + 4) * 2 + moved;

// ---- State -----------------------------------------------------------------
// { u: Int8Array, moved: Uint8Array, I: Int16Array, side: 1|-1, winner: 0|1|-1, round, h1, h2 }

function rehash(s) {
  let h1 = 0, h2 = 0;
  for (const t of playableTiles) {
    if (!s.u[t]) continue;
    const z = Z[t][zIndex(s.u[t], s.moved[t])];
    h1 ^= z[0]; h2 ^= z[1];
  }
  if (s.side === -1) { h1 ^= Z_SIDE[0]; h2 ^= Z_SIDE[1]; }
  s.h1 = h1; s.h2 = h2;
}
export const hashKey = (s) => s.h1 * 67108864 + s.h2;

export function influenceOf(u) {
  const I = new Int16Array(N);
  for (let t = 0; t < N; t++) if (u[t]) for (const j of closed[t]) I[j] += u[t];
  return I;
}

/** Builds a vector state from the app's GameState (Dominion). */
export function fromGameState(state) {
  const u = new Int8Array(N), moved = new Uint8Array(N);
  for (const x of state.units) {
    if (x.isDefeated) continue;
    const t = tileIndex(x.coord.q, x.coord.r);
    u[t] = (x.team === 'player' ? 1 : -1) * x.rank;
    moved[t] = x.hasMovedThisRound ? 1 : 0;
  }
  const s = { u, moved, I: influenceOf(u), side: state.currentTurn === 'player' ? 1 : -1, winner: state.winner === 'player' ? 1 : state.winner === 'ai' ? -1 : 0, round: state.roundNumber };
  rehash(s);
  return s;
}

// ---- Move generation ------------------------------------------------------------
// A move is encoded as from * 128 + to; PASS when the side to move has no legal move.
export const PASS = -1;

/** Legal destinations of the unit on tile `from` (BFS like calculateLegalMovesForUnit). */
export function unitMoves(s, from, out = [], firstOnly = false) {
  const v = s.u[from];
  if (!v || s.moved[from]) return out;
  const g = v > 0 ? 1 : -1, r = v * g, speed = 5 - r;
  const visited = new Set([from]);
  let frontier = [from];
  for (let step = 1; step <= speed && frontier.length; step++) {
    const next = [];
    for (const t of frontier) {
      for (const j of moveNbrs[t]) {
        if (visited.has(j)) continue;
        const occ = s.u[j];
        if (occ && (occ > 0 ? 1 : -1) !== g) {
          // Combat as a sign test on the influence vector
          if (g * s.I[j] + (adjacent[from].has(j) ? 0 : r) > 0) {
            visited.add(j);
            out.push(from * 128 + j);
            if (firstOnly) return out;
          }
          continue;
        }
        visited.add(j);
        if (!occ) {
          out.push(from * 128 + j);
          if (firstOnly) return out;
        }
        if (step < speed) next.push(j);
      }
    }
    frontier = next;
  }
  return out;
}

const canMove = (s, t) => unitMoves(s, t, [], true).length > 0;

/** Highest rank among the side's unmoved units that can move (the rank-order rule), or 0. */
export function moveRank(s, side) {
  let best = 0;
  for (const t of playableTiles) {
    const v = s.u[t] * side;
    if (v > best && !s.moved[t] && canMove(s, t)) best = v;
  }
  return best;
}

const hasAnyMove = (s, side) => moveRank(s, side) > 0;

export function legalMoves(s) {
  if (s.winner) return [];
  const rank = moveRank(s, s.side);
  if (!rank) return [PASS];
  const out = [];
  for (const t of playableTiles) if (s.u[t] === rank * s.side && !s.moved[t]) unitMoves(s, t, out);
  return out;
}

// ---- Applying moves ---------------------------------------------------------------
function clone(s) {
  return { u: s.u.slice(), moved: s.moved.slice(), I: s.I.slice(), side: s.side, winner: s.winner, round: s.round, h1: s.h1, h2: s.h2 };
}

function toggle(s, t) {
  if (!s.u[t]) return;
  const z = Z[t][zIndex(s.u[t], s.moved[t])];
  s.h1 ^= z[0]; s.h2 ^= z[1];
}

// Hands the turn on after `mover` acted (advanceTurn in gameState.ts)
function advance(s, mover) {
  const other = -mover;
  const prevSide = s.side;
  if (hasAnyMove(s, other)) s.side = other;
  else if (hasAnyMove(s, mover)) s.side = mover;
  else {
    s.moved.fill(0);
    s.side = hasAnyMove(s, other) || !hasAnyMove(s, mover) ? other : mover;
    s.round++;
    rehash(s);
    return;
  }
  if (s.side !== prevSide) { s.h1 ^= Z_SIDE[0]; s.h2 ^= Z_SIDE[1]; }
}

/** Returns the state after the side to move plays `move` (the input is not modified). */
export function applyMove(s0, move) {
  const s = clone(s0);
  const mover = s.side;
  if (move === PASS) { advance(s, mover); return s; }
  const from = move >> 7, to = move & 127;
  const v = s.u[from], victim = s.u[to];
  toggle(s, from); toggle(s, to);
  // Influence update: remove victim and mover, add mover at its new tile (O(7) each)
  if (victim) for (const j of closed[to]) s.I[j] -= victim;
  for (const j of closed[from]) s.I[j] -= v;
  for (const j of closed[to]) s.I[j] += v;
  // The move itself: swap the two coordinates (victim, if any, is dropped)
  s.u[to] = v; s.u[from] = 0;
  s.moved[to] = 1; s.moved[from] = 0;
  toggle(s, to);
  if (victim && Math.abs(victim) === 4) { s.winner = mover; return s; }
  if (victim && !playableTiles.some((t) => s.u[t] * mover < 0)) { s.winner = mover; return s; }
  advance(s, mover);
  return s;
}

// ---- Evaluation and search ----------------------------------------------------------
export const WIN = 1_000_000;
const VALUE = [0, 100, 180, 260, 0];

/** Score from Red's (ai, -1) point of view: material plus influenced-tile balance. */
export function evaluate(s) {
  if (s.winner) return s.winner === -1 ? WIN : -WIN;
  let score = 0, tiles = 0;
  for (const t of playableTiles) {
    const v = s.u[t];
    if (v) score += v < 0 ? VALUE[-v] : -VALUE[v];
    if (s.I[t] < 0) tiles++;
    else if (s.I[t] > 0) tiles--;
  }
  return score + tiles * 3;
}

class Timeout extends Error {}

const isCapture = (s, m) => m !== PASS && s.u[m & 127] !== 0;

function search(s, depth, alpha, beta, ctx) {
  if ((++ctx.nodes & 4095) === 0 && Date.now() > ctx.deadline) throw new Timeout();
  if (depth === 0 || s.winner) {
    const v = evaluate(s);
    return v === WIN ? v + depth : v === -WIN ? v - depth : v;
  }
  const key = hashKey(s);
  const table = (ctx.tt[depth] ??= new Map()); // one table per depth keeps keys within 53 bits
  const hit = table.get(key);
  if (hit) {
    if (hit.lo >= beta) return hit.lo;
    if (hit.hi <= alpha) return hit.hi;
  }
  const moves = legalMoves(s);
  moves.sort((a, b) => (isCapture(s, b) ? Math.abs(s.u[b & 127]) : 0) - (isCapture(s, a) ? Math.abs(s.u[a & 127]) : 0));
  const maximizing = s.side === -1;
  const a0 = alpha, b0 = beta;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    const v = search(applyMove(s, m), depth - 1, alpha, beta, ctx);
    if (maximizing) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  table.set(key, { lo: best > a0 ? best : -Infinity, hi: best < b0 ? best : Infinity });
  return best;
}

/**
 * Iterative deepening for the side to move (scores from Red's point of view).
 * Returns the root moves ranked best-first for that side at the deepest finished depth.
 */
export function analyze(s, budgetMs, maxDepth = 30) {
  const ctx = { nodes: 0, deadline: Date.now() + budgetMs, tt: [] };
  let ranked = legalMoves(s).map((move) => ({ move, score: 0 }));
  let depth = 0;
  const sign = s.side === -1 ? 1 : -1;
  for (let d = 1; d <= maxDepth; d++) {
    try {
      const scored = ranked.map((e) => ({ move: e.move, score: search(applyMove(s, e.move), d - 1, -Infinity, Infinity, ctx) }));
      scored.sort((a, b) => sign * (b.score - a.score));
      ranked = scored;
      depth = d;
      if (Math.abs(scored[0].score) >= WIN - 100) break;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  return { ranked, depth, nodes: ctx.nodes };
}

export const moveFrom = (m) => coords[m >> 7];
export const moveTo = (m) => coords[m & 127];
