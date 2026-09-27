import { HexTile, Unit, UnitRank } from '../types/game';
import {
  calculateAttackRank,
  calculateDefensiveRank,
  calculateLegalMovesForUnit,
  getUnitSpeed,
} from './gameRules';
import { coordKey, getHexNeighbors, hexDistance } from './hexMath';
import { GameAction, GameState, applyAction, getActions, isGameOver } from './gameState';
import { BISHOP_LINES, ROOK_LINES, calculateGambitMoves, isKingInCheck, traceLine } from './gambitRules';

/**
 * Search-based opponent.
 *
 * Alpha-beta minimax over single-unit actions with iterative deepening under a
 * time budget. Turns do not strictly alternate in this game (a side keeps
 * moving once the opponent has moved all its units), so every node simply
 * maximizes or minimizes depending on whose turn it is in that state.
 *
 * - Leaves are resolved with a capture-only quiescence search so the horizon
 *   never falls in the middle of an exchange.
 * - Below the root only the most promising quiet moves are searched (all
 *   captures always are), which buys extra depth.
 * - The evaluation is generic per mode. Dominion: material, tiles under influence
 *   and the safety margin of each King. Gambit: material, activity of the long-range
 *   pieces, Scout advancement and King shelter.
 */

export interface SearchOptions {
  timeLimitMs?: number;
  // Shorter budget used when no unit of either side can capture anything (e.g. the opening)
  quietTimeLimitMs?: number;
  maxDepth?: number;
  // Pick randomly among root moves scoring within this many points of the best (0 = deterministic)
  randomMargin?: number;
}

export interface SearchResult {
  action: GameAction;
  score: number;
  depth: number; // deepest fully or partially searched horizon (in single-unit actions)
  nodes: number;
  timeMs: number;
}

const WIN_SCORE = 1_000_000;
const PIECE_VALUE: Record<UnitRank, number> = { 1: 100, 2: 180, 3: 260, 4: 0 }; // King loss is terminal
// Gambit: Scout, Bishop, Rook (the King is never captured: checkmate is terminal)
const GAMBIT_PIECE_VALUE: Record<UnitRank, number> = { 1: 100, 2: 380, 3: 420, 4: 0 };
const GAMBIT_MOBILITY_VALUE = 5; // per open tile on a Rook/Bishop line
const GAMBIT_SCOUT_ADVANCE_VALUE = 6; // per row advanced toward the enemy
const GAMBIT_KING_SHELTER_VALUE = 12; // per friendly piece next to the King
const GAMBIT_CHECK_PENALTY = 40;
const TILE_CONTROL_VALUE = 12;
const KING_SAFETY_VALUE = 20;
const KING_SAFETY_CAP = 6;
const MAX_QUIESCENCE_DEPTH = 4;
const INNER_BEAM_WIDTH = 10;

const DEFAULT_TIME_LIMIT_MS = 1200;
const DEFAULT_MAX_DEPTH = 8;

class SearchTimeout extends Error {}

/**
 * True when no unit of either side (ignoring who has moved this round) can capture
 * anything right now, i.e. the armies are not in contact.
 */
export function isQuietPosition(state: GameState, tiles: Map<string, HexTile>): boolean {
  for (const unit of state.units) {
    if (unit.isDefeated) continue;
    const moves =
      state.mode === 'gambit'
        ? calculateGambitMoves(unit, tiles, state.units)
        : calculateLegalMovesForUnit({ ...unit, hasMovedThisRound: false }, tiles, state.units);
    if (moves.some((m) => m.isAttack)) return false;
  }
  return true;
}

// Precomputed tile indices: area[i] = tile i plus its on-board neighbours
interface BoardIndex {
  index: Map<string, number>;
  area: number[][];
  size: number;
}

function buildBoardIndex(tiles: Map<string, HexTile>): BoardIndex {
  const index = new Map<string, number>();
  for (const key of tiles.keys()) index.set(key, index.size);
  const area: number[][] = [];
  for (const tile of tiles.values()) {
    const cells = [index.get(tile.id)!];
    for (const n of getHexNeighbors(tile)) {
      const j = index.get(coordKey(n));
      if (j !== undefined) cells.push(j);
    }
    area.push(cells);
  }
  return { index, area, size: index.size };
}

