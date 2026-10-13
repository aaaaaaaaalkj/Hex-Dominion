import { HexTile } from '../types/game';
import { chooseAIAction, SearchOptions, SearchResult } from './aiEngine';
import { GameState } from './gameState';
import { chooseConcentrationAction } from './concentrationAI';
import { chooseDominionAction } from './vectorEngine';

// Which Dominion opponent to play against: the alpha-beta search engine, or the
// experimental concentration bot (concentrationAI.ts).
const DOMINION_AI: 'search' | 'concentration' = 'concentration';

export interface AIRequest {
  requestId: number;
  state: GameState;
  tiles: Map<string, HexTile>;
  options?: SearchOptions;
}

export interface AIResponse {
  requestId: number;
  result: SearchResult | null;
}

// Worker global scope (typed locally; the project compiles against the DOM lib)
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<AIRequest>) => void) | null;
  postMessage: (message: AIResponse) => void;
};

// Runs the search off the main thread so the board stays responsive while the AI thinks.
// Dominion uses the opponent picked by DOMINION_AI, Gambit the object-model search.
scope.onmessage = (e) => {
  const { requestId, state, tiles, options } = e.data;
  const result: SearchResult | null =
    state.mode !== 'dominion'
      ? chooseAIAction(state, tiles, options)
      : DOMINION_AI === 'concentration'
        ? chooseConcentrationAction(state, tiles)
        : chooseDominionAction(state, tiles, options);
  scope.postMessage({ requestId, result });
};
