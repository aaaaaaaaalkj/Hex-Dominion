import {
  HexTile,
  Unit,
  LegalMove,
  UnitRank,
  AIDifficulty,
} from '../types/game';
import {
  calculateLegalMovesForUnit,
  computeTeamReachSet,
  calculateDefensiveRank,
  calculateAttackRank,
  getUnitAuraRank,
  getUnitSpeed,
  applyMove,
} from './gameRules';
import { hexDistance, coordKey } from './hexMath';

export interface AIMoveChoice {
  unit: Unit;
  move: LegalMove;
  score: number;
  explanation: string;
}

const RANK_VALUES: Record<UnitRank, number> = {
  4: 100000, // Sovereign (Game loss if lost)
  3: 4500,   // Sentinel
  2: 2200,   // Warden
  1: 1000,   // Scout
};

/**
 * Finds the best tactical move for the AI using Grandmaster heuristics:
 * - Master-level combined rank combat calculations (defensive support + flanking attack rank)
 * - Active escort clustering around AI Sovereign to maximize its defensive rank
 * - Full awareness of player combined attack reach and round boundary resets
 * - Flanking opportunities to gang up on high-value player pieces
 */
export function chooseAIMove(
  tiles: Map<string, HexTile>,
  units: Unit[],
  difficulty: AIDifficulty = 'grandmaster'
): AIMoveChoice | null {
  // Get all active AI units that haven't moved yet this round
  const candidateUnits = units.filter(
    (u) => u.team === 'ai' && !u.isDefeated && !u.hasMovedThisRound
  );

  if (candidateUnits.length === 0) {
    return null;
  }

  // Precompute reach set once for candidate moves
  const aiReachSet = computeTeamReachSet('ai', tiles);

  const playerUnits = units.filter((u) => u.team === 'player' && !u.isDefeated);
  const friendlyUnits = units.filter((u) => u.team === 'ai' && !u.isDefeated);

  const aiSovereign = units.find(
    (u) => u.team === 'ai' && u.rank === 4 && !u.isDefeated
  );
  const playerSovereign = units.find(
    (u) => u.team === 'player' && u.rank === 4 && !u.isDefeated
  );

  const playerUnmovedUnits = playerUnits.filter((u) => !u.hasMovedThisRound);
  const isLastMoveOfRound =
    candidateUnits.length === 1 && playerUnmovedUnits.length === 0;

  const allPossibleMoves: AIMoveChoice[] = [];

  for (const unit of candidateUnits) {
    const legalMoves = calculateLegalMovesForUnit(
      unit,
      tiles,
      units,
      aiReachSet
    );

    for (const move of legalMoves) {
      const evaluation = evaluateGrandmasterMove(
        unit,
        move,
        tiles,
        units,
        playerUnits,
        friendlyUnits,
        aiSovereign,
        playerSovereign,
        candidateUnits.length,
        isLastMoveOfRound
      );

      allPossibleMoves.push({
        unit,
        move,
        score: evaluation.score,
        explanation: evaluation.explanation,
      });
    }
  }

  if (allPossibleMoves.length === 0) {
    return null;
  }

  // Sort from highest score to lowest
  allPossibleMoves.sort((a, b) => b.score - a.score);

  return allPossibleMoves[0];
}

