# HexDominion

Turn-based strategy on a 61-hex board against a search-based AI, with two rulesets:

- **Dominion**: rank-based combat and influence. Units project influence onto nearby tiles, attack and defense add up the ranks of adjacent allies, and every unit moves once per round, in rank order (King first, Scouts last).
- **Gambit**: chess-like rules on the hex board: King, Rooks, Bishops and pawn-like Scouts, alternating turns, checkmate wins.

The full rules are in the in-game rules codex (book icon).

Matches can be played with a chess clock (5 minutes + 10 seconds per move, timer button); running out of time loses the game.

## Development

```sh
npm install
npm run dev     # http://localhost:3000
npm run lint    # type check
npm run build   # static site in dist/
```

### Playing against an agent (dev server only)

With the opponent switch set to **Claude**, every red turn is written to `.remote/` by the dev server: `state.txt` (text board, numbered legal moves, threat notes) and `position.json` (exact game state). An agent answers with `npm run remote:move -- <n>`. `npm run remote:watch` analyzes each new position with a timed search over the game's rules and prints the clocks, the top candidate moves and King-safety notes, one line per turn. None of this is part of the production build.

The build is a static site with no backend: the AI runs in a Web Worker in the browser, and fonts are bundled.

## License

[MIT](LICENSE)
