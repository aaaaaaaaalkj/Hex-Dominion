/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HexTile,
  Unit,
  LegalMove,
  Team,
  MoveRecord,
  UNIT_DEFINITIONS,
} from './types/game';
import { generateGameMap } from './utils/mapGenerator';
import {
  calculateLegalMovesForUnit,
  applyMove,
  computeInfluenceMap,
  countInfluencedTiles,
} from './utils/gameRules';
import { advanceTurn } from './utils/gameState';
import type { AIRequest, AIResponse } from './utils/aiWorker';
import { soundEffects } from './utils/soundEffects';
import { generateGameLogText, downloadGameLog } from './utils/gameExporter';
import { HexBoard } from './components/HexBoard';
import { RulesModal } from './components/RulesModal';
import { GameOverModal } from './components/GameOverModal';
import { ReplayControls } from './components/ReplayControls';
import {
  RotateCcw,
  BookOpen,
  Volume2,
  VolumeX,
  Crown,
  Download,
  Route,
} from 'lucide-react';

export default function App() {
  // Game Board State
  const [tiles, setTiles] = useState<Map<string, HexTile>>(() => new Map());
  const [units, setUnits] = useState<Unit[]>([]);
  const [roundNumber, setRoundNumber] = useState<number>(1);
  const [currentTurn, setCurrentTurn] = useState<Team>('player');
  const [turnTrigger, setTurnTrigger] = useState<number>(0);
  const [lastMover, setLastMover] = useState<Team | null>(null);

  // Interaction State
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [legalMoves, setLegalMoves] = useState<LegalMove[]>([]);
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  // Short-lived notice, e.g. when one side has no legal move and the other continues
  const [turnNotice, setTurnNotice] = useState<string | null>(null);
  const [moveCount, setMoveCount] = useState<number>(0);

  // Move History & Decisive Move tracking
  const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([]);
  // Board snapshots for post-game replay: unitHistory[i] = units after move i (0 = start)
  const [unitHistory, setUnitHistory] = useState<Unit[][]>([]);
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [lastMove, setLastMove] = useState<MoveRecord | null>(null);
  const [showGameOverModal, setShowGameOverModal] = useState<boolean>(true);

  // Modals & Settings
  const [winner, setWinner] = useState<Team | null>(null);
  const [isRulesOpen, setIsRulesOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showLastMove, setShowLastMove] = useState<boolean>(true);

  // AI search budget per move (shorter while no captures are possible), variety margin,
  // and a minimum delay so instant replies don't feel abrupt
  const AI_TIME_LIMIT_MS = 1200;
  const AI_QUIET_TIME_LIMIT_MS = 300;
  const AI_RANDOM_MARGIN = 8;
  const AI_MIN_THINK_MS = 300;

  // State refs to ensure AI effect reads latest state without cancelling timers
  const tilesRef = React.useRef(tiles);
  tilesRef.current = tiles;
  const unitsRef = React.useRef(units);
  unitsRef.current = units;
  const roundNumberRef = React.useRef(roundNumber);
  roundNumberRef.current = roundNumber;

  // Initialize a fresh game
  const initGame = useCallback(() => {
    const { tiles: newTiles, units: newUnits } = generateGameMap();
    setTiles(newTiles);
    setUnits(newUnits);
    setRoundNumber(1);
    setCurrentTurn('player');
    setTurnTrigger(0);
    setLastMover(null);
    setSelectedUnit(null);
    setLegalMoves([]);
    setIsAiThinking(false);
    setWinner(null);
    setMoveCount(0);
    setMoveHistory([]);
    setUnitHistory([newUnits]);
    setReplayIndex(0);
    setLastMove(null);
    setShowGameOverModal(true);
    setTurnNotice(null);
    soundEffects.playRoundChange();
  }, []);

  // Run initial game setup once on mount
  useEffect(() => {
    initGame();
  }, [initGame]);

  // Sync sound manager enabled state
  useEffect(() => {
    soundEffects.enabled = soundEnabled;
  }, [soundEnabled]);

  // Recalculate legal moves whenever selected unit changes or units change
  useEffect(() => {
    if (!selectedUnit || selectedUnit.hasMovedThisRound || selectedUnit.isDefeated) {
      setLegalMoves([]);
      return;
    }
    const moves = calculateLegalMovesForUnit(selectedUnit, tiles, units);
    setLegalMoves(moves);
  }, [selectedUnit, tiles, units]);

  // Check if round should transition or initiative should switch
  const evaluateNextTurn = useCallback(
    (
      currentMover: Team,
      updatedTiles: Map<string, HexTile>,
      updatedUnits: Unit[]
    ) => {
      const next = advanceTurn(updatedUnits, currentMover, updatedTiles);
      setUnits(next.units);
      setCurrentTurn(next.currentTurn);
      if (next.newRound) {
        setRoundNumber((r) => r + 1);
        soundEffects.playRoundChange();
      }
      if (next.waiting) {
        setTurnNotice(
          next.waiting === 'player'
            ? 'None of your remaining units can move · the AI continues'
            : 'The AI has no legal moves · you continue'
        );
      }

      // Increment turnTrigger to ensure any effect watching turns (like AI) always fires
      setTurnTrigger((t) => t + 1);
    },
    []
  );

  // Execute a move for player or AI
  const executeMove = useCallback(
    (unit: Unit, move: LegalMove) => {
      const fromCoord = { ...unit.coord };
      const {
        newUnits,
        capturedUnit,
        isGameOver,
        winner: gameWinner,
      } = applyMove(unit.id, move, units);

      if (capturedUnit) {
        soundEffects.playAttack();
      } else {
        soundEffects.playMove();
      }

      const nextMoveCount = moveCount + 1;
      setMoveCount(nextMoveCount);
      setUnits(newUnits);
      setSelectedUnit(null);
      setLegalMoves([]);
      setLastMover(unit.team);

      // Record move in log history
      const record: MoveRecord = {
        id: `move-${nextMoveCount}`,
        turnNumber: nextMoveCount,
        roundNumber,
        team: unit.team,
        unitRank: unit.rank,
        unitName: UNIT_DEFINITIONS[unit.rank].name,
        from: fromCoord,
        to: { ...move.target },
        path: move.path,
        isAttack: move.isAttack,
        attackRank: move.attackRank,
        defenseRank: move.defenseRank,
        capturedRank: capturedUnit ? capturedUnit.rank : undefined,
        capturedName: capturedUnit ? UNIT_DEFINITIONS[capturedUnit.rank].name : undefined,
        isWinningMove: isGameOver,
        timestamp: Date.now(),
      };

      setMoveHistory((prev) => [...prev, record]);
      setUnitHistory((prev) => [...prev, newUnits]);
      setLastMove(record);

      if (isGameOver && gameWinner) {
        setWinner(gameWinner);
        setShowGameOverModal(true);
        if (gameWinner === 'player') {
          soundEffects.playVictory();
        } else {
          soundEffects.playDefeat();
        }
      } else {
        evaluateNextTurn(unit.team, tiles, newUnits);
      }
    },
    [tiles, units, roundNumber, moveCount, evaluateNextTurn]
  );

  // Player selects an active unit
  const handleSelectUnit = useCallback(
    (unit: Unit) => {
      if (unit.team !== 'player' || currentTurn !== 'player' || isAiThinking || winner) return;

      if (unit.hasMovedThisRound) {
        return;
      }

      const moves = calculateLegalMovesForUnit(unit, tiles, units);

      // Units without legal moves can still be selected to preview lifting their influence
      if (selectedUnit?.id === unit.id) {
        setSelectedUnit(null);
        setLegalMoves([]);
        return;
      }

      setSelectedUnit(unit);
      setLegalMoves(moves);
      soundEffects.playSelect();
    },
    [currentTurn, isAiThinking, winner, selectedUnit, tiles, units]
  );

  // Player executes move on target hex
  const handlePlayerMove = useCallback(
    (move: LegalMove) => {
      if (!selectedUnit || currentTurn !== 'player' || isAiThinking || winner) return;
      executeMove(selectedUnit, move);
    },
    [selectedUnit, currentTurn, isAiThinking, winner, executeMove]
  );

  // Execute move and evaluate turn refs to avoid stale closures
  const executeMoveRef = React.useRef(executeMove);
  executeMoveRef.current = executeMove;
  const evaluateNextTurnRef = React.useRef(evaluateNextTurn);
  evaluateNextTurnRef.current = evaluateNextTurn;

  // Hide the turn notice after a moment
  useEffect(() => {
    if (!turnNotice) return;
    const timer = setTimeout(() => setTurnNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [turnNotice]);

  // Search-based AI runs in a Web Worker so the UI stays responsive while it thinks
  const aiWorkerRef = React.useRef<Worker | null>(null);
  const aiRequestIdRef = React.useRef(0);
  useEffect(() => {
    const worker = new Worker(new URL('./utils/aiWorker.ts', import.meta.url), { type: 'module' });
    aiWorkerRef.current = worker;
    return () => worker.terminate();
  }, []);

  // AI Turn Execution Loop
  useEffect(() => {
    const worker = aiWorkerRef.current;
    if (currentTurn !== 'ai' || winner || !worker) {
      setIsAiThinking(false);
      return;
    }

    setIsAiThinking(true);
    const requestId = ++aiRequestIdRef.current;
    const startedAt = performance.now();
    let applyTimer: ReturnType<typeof setTimeout> | undefined;

    const onMessage = (e: MessageEvent<AIResponse>) => {
      if (e.data.requestId !== requestId) return; // stale reply (new game or turn changed)
      const { result } = e.data;
      const delay = Math.max(0, AI_MIN_THINK_MS - (performance.now() - startedAt));

      applyTimer = setTimeout(() => {
        const currentUnits = unitsRef.current;
        const action = result?.action;
        const actingUnit =
          action?.kind === 'move' ? currentUnits.find((u) => u.id === action.unitId) : undefined;

        if (action?.kind === 'move' && actingUnit) {
          executeMoveRef.current(actingUnit, action.move);
        } else {
          // Fallback: no AI unit can move, hand the turn on
          evaluateNextTurnRef.current('ai', tilesRef.current, currentUnits);
        }
        setIsAiThinking(false);
      }, delay);
    };

    worker.addEventListener('message', onMessage);
    const request: AIRequest = {
      requestId,
      state: {
        units: unitsRef.current,
        currentTurn: 'ai',
        roundNumber: roundNumberRef.current,
        winner: null,
      },
      tiles: tilesRef.current,
      options: {
        timeLimitMs: AI_TIME_LIMIT_MS,
        quietTimeLimitMs: AI_QUIET_TIME_LIMIT_MS,
        randomMargin: AI_RANDOM_MARGIN,
      },
    };
    worker.postMessage(request);

    return () => {
      worker.removeEventListener('message', onMessage);
      clearTimeout(applyTimer);
    };
  }, [currentTurn, winner, turnTrigger]);

  // Statistics & Score tracking
  const stats = useMemo(() => {
    const totalTiles = tiles.size || 1;
    const { player: playerTiles, ai: aiTiles } = countInfluencedTiles(
      computeInfluenceMap(tiles, units)
    );

    const playerDefeats = units.filter((u) => u.team === 'player' && u.isDefeated).length;
    const aiDefeats = units.filter((u) => u.team === 'ai' && u.isDefeated).length;

    const playerKingAlive = units.some((u) => u.team === 'player' && u.rank === 4 && !u.isDefeated);
    const aiKingAlive = units.some((u) => u.team === 'ai' && u.rank === 4 && !u.isDefeated);

    return {
      playerTiles,
      aiTiles,
      playerInfluencePct: Math.round((playerTiles / totalTiles) * 100),
      aiInfluencePct: Math.round((aiTiles / totalTiles) * 100),
      playerDefeats,
      aiDefeats,
      playerKingAlive,
      aiKingAlive,
    };
  }, [tiles, units]);

  // Post-game replay: show the board as it was after the selected move
  const isReviewing = Boolean(winner) && !showGameOverModal;
  const displayUnits = isReviewing ? unitHistory[replayIndex] ?? units : units;
  const displayLastMove = isReviewing
    ? replayIndex > 0
      ? moveHistory[replayIndex - 1]
      : null
    : lastMove;

  const barStats = useMemo(() => {
    const totalTiles = tiles.size || 1;
    const { player, ai } = countInfluencedTiles(computeInfluenceMap(tiles, displayUnits));
    return {
      playerInfluencePct: Math.round((player / totalTiles) * 100),
      aiInfluencePct: Math.round((ai / totalTiles) * 100),
    };
  }, [tiles, displayUnits]);

  // Text Export Handlers
  const handleExportText = useCallback(() => {
    downloadGameLog({
      winner,
      roundNumber,
      totalMoves: moveCount,
      playerInfluencePct: stats.playerInfluencePct,
      aiInfluencePct: stats.aiInfluencePct,
      playerDefeats: stats.playerDefeats,
      aiDefeats: stats.aiDefeats,
      tiles,
      units,
      moveHistory,
    });
  }, [winner, roundNumber, moveCount, stats, tiles, units, moveHistory]);

  const handleCopyText = useCallback(async (): Promise<boolean> => {
    const text = generateGameLogText({
      winner,
      roundNumber,
      totalMoves: moveCount,
      playerInfluencePct: stats.playerInfluencePct,
      aiInfluencePct: stats.aiInfluencePct,
      playerDefeats: stats.playerDefeats,
      aiDefeats: stats.aiDefeats,
      tiles,
      units,
      moveHistory,
    });
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to copy text', err);
      return false;
    }
  }, [winner, roundNumber, moveCount, stats, tiles, units, moveHistory]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* 1. TOP FLOATING ISLAND: Title & Status */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-3 p-2 px-3.5 rounded-xl bg-slate-900/80 border border-slate-800 backdrop-blur-md shadow-xl pointer-events-auto">
        <span className="font-display font-bold text-sm tracking-wider text-slate-200">
          HexDominion
        </span>
        <div className="w-px h-3.5 bg-slate-800" />
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              winner
                ? winner === 'player'
                  ? 'bg-cyan-400 shadow-[0_0_8px_#38bdf8]'
                  : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'
                : currentTurn === 'player'
                ? 'bg-cyan-400 shadow-[0_0_8px_#38bdf8] animate-pulse'
                : 'bg-rose-500 shadow-[0_0_8px_#f43f5e] animate-pulse'
            }`}
          />
          <span className="font-medium text-slate-300">
            {winner ? (
              <span className="font-bold text-white">
                {winner === 'player' ? 'Victory Achieved' : 'Defeated in Battle'}
              </span>
            ) : (
              <>
                Round {roundNumber} ·{' '}
                {currentTurn === 'player'
                  ? selectedUnit
                    ? legalMoves.length === 0
                      ? (
                        <span className="text-slate-400">
                          {UNIT_DEFINITIONS[selectedUnit.rank].name} · no legal moves
                        </span>
                      )
                      : `${UNIT_DEFINITIONS[selectedUnit.rank].name} (Moves ${UNIT_DEFINITIONS[selectedUnit.rank].speed} · Aura ${UNIT_DEFINITIONS[selectedUnit.rank].auraRank})`
                    : 'Your Turn'
                  : 'AI thinking...'}
              </>
            )}
          </span>
        </div>
      </div>

      {/* 2. TOP RIGHT FLOATING CONTROLS: Utility Buttons */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2 pointer-events-auto">
        {/* Subtle New Match Button */}
        <button
          onClick={initGame}
          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-800 backdrop-blur-md shadow-xl transition-all flex items-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
          <span>New Match</span>
        </button>

        {/* Export Game Log Button */}
        <button
          onClick={handleExportText}
          title="Export Game Transcript as Text"
          className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 backdrop-blur-md shadow-xl transition-all flex items-center gap-1"
        >
          <Download className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs hidden md:inline font-medium">Export</span>
        </button>

        {/* Last Move Indicator Toggle */}
        <button
          onClick={() => setShowLastMove((v) => !v)}
          title={showLastMove ? 'Hide Last Move' : 'Show Last Move'}
          className={`p-2 rounded-xl border backdrop-blur-md shadow-xl transition-all ${
            showLastMove
              ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50 shadow-cyan-500/10'
              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-400 border-slate-800'
          }`}
        >
          <Route className="w-3.5 h-3.5" />
        </button>

        {/* Sound Toggle */}
        <button
          onClick={() => setSoundEnabled((s) => !s)}
          title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
          className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 backdrop-blur-md shadow-xl transition-all"
        >
          {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>

        {/* Rules Codex Modal Button */}
        <button
          onClick={() => setIsRulesOpen(true)}
          title="Game Rules Codex"
          className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 backdrop-blur-md shadow-xl transition-all"
        >
          <BookOpen className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 3. TOP CENTER INFLUENCE RATIO BAR */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-md text-[11px] font-mono tabular-nums shadow-lg pointer-events-none">
        <div className="flex items-center gap-1.5 text-cyan-400">
          <Crown className="w-3.5 h-3.5" />
          <span>{barStats.playerInfluencePct}%</span>
        </div>

        <div className="w-28 h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
          <div
            style={{ width: `${barStats.playerInfluencePct}%` }}
            className="bg-cyan-500 transition-all duration-300"
          />
          <div
            style={{ width: `${barStats.aiInfluencePct}%` }}
            className="bg-rose-500 transition-all duration-300 ml-auto"
          />
        </div>

        <div className="flex items-center gap-1.5 text-rose-400">
          <span>{barStats.aiInfluencePct}%</span>
          <Crown className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* 3.5 TURN NOTICE (e.g. one side has no legal move and the other continues) */}
      {turnNotice && !winner && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700 backdrop-blur-md shadow-lg text-xs text-slate-300 animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-none">
          {turnNotice}
        </div>
      )}

      {/* 4. MAIN FULLSCREEN HEX BOARD (Pure GPU-accelerated SVG) */}
      {/* While reviewing, leave room at the bottom for the replay controller */}
      <div className={`w-full h-full ${isReviewing ? 'pb-28' : ''}`}>
        <HexBoard
          tiles={tiles}
          units={displayUnits}
          selectedUnit={selectedUnit}
          legalMoves={legalMoves}
          currentTurn={currentTurn}
          isAiThinking={isAiThinking}
          lastMove={displayLastMove}
          showLastMove={isReviewing || showLastMove}
          isGameOver={Boolean(winner)}
          isFinalMove={!isReviewing || replayIndex === moveHistory.length}
          onSelectUnit={handleSelectUnit}
          onExecuteMove={handlePlayerMove}
        />
      </div>

      {/* 5. POST-GAME MOVE-BY-MOVE REPLAY CONTROLLER */}
      {winner && isReviewing && (
        <ReplayControls
          moveHistory={moveHistory}
          index={replayIndex}
          onIndexChange={setReplayIndex}
          onShowSummary={() => setShowGameOverModal(true)}
          onExportText={handleExportText}
          onNewMatch={initGame}
        />
      )}

      {/* 6. MODALS */}
      <RulesModal isOpen={isRulesOpen} onClose={() => setIsRulesOpen(false)} />

      {winner && showGameOverModal && (
        <GameOverModal
          winner={winner}
          roundNumber={roundNumber}
          totalMoves={moveCount}
          playerInfluencePct={stats.playerInfluencePct}
          aiInfluencePct={stats.aiInfluencePct}
          playerDefeats={stats.playerDefeats}
          aiDefeats={stats.aiDefeats}
          lastMove={lastMove}
          onRestart={initGame}
          onInspectBoard={() => {
            setReplayIndex(moveHistory.length);
            setShowGameOverModal(false);
          }}
          onExportText={handleExportText}
          onCopyText={handleCopyText}
        />
      )}
    </div>
  );
}
