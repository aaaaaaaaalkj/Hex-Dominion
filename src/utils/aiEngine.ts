import {
  HexTile,
  Unit,
  LegalMove,
  UnitRank,
  AIDifficulty,
} from '../types/game';
import {
  calculateLegalMovesForUnit,
  computeInfluenceMap,
  countInfluencedTiles,
  calculateDefensiveRank,
  calculateAttackRank,
  getUnitAuraRank,
  getUnitSpeed,
  applyMove,
} from './gameRules';
import { hexDistance } from './hexMath';

export interface AIMoveChoice {
  unit: Unit;
  move: LegalMove;
  score: number;
  explanation: string;
}

const RANK_VALUES: Record<UnitRank, number> = {
  4: 100000, // King (Game loss if lost)
  3: 4500,   // General
  2: 2200,   // Captain
  1: 1000,   // Scout
};

/**
 * Finds the best tactical move for the AI using Grandmaster heuristics:
 * - Master-level combined rank combat calculations (defensive support + flanking attack rank)
 * - Active escort clustering around AI King to maximize its defensive rank
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

  const playerUnits = units.filter((u) => u.team === 'player' && !u.isDefeated);
  const friendlyUnits = units.filter((u) => u.team === 'ai' && !u.isDefeated);

  const aiKing = units.find(
    (u) => u.team === 'ai' && u.rank === 4 && !u.isDefeated
  );
  const playerKing = units.find(
    (u) => u.team === 'player' && u.rank === 4 && !u.isDefeated
  );

  const playerUnmovedUnits = playerUnits.filter((u) => !u.hasMovedThisRound);
  const isLastMoveOfRound =
    candidateUnits.length === 1 && playerUnmovedUnits.length === 0;

  const allPossibleMoves: AIMoveChoice[] = [];

  for (const unit of candidateUnits) {
    const legalMoves = calculateLegalMovesForUnit(unit, tiles, units);

    for (const move of legalMoves) {
      const evaluation = evaluateGrandmasterMove(
        unit,
        move,
        tiles,
        units,
        playerUnits,
        friendlyUnits,
        aiKing,
        playerKing,
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
  aiKing: Unit | undefined,
  playerKing: Unit | undefined,
  aiCandidateCount: number,
  isLastMoveOfRound: boolean
): { score: number; explanation: string } {
  let score = 0;
  let explanation = 'Tactical positioning';

  // 1. INSTANT WIN: Assassinate Player King (Rank 4)
  if (move.isAttack && move.targetUnitRank === 4) {
    return {
      score: 1000000,
      explanation: 'Strike down player King to win the war!',
    };
  }

  // 2. SIMULATE BOARD AFTER THIS MOVE
  const { newUnits: simUnits } = applyMove(unit.id, move, units);

  const simAiKing = simUnits.find(
    (u) => u.team === 'ai' && u.rank === 4 && !u.isDefeated
  );
  const simPlayerKing = simUnits.find(
    (u) => u.team === 'player' && u.rank === 4 && !u.isDefeated
  );

  if (!simAiKing) {
    return { score: -2000000, explanation: 'Fatal blunder: loses King' };
  }

  // 3. COMBINED RANK DEFENSE CHECK FOR AI KING
  // Calculate AI King's defensive rank on the simulated board (4 + friendly neighbors)
  const aiKingDefRank = calculateDefensiveRank(simAiKing, simUnits);

  // Check if any Player unit can reach and defeat AI King
  // Under the new rule, an attack succeeds if playerAttackRank > aiKingDefRank
  for (const pu of playerUnits) {
    const testPlayerUnit: Unit = {
      ...pu,
      hasMovedThisRound: false, // test with full movement capacity
    };

    const playerMoves = calculateLegalMovesForUnit(
      testPlayerUnit,
      tiles,
      simUnits
    );

    const fatalMove = playerMoves.find(
      (m) => m.isAttack && m.targetUnitId === simAiKing.id
    );

    if (fatalMove) {
      return {
        score: -2000000,
        explanation: 'FATAL: Leaves AI King vulnerable to combined-rank assassination!',
      };
    }
  }

  // If Player King is near, check proximity
  if (simPlayerKing) {
    const distToPlayerKing = hexDistance(
      simAiKing.coord,
      simPlayerKing.coord
    );
    if (distToPlayerKing <= 4 && aiKingDefRank <= 4) {
      score -= 100000; // Dangerously isolated near player frontline
    }
  }

  // 4. KING DISCIPLINE & FORMATION (RANK 4)
  if (unit.rank === 4) {
    // Highly reward staying surrounded by bodyguards (each guard adds to defensive rank!)
    score += (aiKingDefRank - 4) * 4000;

    // Discourage reckless overextension into the player's half if undefended
    if (aiKingDefRank <= 4 && move.target.r >= 0) {
      score -= 50000;
    }
  }

  // 5. BODYGUARD & COMBINED RANK FORMATIONS (FOR GENERALS & CAPTAINS)
  // Moving friendly units adjacent to the AI King directly adds to its Defensive Rank!
  if (unit.rank !== 4 && simAiKing) {
    const distToKing = hexDistance(move.target, simAiKing.coord);
    if (distToKing === 1) {
      // Each adjacent ally adds its rank to the King's defensive rank
      const defRankBoost = getUnitAuraRank(unit.rank);
      score += defRankBoost * 3000;
      explanation = `Bolster King defensive rank (+${defRankBoost} DEF)`;
    }

    // If unit was already adjacent to King and moves away, penalize decreasing King DEF
    const prevDistToKing = hexDistance(unit.coord, simAiKing.coord);
    if (prevDistToKing === 1 && distToKing > 1) {
      score -= getUnitAuraRank(unit.rank) * 3500; // Stripping defense from King!
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
    score += move.target.r * 60;
  }

  // 10. INFLUENCE CONTROL
  // Reward moves that increase the number of tiles under net AI influence
  const before = countInfluencedTiles(computeInfluenceMap(tiles, units));
  const after = countInfluencedTiles(computeInfluenceMap(tiles, simUnits));
  const influenceGain = (after.ai - after.player) - (before.ai - before.player);
  score += influenceGain * 150;

  return { score, explanation };
}

function getRankName(rank: UnitRank): string {
  switch (rank) {
    case 4: return 'King';
    case 3: return 'General';
    case 2: return 'Captain';
    case 1: return 'Scout';
  }
}
