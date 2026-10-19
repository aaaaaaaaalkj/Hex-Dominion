/**
 * The hex value network (ml/model.py) on the vector engine: a small ResNet of
 * hex convolutions over the 61 playable tiles, trained on endgame tablebases and
 * search-labelled positions with five or six units (ml/train.py).
 *
 * Weights come from ml/export.py, with batch norms folded into the convolutions.
 * The network sees the board from the side to move and returns its expected
 * result in (-1, 1); netEvaluator turns that into a search score.
 */
import { closed, coords, evaluate, Evaluator, hashKey, playableTiles, tileIndex, VectorState } from './vectorEngine';

interface Layer { w: Float32Array; b: Float32Array }
interface RawLayer { w: string; b: string }
export interface ValueNetFile {
  channels: number;
  planes: number;
  taps: [number, number][];
  stem: RawLayer;
  blocks: { c1: RawLayer; c2: RawLayer }[];
  fc1: RawLayer;
  fc2: RawLayer;
  test: { u: number[]; moved: number[]; side: 1 | -1; value: number };
}

/** Value of a position for the side to move, in (-1, 1). */
export type ValueNet = (s: VectorState) => number;

const P = playableTiles.length; // 61
const pIndex = new Map(playableTiles.map((t, p) => [t, p]));

function floats(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
const layer = (l: RawLayer): Layer => ({ w: floats(l.w), b: floats(l.b) });

export function createValueNet(file: ValueNetFile): ValueNet {
  const C = file.channels, F = file.planes, T = file.taps.length;
  const stem = layer(file.stem);
  const blocks = file.blocks.map((b) => ({ c1: layer(b.c1), c2: layer(b.c2) }));
  const fc1 = layer(file.fc1), fc2 = layer(file.fc2);
  const H = fc1.b.length;
  // nbr[k * P + p]: the tile tap k of tile p reads, or -1 off the board
  const nbr = new Int32Array(T * P);
  file.taps.forEach(([dq, dr], k) => {
    playableTiles.forEach((t, p) => {
      const j = tileIndex(coords[t].q + dq, coords[t].r + dr);
      nbr[k * P + p] = j !== undefined && pIndex.has(j) ? pIndex.get(j)! : -1;
    });
  });

  const input = new Float32Array(P * F);
  const a = new Float32Array(P * C), b = new Float32Array(P * C), c = new Float32Array(P * C);
  const hidden = new Float32Array(H), pooled = new Float32Array(2 * C);

  // out = conv(inp) + bias, activations tile-major ([tile][channel])
  function conv(inp: Float32Array, cin: number, out: Float32Array, l: Layer) {
    for (let p = 0; p < P; p++) out.set(l.b, p * C);
    for (let k = 0; k < T; k++) {
      for (let p = 0; p < P; p++) {
        const n = nbr[k * P + p];
        if (n < 0) continue;
        const o = p * C;
        for (let ci = 0; ci < cin; ci++) {
          const x = inp[n * cin + ci];
          if (x === 0) continue;
          const wo = (k * cin + ci) * C;
          for (let co = 0; co < C; co++) out[o + co] += x * l.w[wo + co];
        }
      }
    }
  }
  const relu = (x: Float32Array) => { for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0; };

  // Input planes (ml/hexdata.py encode) from the side to move's view
  function encode(s: VectorState) {
    input.fill(0);
    let ownTop = 0, oppTop = 0;
    for (const t of playableTiles) {
      const v = s.u[t] * s.side;
      if (!s.moved[t]) { if (v > ownTop) ownTop = v; else if (-v > oppTop) oppTop = -v; }
    }
    playableTiles.forEach((t, p) => {
      const o = p * F, v = s.u[t] * s.side;
      if (v > 0) {
        input[o + v - 1] = 1;
        if (s.moved[t]) input[o + 8] = 1;
        else if (v === ownTop) input[o + 11] = 1;
      } else if (v < 0) {
        input[o + 3 - v] = 1;
        if (s.moved[t]) input[o + 9] = 1;
        else if (-v === oppTop) input[o + 12] = 1;
      }
      input[o + 10] = (s.I[t] * s.side) / 8;
      input[o + 13] = 1;
    });
  }

  const net: ValueNet = (s) => {
    encode(s);
    conv(input, F, a, stem);
    relu(a);
    for (const blk of blocks) {
      conv(a, C, b, blk.c1);
      relu(b);
      conv(b, C, c, blk.c2);
      for (let i = 0; i < a.length; i++) { const v = a[i] + c[i]; a[i] = v > 0 ? v : 0; }
    }
    // Average and max over the tiles; activations are >= 0 after the last ReLU
    pooled.fill(0);
    for (let p = 0; p < P; p++) {
      for (let ch = 0; ch < C; ch++) {
        const v = a[p * C + ch];
        pooled[ch] += v / P;
        if (v > pooled[C + ch]) pooled[C + ch] = v;
      }
    }
    hidden.set(fc1.b);
    for (let i = 0; i < 2 * C; i++) {
      const x = pooled[i];
      if (x === 0) continue;
      for (let h = 0; h < H; h++) hidden[h] += x * fc1.w[i * H + h];
    }
    let y = fc2.b[0];
    for (let h = 0; h < H; h++) if (hidden[h] > 0) y += hidden[h] * fc2.w[h];
    return Math.tanh(y);
  };
  return net;
}

/** The network's output on the export's test position minus the expected value (should be ~0). */
export function selfTest(file: ValueNetFile, net: ValueNet): number {
  const { u, moved, side, value } = file.test;
  const su = new Int8Array(coords.length), sm = new Uint8Array(coords.length), I = new Int16Array(coords.length);
  playableTiles.forEach((t, p) => { su[t] = u[p]; sm[t] = moved[p]; });
  for (let t = 0; t < coords.length; t++) if (su[t]) for (const j of closed[t]) I[j] += su[t];
  return net({ u: su, moved: sm, I, side, winner: 0, round: 1, h1: 0, h2: 0 }) - value;
}

// Labels of search-scored positions were tanh(score / SCALE) (scripts/label-positions.mjs)
const SCALE = 300;
const CLAMP = 0.995;

/**
 * A search evaluator (Red's point of view) that asks the network in positions
 * with at most `maxUnits` units and the hand-written evaluation otherwise.
 * Results are cached by position hash.
 */
export function netEvaluator(net: ValueNet, maxUnits = Infinity): Evaluator {
  const cache = new Map<number, number>();
  return (s) => {
    let units = 0;
    for (const t of playableTiles) if (s.u[t]) units++;
    if (units > maxUnits) return evaluate(s);
    const key = hashKey(s);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const v = Math.max(-CLAMP, Math.min(CLAMP, net(s)));
    const score = SCALE * Math.atanh(v) * (s.side === -1 ? 1 : -1);
    if (cache.size > 2_000_000) cache.clear();
    cache.set(key, score);
    return score;
  };
}