export function chooseAIAction(
  state: GameState,
  tiles: Map<string, HexTile>,
  options: SearchOptions = {}
): SearchResult | null {
  const started = performance.now();
  const timeLimit =
    options.quietTimeLimitMs !== undefined && isQuietPosition(state, tiles)
      ? options.quietTimeLimitMs
      : options.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const deadline = started + timeLimit;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const randomMargin = options.randomMargin ?? 0;
  const me = state.currentTurn;
  const board = buildBoardIndex(tiles);
  let nodes = 0;

  const rootActions = getActions(state, tiles);
  if (rootActions.length === 0) return null;
  if (rootActions.length === 1) {
    return { action: rootActions[0], score: 0, depth: 0, nodes: 0, timeMs: 0 };
  }

  // ---------- Evaluation (from `me`'s point of view) ----------

  const kingSafety = (king: Unit | undefined, units: Unit[]): number => {
    if (!king) return -KING_SAFETY_CAP;
    const defense = calculateDefensiveRank(king, units);
    let strongestAttack = 0;
    for (const u of units) {
      if (u.isDefeated || u.team === king.team) continue;
      if (hexDistance(u.coord, king.coord) <= getUnitSpeed(u.rank)) {
        strongestAttack = Math.max(strongestAttack, calculateAttackRank(u, king.coord, units));
      }
    }
    return Math.max(-KING_SAFETY_CAP, Math.min(KING_SAFETY_CAP, defense - strongestAttack));
  };

  const occupiedKeys = (units: Unit[]) =>
    new Set(units.filter((u) => !u.isDefeated).map((u) => coordKey(u.coord)));

  // Gambit evaluation: material, open lines of Rooks/Bishops, Scout advancement, King shelter
  const evaluateGambit = (s: GameState): number => {
    const occupied = occupiedKeys(s.units);
    let score = 0;
    for (const u of s.units) {
      if (u.isDefeated) continue;
      const side = u.team === me ? 1 : -1;
      score += side * GAMBIT_PIECE_VALUE[u.rank];

      if (u.rank === 3 || u.rank === 2) {
        let open = 0;
        for (const line of u.rank === 3 ? ROOK_LINES : BISHOP_LINES) {
          open += traceLine(u.coord, line, Infinity, tiles, (key) => occupied.has(key)).length;
        }
        score += side * open * GAMBIT_MOBILITY_VALUE;
      } else if (u.rank === 1) {
        // Player advances toward negative r, AI toward positive r
        const advanced = u.team === 'player' ? 4 - u.coord.r : u.coord.r + 4;
        score += side * advanced * GAMBIT_SCOUT_ADVANCE_VALUE;
      } else {
        let shelter = 0;
        for (const n of getHexNeighbors(u.coord)) {
          if (s.units.some((f) => !f.isDefeated && f.team === u.team && f.coord.q === n.q && f.coord.r === n.r)) {
            shelter++;
          }
        }
        score += side * shelter * GAMBIT_KING_SHELTER_VALUE;
      }
    }
    if (isKingInCheck(s.currentTurn, tiles, s.units)) {
      score += (s.currentTurn === me ? -1 : 1) * GAMBIT_CHECK_PENALTY;
    }
    return score;
  };

  const evaluate = (s: GameState, ply: number): number => {
    if (s.winner) return s.winner === me ? WIN_SCORE - ply : -WIN_SCORE + ply;
    if (s.isDraw) return 0;
    if (s.mode === 'gambit') return evaluateGambit(s);

    const influence = new Float64Array(board.size);
    let score = 0;
    let myKing: Unit | undefined;
    let theirKing: Unit | undefined;

    for (const u of s.units) {
      if (u.isDefeated) continue;
      const side = u.team === me ? 1 : -1;
      score += side * PIECE_VALUE[u.rank];
      for (const j of board.area[board.index.get(coordKey(u.coord))!]) {
        influence[j] += side * u.rank;
      }
      if (u.rank === 4) {
        if (u.team === me) myKing = u;
        else theirKing = u;
      }
    }

    for (const v of influence) {
      if (v > 0) score += TILE_CONTROL_VALUE;
      else if (v < 0) score -= TILE_CONTROL_VALUE;
    }

    score += KING_SAFETY_VALUE * (kingSafety(myKing, s.units) - kingSafety(theirKing, s.units));
    return score;
  };

  // ---------- Move ordering ----------

  // Cheap ordering key: captures first (most valuable victim), then quiet moves
  // by the local change in tiles controlled by the mover.
  const orderActions = (s: GameState, actions: GameAction[]): { action: GameAction; key: number }[] => {
    const moverSign = s.currentTurn === 'player' ? 1 : -1;
    const influence = new Float64Array(board.size);
    const unitById = new Map<string, Unit>();
    for (const u of s.units) {
      if (u.isDefeated) continue;
      unitById.set(u.id, u);
      const sign = u.team === 'player' ? 1 : -1;
      for (const j of board.area[board.index.get(coordKey(u.coord))!]) influence[j] += sign * u.rank;
    }

    return actions
      .map((action) => {
        if (action.kind !== 'move') return { action, key: -1e6 };
        const { move } = action;
        const unit = unitById.get(action.unitId)!;
        if (move.isAttack) {
          const values = s.mode === 'gambit' ? GAMBIT_PIECE_VALUE : PIECE_VALUE;
          const victimValue = move.targetUnitRank === 4 ? 1e5 : values[move.targetUnitRank!];
          return { action, key: 1e6 + victimValue - unit.rank };
        }
        if (s.mode === 'gambit') {
          // Prefer centralizing quiet moves
          const center = { q: 0, r: 0 };
          return { action, key: hexDistance(unit.coord, center) - hexDistance(move.target, center) };
        }
        const from = board.area[board.index.get(coordKey(unit.coord))!];
        const to = board.area[board.index.get(coordKey(move.target))!];
        const change = new Map<number, number>();
        for (const j of from) change.set(j, (change.get(j) ?? 0) - moverSign * unit.rank);
        for (const j of to) change.set(j, (change.get(j) ?? 0) + moverSign * unit.rank);
        let delta = 0;
        for (const [j, d] of change) {
          delta += Math.sign((influence[j] + d) * moverSign) - Math.sign(influence[j] * moverSign);
        }
        return { action, key: delta };
      })
      .sort((a, b) => b.key - a.key);
  };

  // ---------- Search ----------

  const tick = () => {
    nodes++;
    if ((nodes & 127) === 0 && performance.now() > deadline) throw new SearchTimeout();
  };

  const quiesce = (s: GameState, alpha: number, beta: number, ply: number, qDepth: number): number => {
    tick();
    const standPat = evaluate(s, ply);
    if (isGameOver(s) || qDepth >= MAX_QUIESCENCE_DEPTH) return standPat;

    const maximizing = s.currentTurn === me;
    if (maximizing) {
      if (standPat >= beta) return standPat;
      alpha = Math.max(alpha, standPat);
    } else {
      if (standPat <= alpha) return standPat;
      beta = Math.min(beta, standPat);
    }

    const captures = orderActions(
      s,
      getActions(s, tiles).filter((a) => a.kind === 'move' && a.move.isAttack)
    );
    let best = standPat;
    for (const { action } of captures) {
      const v = quiesce(applyAction(s, tiles, action), alpha, beta, ply + 1, qDepth + 1);
      if (maximizing) {
        best = Math.max(best, v);
        alpha = Math.max(alpha, v);
      } else {
        best = Math.min(best, v);
        beta = Math.min(beta, v);
      }
      if (alpha >= beta) break;
    }
    return best;
  };

  const search = (s: GameState, depth: number, alpha: number, beta: number, ply: number): number => {
    if (isGameOver(s)) return evaluate(s, ply);
    if (depth <= 0) return quiesce(s, alpha, beta, ply, 0);
    tick();

    let ordered = orderActions(s, getActions(s, tiles));
    if (ordered.length === 0) return evaluate(s, ply);
    if (ordered.length > INNER_BEAM_WIDTH) {
      const captures = ordered.filter((o) => o.action.kind === 'move' && o.action.move.isAttack);
      const quiet = ordered.filter((o) => !(o.action.kind === 'move' && o.action.move.isAttack));
      ordered = [...captures, ...quiet.slice(0, Math.max(0, INNER_BEAM_WIDTH - captures.length))];
    }

    const maximizing = s.currentTurn === me;
    let best = maximizing ? -Infinity : Infinity;
    for (const { action } of ordered) {
      const v = search(applyAction(s, tiles, action), depth - 1, alpha, beta, ply + 1);
      if (maximizing) {
        best = Math.max(best, v);
        alpha = Math.max(alpha, v);
      } else {
        best = Math.min(best, v);
        beta = Math.min(beta, v);
      }
      if (alpha >= beta) break;
    }
    return best;
  };

  // ---------- Iterative deepening at the root ----------

  let root = orderActions(state, rootActions).map((o) => ({ action: o.action, score: -Infinity }));
  // Root moves with exact scores from the deepest (possibly partial) iteration
  let scored: { action: GameAction; score: number }[] = [{ action: root[0].action, score: 0 }];
  let bestScore = -Infinity;
  let reachedDepth = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    const iteration: { action: GameAction; score: number }[] = [];
    let timedOut = false;
    try {
      for (const entry of root) {
        // Widen the window by the random margin so near-best moves get exact scores
        entry.score = search(
          applyAction(state, tiles, entry.action),
          depth - 1,
          alpha - randomMargin,
          Infinity,
          1
        );
        iteration.push({ action: entry.action, score: entry.score });
        alpha = Math.max(alpha, entry.score);
      }
    } catch (e) {
      if (!(e instanceof SearchTimeout)) throw e;
      timedOut = true;
    }

    // A partially searched iteration is still usable: the previous best move is
    // searched first, and any move that beat it has an exact score.
    if (iteration.length > 0) {
      scored = iteration;
      bestScore = Math.max(...iteration.map((m) => m.score));
      reachedDepth = depth;
    }
    if (timedOut) break;

    root = [...root].sort((a, b) => b.score - a.score);
    if (Math.abs(bestScore) > WIN_SCORE / 2) break; // forced result found
  }

  // Vary play: choose randomly among near-best moves, unless the result is forced
  const margin = Math.abs(bestScore) > WIN_SCORE / 2 ? 0 : randomMargin;
  const candidates = scored.filter((m) => m.score >= bestScore - margin);
  const bestAction = candidates[Math.floor(Math.random() * candidates.length)].action;

  return {
    action: bestAction,
    score: bestScore,
    depth: reachedDepth,
    nodes,
    timeMs: Math.round(performance.now() - started),
  };
}
