import { HexTile } from '../types/game';
import { chooseAIAction, SearchOptions, SearchResult } from './aiEngine';
import { GameState } from './gameState';

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

// Runs the search off the main thread so the board stays responsive while the AI thinks
scope.onmessage = (e) => {
  const { requestId, state, tiles, options } = e.data;
  scope.postMessage({ requestId, result: chooseAIAction(state, tiles, options) });
};