function evaluateGrandmasterMove(
  unit: Unit,
  move: LegalMove,
  tiles: Map<string, HexTile>,
  units: Unit[],
  playerUnits: Unit[],
  friendlyUnits: Unit[],
  aiSovereign: Unit | undefined,
  playerSovereign: Unit | undefined,
  aiCandidateCount: number,
  isLastMoveOfRound: boolean
): { score: number; explanation: string } {
  let score = 0;
  let explanation = 'Tactical positioning';

  // 1. INSTANT WIN: Assassinate Player Sovereign (Rank 4)
  if (move.isAttack && move.targetUnitRank === 4) {
    return {
      score: 1000000,
      explanation: 'Strike down player Sovereign to win the war!',
    };
  }

  // 2. SIMULATE BOARD AFTER THIS MOVE
  const { newTiles: simTiles, newUnits: simUnits } = applyMove(
    unit.id,
    move,
    tiles,
    units
  );

  const simAiSovereign = simUnits.find(
    (u) => u.team === 'ai' && u.rank === 4 && !u.isDefeated
  );
  const simPlayerSovereign = simUnits.find(
    (u) => u.team === 'player' && u.rank === 4 && !u.isDefeated
  );

  if (!simAiSovereign) {
    return { score: -2000000, explanation: 'Fatal blunder: loses Sovereign' };
  }

  // 3. COMBINED RANK DEFENSE CHECK FOR AI SOVEREIGN
  // Calculate AI Sovereign's defensive rank on the simulated board (4 + friendly neighbors)
  const aiSovereignDefRank = calculateDefensiveRank(simAiSovereign, simUnits);

  // Check if any Player unit can reach and defeat AI Sovereign
  // Under the new rule, an attack succeeds if playerAttackRank > aiSovereignDefRank
  for (const pu of playerUnits) {
    const testPlayerUnit: Unit = {
      ...pu,
      hasMovedThisRound: false, // test with full movement capacity
    };

    const playerMoves = calculateLegalMovesForUnit(
      testPlayerUnit,
      simTiles,
      simUnits
    );

    const fatalMove = playerMoves.find(
      (m) => m.isAttack && m.targetUnitId === simAiSovereign.id
    );

    if (fatalMove) {
      return {
        score: -2000000,
        explanation: 'FATAL: Leaves AI Sovereign vulnerable to combined-rank assassination!',
      };
    }
  }

  // If Player Sovereign is near, check proximity
  if (simPlayerSovereign) {
    const distToPlayerSovereign = hexDistance(
      simAiSovereign.coord,
      simPlayerSovereign.coord
    );
    if (distToPlayerSovereign <= 4 && aiSovereignDefRank <= 4) {
      score -= 100000; // Dangerously isolated near player frontline
    }
  }

  // 4. SOVEREIGN DISCIPLINE & FORMATION (RANK 4)
  if (unit.rank === 4) {
    // Highly reward staying surrounded by bodyguards (each guard adds to defensive rank!)
    score += (aiSovereignDefRank - 4) * 4000;

    // Discourage reckless overextension into player territory if undefended
    if (aiSovereignDefRank <= 4 && move.target.r >= 0) {
      score -= 50000;
    }
  }

  // 5. BODYGUARD & COMBINED RANK FORMATIONS (FOR SENTINELS & WARDENS)
  // Moving friendly units adjacent to the AI Sovereign directly adds to its Defensive Rank!
  if (unit.rank !== 4 && simAiSovereign) {
    const distToSovereign = hexDistance(move.target, simAiSovereign.coord);
    if (distToSovereign === 1) {
      // Sentinel adds +2 to Sovereign defensive rank, Warden adds +1
      const defRankBoost = getUnitAuraRank(unit.rank);
      score += defRankBoost * 3000;
      explanation = `Bolster Sovereign defensive rank (+${defRankBoost} DEF)`;
    }

    // If unit was already adjacent to Sovereign and moves away, penalize decreasing Sovereign DEF
    const prevDistToSovereign = hexDistance(unit.coord, simAiSovereign.coord);
    if (prevDistToSovereign === 1 && distToSovereign > 1) {
      score -= getUnitAuraRank(unit.rank) * 3500; // Stripping defense from Sovereign!
    }
  }

  // 6. COMBINED RANK CAPTURES (ATTACKING)
  if (move.isAttack && move.targetUnitRank) {
    const victimValue = RANK_VALUES[move.targetUnitRank];
    const attackOverkill = (move.attackRank ?? 1) - (move.defenseRank ?? 1);
    score += victimValue * 2.5 + attackOverkill * 200;
    explanation = `Combined attack on player ${getRankName(move.targetUnitRank)} (ATK ${move.attackRank} vs DEF ${move.defenseRank})`;
  }

  // 7. RETALIATION CHECK ON MOVING UNIT
  // Check if player units can capture this unit at its target position
  const simMovingUnit = simUnits.find((u) => u.id === unit.id);
  if (simMovingUnit) {
    const myDefRank = calculateDefensiveRank(simMovingUnit, simUnits);
    for (const pu of playerUnits) {
      const dist = hexDistance(pu.coord, move.target);
      const puSpeed = getUnitSpeed(pu.rank);
      if (dist <= puSpeed) {
        // Can this player unit and its allies overpower myDefRank?
        const playerAtkRank = calculateAttackRank(pu, move.target, simUnits);
        if (playerAtkRank > myDefRank) {
          const penalty = RANK_VALUES[unit.rank] * 1.6;
          score -= penalty;
          break;
        }
      }
    }
  }

  // 8. FLANKING SUPPORT / GANGING UP
  // If moving adjacent to an enemy unit, we provide flanking support for future attacks!
  for (const pu of playerUnits) {
    if (hexDistance(move.target, pu.coord) === 1) {
      score += 400 * unit.rank; // Flanking pressure
    }
  }

  // 9. SCOUT (L1) FRONTLINE EXPANSION
  if (unit.rank === 1) {
    if (move.flipsControl) score += 400;
    score += move.target.r * 60;
  }

  // 10. TERRITORY FLIPPING & BREACHING
  const targetTile = tiles.get(coordKey(move.target));
  if (targetTile) {
    if (targetTile.controlledBy === 'player') {
      score += 450;
      if (move.defenseRank !== undefined && move.defenseRank > 0) {
        score += move.defenseRank * 250; // Extra reward for breaking defended territory
        explanation = `Breach enemy territory (ATK ${move.attackRank} vs DEF ${move.defenseRank})`;
      }
    } else if (targetTile.controlledBy === null) {
      score += 200;
    }
  }

  return { score, explanation };
}

function getRankName(rank: UnitRank): string {
  switch (rank) {
    case 4: return 'Sovereign';
    case 3: return 'Sentinel';
    case 2: return 'Warden';
    case 1: return 'Scout';
  }
}
