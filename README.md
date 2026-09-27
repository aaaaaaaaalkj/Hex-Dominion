# HexDominion

Turn-based strategy on a 61-hex board against a search-based AI, with two rulesets:

- **Dominion**: rank-based combat and influence. Units project influence onto nearby tiles, attack and defense add up the ranks of adjacent allies, and every unit moves once per round.
- **Gambit**: chess-like rules on the hex board: King, Rooks, Bishops and pawn-like Scouts, alternating turns, checkmate wins.

The full rules are in the in-game rules codex (book icon).

## Development

```sh
npm install
npm run dev     # http://localhost:3000
npm run lint    # type check
npm run build   # static site in dist/
```

The build is a static site with no backend: the AI runs in a Web Worker in the browser, and fonts are bundled.

## License

[MIT](LICENSE)
