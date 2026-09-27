import React from 'react';
import { X, Crown, Star, Shield, Navigation, ChessRook, ChessBishop, Sparkles, CheckCircle2, ShieldAlert } from 'lucide-react';
import { GameMode, GAMBIT_PIECES, UnitRank } from '../types/game';

interface RulesModalProps {
  mode: GameMode;
  isOpen: boolean;
  onClose: () => void;
}

const GAMBIT_ICONS: Record<UnitRank, React.ReactNode> = {
  4: <Crown className="w-5 h-5 text-white" />,
  3: <ChessRook className="w-5 h-5 text-white" />,
  2: <ChessBishop className="w-5 h-5 text-white" />,
  1: <Navigation className="w-5 h-5 text-white" />,
};

/**
 * Rules of the chess-like Gambit mode.
 */
const GambitRules: React.FC = () => (
  <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm">
    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
      <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
        <Crown className="w-4 h-4" />
        <span>Victory Condition: Checkmate</span>
      </div>
      <p className="text-slate-300 text-xs leading-relaxed">
        Players alternate, moving exactly one piece per turn. You may never leave your own King in check. Win by
        checkmating the enemy King: it is attacked and no move gets it out. A player without any legal move who is
        not in check is <strong className="text-white">stalemated</strong> (draw). The game is also drawn after 100
        consecutive moves without a capture.
      </p>
    </div>

    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
        The Pieces (no ranks, 10 per army)
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {([4, 3, 2, 1] as UnitRank[]).map((rank) => (
          <div key={rank} className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-b from-slate-600 to-slate-800 flex items-center justify-center shrink-0">
              {GAMBIT_ICONS[rank]}
            </div>
            <div>
              <span className="font-bold text-white text-xs">{GAMBIT_PIECES[rank].name}</span>
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">{GAMBIT_PIECES[rank].description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Movement</h3>
      <ul className="space-y-1.5 text-xs text-slate-300">
        <li className="flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong>No jumping:</strong> pieces cannot pass through any other piece. Capture by moving onto an enemy
            piece.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong>Three tile colors:</strong> like the two colors of a chess board. Bishops move through hex
            corners and never leave their color, so each army has one Bishop per color.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong>Scouts:</strong> the arrow points at the edge the Scout faces. With 4 points per move, a step
            forward or a 60° turn costs 1 point, so a Scout can advance, turn and advance again, or just turn in
            place. When a tile can be reached with different facings, choose the final facing from the arrows shown.
          </span>
        </li>
      </ul>
    </div>
  </div>
);

export const RulesModal: React.FC<RulesModalProps> = ({ mode, isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div>
            <h2 className="text-xl font-bold font-display text-white tracking-wide">
              Codex of War: Rules of Engagement
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {mode === 'gambit'
                ? 'Gambit: chess-like rules on the hex board'
                : 'Dominion: hex influence warfare, aura support, and initiative doctrine'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Scrollable */}
        {mode === 'gambit' ? (
          <GambitRules />
        ) : (
        <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm">
          {/* 1. Victory Condition */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
              <Crown className="w-4 h-4" />
              <span>Victory Condition: Regicide</span>
            </div>
            <p className="text-slate-300 text-xs leading-relaxed">
              The war ends the moment an opponent's <strong className="text-white">Level 4 King</strong> is eliminated. 
              Protect your King at all costs while staging a tactical breach to destroy the enemy commander.
            </p>
          </div>

          {/* 2. The Four Unit Ranks */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              The Four Unit Ranks (10 Units Per Army)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Level 4 */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-b from-amber-500 to-amber-700 flex items-center justify-center shrink-0">
                  <Crown className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-xs">Level 4: King</span>
                    <span className="text-[10px] font-mono text-amber-400">1 Unit · Speed 1 · Aura 4</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                    Leader of the army. Moves 1 tile. Projects a Level 4 aura (+4 combat support). Defeat brings instant victory.
                  </p>
                </div>
              </div>

              {/* Level 3 */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-b from-emerald-600 to-emerald-800 flex items-center justify-center shrink-0">
                  <Star className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-xs">Level 3: General</span>
                    <span className="text-[10px] font-mono text-emerald-400">2 Units · Speed 2 · Aura 3</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                    Senior commander. Moves 2 tiles. Projects a Level 3 aura (+3 combat support).
                  </p>
                </div>
              </div>

              {/* Level 2 */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-b from-sky-600 to-sky-800 flex items-center justify-center shrink-0">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-xs">Level 2: Captain</span>
                    <span className="text-[10px] font-mono text-sky-400">3 Units · Speed 3 · Aura 2</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                    Frontline officer. Moves 3 tiles. Projects a Level 2 aura (+2 combat support).
                  </p>
                </div>
              </div>

              {/* Level 1 */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-b from-slate-600 to-slate-800 flex items-center justify-center shrink-0">
                  <Navigation className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-xs">Level 1: Scout</span>
                    <span className="text-[10px] font-mono text-slate-300">4 Units · Speed 4 · Aura 1</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                    Swift vanguard. Moves 4 tiles. Projects a Level 1 aura (+1 combat support).
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Movement & Supply Doctrine */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Movement & Influence
            </h3>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Inverse Speed:</strong> Movement speed is the inverse of rank (Level 4: 1 tile, Level 3: 2 tiles, Level 2: 3 tiles, Level 1: 4 tiles).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Passing Through Own Units:</strong> Own units do not block movement. A unit can freely pass through hex tiles occupied by friendly units, though it cannot end its turn on an occupied tile.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Free Movement:</strong> Units may move across any empty tile within their speed. Only enemy units block the way.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Influence:</strong> Every unit projects influence equal to its rank onto its own tile and all adjacent tiles. Blue and red influence cancel out
                  (e.g. 7 red + 5 blue = 2 red). Tiles are shaded by the net influence: the stronger it is, the deeper the blue or red.
                </span>
              </li>
            </ul>
          </div>

          {/* 4. Combined Rank Combat & Aura Rule */}
          <div className="p-4 rounded-xl bg-slate-950 border border-cyan-500/20">
            <div className="flex items-center gap-2 text-cyan-400 font-semibold mb-1">
              <ShieldAlert className="w-4 h-4" />
              <span>Combined Rank Combat & Aura Support</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Aura directly boosts combat power! Adjacent comrades project an aura equal to their rank as combat support, the same value they add to tile influence:
            </p>
            <div className="mt-2.5 p-2.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-400 leading-normal space-y-2">
              <div>
                🛡️ <strong>Defensive Rank:</strong> A defender's defensive rank is its <strong>own rank plus the sum of aura ranks of all direct friendly neighbors</strong> (L4: +4, L3: +3, L2: +2, L1: +1).
              </div>
              <div>
                ⚔️ <strong>Attack Rank:</strong> An attacker's attack rank is its <strong>own rank plus the sum of aura ranks of friendly allies adjacent to the target</strong>. Flanking with high-rank auras allows you to defeat fortified enemies!
              </div>
              <div>
                👑 <strong>Capturing Level 4 Kings:</strong> To capture a unit, combined <strong>Attack Rank must exceed Defensive Rank</strong>. A lone Level 4 King (DEF 4) requires a combined Attack Rank of <strong>5 or more</strong>.
              </div>
            </div>
          </div>

          {/* 5. Alternating Movement & Zugzwang */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Alternating Movement & Zugzwang
            </h3>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Alternating Actions:</strong> Each side moves 1 unit at a time. Then the opponent moves 1 unit.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Wait Condition:</strong> A player who has already moved all their available units for the round must wait until their opponent finishes moving their remaining units.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Zugzwang & Waiting:</strong> You must move a unit during your turn if any of your units can move. Units without a legal move cannot act; if none of your remaining units can move, you wait and the opponent continues. Waiting units may still move later in the round if they get freed. The round ends when neither side can move.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Initiative Alternation:</strong> In the new turn/round, the player moves first who did <em>not</em> make the last move in the previous round!
                </span>
              </li>
            </ul>
          </div>
        </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-sm"
          >
            Understood · Return to Battlefield
          </button>
        </div>
      </div>
    </div>
  );
};
