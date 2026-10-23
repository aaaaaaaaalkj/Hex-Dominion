"""Exports a value-network checkpoint for src/utils/valueNet.ts.

  ml/.venv/bin/python ml/export.py ml/checkpoints/value-combined.pt ml/checkpoints/value-net.json

Batch norms are folded into the convolutions before them, and each hex
convolution keeps only its seven taps. Tensors are base64 Float32 (little-endian):
  conv  w[tap][cin][cout], b[cout]   taps are (dq, dr) offsets, see TAPS
  fc    w[in][out], b[out]
A test position and the network's output on it let the TypeScript side check itself.
"""
import base64
import json
import sys

import numpy as np
import torch

from hexdata import N_BASE, encode
from model import ValueNet

# Kernel index (i, j) reads grid cell (q + i - 1, r + j - 1); (0, 0) and (2, 2) are masked
TAPS = [(i - 1, j - 1) for i in range(3) for j in range(3) if (i, j) not in ((0, 0), (2, 2))]


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype='<f4').tobytes()).decode()


def fold(conv, bn):
    scale = (bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach().numpy()
    w = conv.weight.detach().numpy() * scale[:, None, None, None]  # (cout, cin, 3, 3)
    b = (bn.bias - bn.running_mean * bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach().numpy()
    taps = np.stack([w[:, :, i + 1, j + 1] for i, j in TAPS])  # (tap, cout, cin)
    return {'w': b64(taps.transpose(0, 2, 1)), 'b': b64(b)}


def linear(fc):
    return {'w': b64(fc.weight.detach().numpy().T), 'b': b64(fc.bias.detach().numpy())}


src, dst = sys.argv[1], sys.argv[2]
ck = torch.load(src)
planes = ck.get('planes', N_BASE)
model = ValueNet(ck['channels'], ck['blocks'], planes)
model.load_state_dict(ck['model'])
model.eval()

# A test position: a random placement of 16 units, packed enough for captures
rng = np.random.default_rng(0)
u = np.zeros((1, 61), np.int8)
tiles = rng.choice(np.arange(10, 51), 16, replace=False)
u[0, tiles] = [4, 3, 3, 2, 1, 1, 1, 1, -4, -3, -2, -2, -1, -1, -1, -1]
moved = np.zeros((1, 61), np.uint8)
moved[0, tiles[[1, 4, 9, 12]]] = 1
side = np.array([-1], np.int8)
with torch.no_grad():
    out = float(model(torch.from_numpy(encode(u, moved, side, planes)))[0])

net = {
    'channels': ck['channels'],
    'planes': model.stem.in_channels,
    'taps': TAPS,
    'stem': fold(model.stem, model.bn),
    'blocks': [{'c1': fold(b.c1, b.b1), 'c2': fold(b.c2, b.b2)} for b in model.blocks],
    'fc1': linear(model.head[0]),
    'fc2': linear(model.head[2]),
    'test': {'u': u[0].tolist(), 'moved': moved[0].tolist(), 'side': int(side[0]), 'value': out},
    'metrics': ck.get('metrics', {}),
}
with open(dst, 'w') as f:
    json.dump(net, f)
print(f'{dst}: test value {out:.6f}')
