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

/**
 * A WebAssembly (SIMD) module exporting conv(inp, cin, out, w, b, nbr): the hex
 * convolution of createValueNet for C output channels, P tiles and T taps, with
 * byte offsets into the imported memory env.mem. Assembled here, as it is small.
 */
function convModule(C: number, P: number, T: number): Uint8Array<ArrayBuffer> {
  const V = C / 4;
  const uleb = (n: number) => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
  const sleb = (n: number) => { const o: number[] = []; for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); } };
  const str = (s: string) => [s.length, ...[...s].map((c) => c.charCodeAt(0))];
  const vec = (items: (number | number[])[]) => [...uleb(items.length), ...items.flat()];
  const section = (id: number, body: number[]) => [id, ...uleb(body.length), ...body];
  const I32 = 0x7f, F32 = 0x7d, V128 = 0x7b;
  const [inp, cin, out, w, b, nbr, p, k, n, ci, inBase, wBase, wo, x, xs] = Array.from({ length: 15 }, (_, i) => i);
  const acc = (j: number) => 15 + j;
  const get = (l: number) => [0x20, ...uleb(l)], set = (l: number) => [0x21, ...uleb(l)];
  const i32c = (v: number) => [0x41, ...sleb(v)];
  const simd = (op: number, ...rest: number[]) => [0xfd, ...uleb(op), ...rest];
  const vload = (off: number) => simd(0x00, 4, ...uleb(off)), vstore = (off: number) => simd(0x0b, 4, ...uleb(off));
  const ADD = 0x6a, MUL = 0x6c, SHL = 0x74, GE_S = 0x4e, BLOCK = 0x02, LOOP = 0x03, IF = 0x04, END = 0x0b, BR = 0x0c, BR_IF = 0x0d, VOID = 0x40;
  // for (l = 0; l < limit; l++) body   (limit: instructions pushing an i32)
  const loop = (l: number, limit: number[], body: number[]) => [
    ...i32c(0), ...set(l), BLOCK, VOID, LOOP, VOID,
    ...get(l), ...limit, GE_S, BR_IF, 1,
    ...body,
    ...get(l), ...i32c(1), ADD, ...set(l), BR, 0, END, END,
  ];
  const inner = [ // x = inp[inBase + ci]; if (x != 0) acc_j += x * w[wo + j]
    ...get(inBase), ...get(ci), ...i32c(2), SHL, ADD, 0x2a, 2, 0, ...set(x),
    ...get(x), 0x43, 0, 0, 0, 0, 0x5c, IF, VOID,
    ...get(x), ...simd(0x13), ...set(xs),
    ...get(wBase), ...get(ci), ...i32c(C * 4), MUL, ADD, ...set(wo),
    ...Array.from({ length: V }, (_, j) => [...get(acc(j)), ...get(xs), ...get(wo), ...vload(16 * j), ...simd(0xe6), ...simd(0xe4), ...set(acc(j))]).flat(),
    END,
  ];
  const tap = [ // n = nbr[k * P + p]; if (n >= 0) loop over ci
    ...get(nbr), ...get(k), ...i32c(P), MUL, ...get(p), ADD, ...i32c(2), SHL, ADD, 0x28, 2, 0, ...set(n),
    ...get(n), ...i32c(0), GE_S, IF, VOID,
    ...get(inp), ...get(n), ...get(cin), MUL, ...i32c(2), SHL, ADD, ...set(inBase),
    ...get(w), ...get(k), ...get(cin), MUL, ...i32c(C * 4), MUL, ADD, ...set(wBase),
    ...loop(ci, get(cin), inner),
    END,
  ];
  const tile = [
    ...Array.from({ length: V }, (_, j) => [...get(b), ...vload(16 * j), ...set(acc(j))]).flat(),
    ...loop(k, i32c(T), tap),
    ...get(out), ...get(p), ...i32c(C * 4), MUL, ADD, ...set(wo),
    ...Array.from({ length: V }, (_, j) => [...get(wo), ...get(acc(j)), ...vstore(16 * j)]).flat(),
  ];
  const code = [...loop(p, i32c(P), tile), END];
  const locals = vec([[...uleb(7), I32], [1, F32], [...uleb(1 + V), V128]]);
  const body = [...locals, ...code];
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...section(1, vec([[0x60, ...vec(Array(6).fill([I32]) as number[][]), 0]])),
    ...section(2, vec([[...str('env'), ...str('mem'), 0x02, 0x00, 1]])),
    ...section(3, vec([[0]])),
    ...section(7, vec([[...str('conv'), 0x00, 0]])),
    ...section(10, vec([[...uleb(body.length), ...body]])),
  ]);
}

type Conv = (inp: Float32Array, cin: number, out: Float32Array, l: Layer) => void;

/**
 * The convolution in WebAssembly, or null where SIMD is unavailable. Weights are
 * copied into its memory once; activations must be views of `mem` (alloc).
 */
function wasmConv(C: number, P: number, T: number, nbr: Int32Array, layers: Layer[], floats: number) {
  try {
    const bytes = 4 * (floats + nbr.length + layers.reduce((n, l) => n + l.w.length + l.b.length, 0)) + 16 * (2 * layers.length + 8);
    const mem = new WebAssembly.Memory({ initial: Math.ceil(bytes / 65536) });
    const conv = new WebAssembly.Instance(new WebAssembly.Module(convModule(C, P, T)), { env: { mem } }).exports.conv as (
      ...args: number[]
    ) => void;
    let top = 0;
    const alloc = (n: number) => { const view = new Float32Array(mem.buffer, top, n); top += Math.ceil(n / 4) * 16; return view; };
    const placed = new Map(layers.map((l) => [l, { w: alloc(l.w.length), b: alloc(l.b.length) }]));
    for (const [l, at] of placed) { at.w.set(l.w); at.b.set(l.b); }
    const nb = new Int32Array(mem.buffer, top, nbr.length);
    nb.set(nbr);
    top += Math.ceil(nbr.length / 4) * 16;
    const run: Conv = (inp, cin, out, l) => {
      const at = placed.get(l)!;
      conv(inp.byteOffset, cin, out.byteOffset, at.w.byteOffset, at.b.byteOffset, nb.byteOffset);
    };
    return { run, alloc };
  } catch {
    return null;
  }
}

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

  const hidden = new Float32Array(H), pooled = new Float32Array(2 * C);

  // out = conv(inp) + bias, activations tile-major ([tile][channel])
  function jsConv(inp: Float32Array, cin: number, out: Float32Array, l: Layer) {
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
  const wasm = C % 4 === 0 ? wasmConv(C, P, T, nbr, [stem, ...blocks.flatMap((b) => [b.c1, b.c2])], P * F + 3 * P * C) : null;
  const conv: Conv = wasm?.run ?? jsConv;
  const alloc = wasm?.alloc ?? ((n: number) => new Float32Array(n));
  const input = alloc(P * F);
  const a = alloc(P * C), b = alloc(P * C), c = alloc(P * C);

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
