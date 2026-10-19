"""Trains the hex value network on tablebase positions (exact labels) and,
optionally, search-labelled positions with more units.

  ml/.venv/bin/python ml/train.py [--extra positions.bin ...] [--epochs 3]

Tablebase labels are win/loss/never-resolved (+1/-1/0) for the side to move.
Validation reports the 3-class accuracy per material against a baseline that
only knows the material and who is to move (its most common outcome).
"""
import argparse
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch

from hexdata import augment, encode, load_records, material_key, sample_table, table_names
from model import ValueNet

parser = argparse.ArgumentParser()
parser.add_argument('--per-table', type=int, default=400_000)
parser.add_argument('--per-lopsided', type=int, default=50_000, help='two extra units vs a bare King: near-certain wins')
parser.add_argument('--val-per-table', type=int, default=20_000)
parser.add_argument('--extra', nargs='*', default=[], help='search-labelled position files')
parser.add_argument('--extra-repeat', type=int, default=1, help='oversample the extra positions')
parser.add_argument('--epochs', type=int, default=3)
parser.add_argument('--batch', type=int, default=512)
parser.add_argument('--lr', type=float, default=2e-3)
parser.add_argument('--channels', type=int, default=32)
parser.add_argument('--blocks', type=int, default=4)
parser.add_argument('--threads', type=int, default=3)
parser.add_argument('--out', default=str(Path(__file__).parent / 'checkpoints' / 'value.pt'))
args = parser.parse_args()
torch.set_num_threads(args.threads)
rng = np.random.default_rng(1)


def cat(parts):
    return tuple(np.concatenate(x) for x in zip(*parts))


# ---- Data -----------------------------------------------------------------------
train_parts, val_parts = [], []
for name in table_names():
    lopsided = sorted(len(h) for h in name.split('-')) == [1, 3]
    count = args.per_lopsided if lopsided else args.per_table
    u, moved, side, value = sample_table(name, count + args.val_per_table, rng)
    k = min(args.val_per_table, len(u) // 10)
    val_parts.append((u[:k], moved[:k], side[:k], value[:k]))
    train_parts.append((u[k:], moved[k:], side[k:], value[k:]))
    print(f'{name:7} train {len(u) - k:8}  val {k:6}', flush=True)
train = cat(train_parts)
val = cat(val_parts)

extra_val = None
if args.extra:
    eu, em, es, ev = cat([load_records(p) for p in args.extra])
    perm = rng.permutation(len(eu))
    k = max(1, len(eu) // 20)
    vi, ti = perm[:k], perm[k:]
    extra_val = (eu[vi], em[vi], es[vi], ev[vi])
    ti = np.tile(ti, args.extra_repeat)
    train = cat([train, (eu[ti], em[ti], es[ti], ev[ti])])
    print(f'extra   train {len(ti):8}  val {k:6}', flush=True)

# Baseline: the most common outcome for each (material, side to move) in training
outcomes = defaultdict(Counter)
tb_train = cat(train_parts)
for key, v in zip((material_key(u, s) for u, s in zip(tb_train[0], tb_train[2])), tb_train[3]):
    outcomes[key][v] += 1
baseline = {key: c.most_common(1)[0][0] for key, c in outcomes.items()}
val_keys = np.array([material_key(u, s) for u, s in zip(val[0], val[2])])


# ---- Model ----------------------------------------------------------------------
model = ValueNet(args.channels, args.blocks)
print(f'parameters {sum(p.numel() for p in model.parameters())}', flush=True)
steps = args.epochs * (len(train[0]) // args.batch)
opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps, pct_start=0.05)


def predict(data, batch=4096):
    model.eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(data[0]), batch):
            x = encode(data[0][i:i + batch], data[1][i:i + batch], data[2][i:i + batch])
            out.append(model(torch.from_numpy(x)).numpy())
    model.train()
    return np.concatenate(out)


def classes(v):
    return np.where(v > 0.5, 1, np.where(v < -0.5, -1, 0))


def report():
    pred = predict(val)
    target = val[3]
    acc = classes(pred) == target
    base = np.array([baseline.get(k, 0) for k in val_keys]) == target
    lines = [f'  tablebase val: mse {np.mean((pred - target) ** 2):.4f}  accuracy {acc.mean():.4f}  (baseline {base.mean():.4f})']
    for key in sorted(set(val_keys), key=lambda k: (len(k), k)):
        sel = val_keys == key
        lines.append(f'    {key:7} n {sel.sum():6}  accuracy {acc[sel].mean():.4f}  baseline {base[sel].mean():.4f}')
    metrics = {'tb_mse': float(np.mean((pred - target) ** 2)), 'tb_acc': float(acc.mean())}
    if extra_val is not None:
        ep = predict(extra_val)
        et = extra_val[3]
        decided = np.abs(et) > 0.3
        sign = (np.sign(ep[decided]) == np.sign(et[decided])).mean() if decided.any() else float('nan')
        lines.append(f'  extra val: mse {np.mean((ep - et) ** 2):.4f}  sign agreement on decided {sign:.4f}')
        metrics['extra_mse'] = float(np.mean((ep - et) ** 2))
    print('\n'.join(lines), flush=True)
    return metrics


# ---- Training ---------------------------------------------------------------------
out = Path(args.out)
out.parent.mkdir(parents=True, exist_ok=True)
n = len(train[0])
step = 0
for epoch in range(args.epochs):
    perm = rng.permutation(n)
    started, seen, loss_sum = time.time(), 0, 0.0
    for i in range(0, n - args.batch + 1, args.batch):
        idx = perm[i:i + args.batch]
        u, moved = augment(train[0][idx], train[1][idx], rng)
        x = torch.from_numpy(encode(u, moved, train[2][idx]))
        y = torch.from_numpy(train[3][idx])
        loss = torch.mean((model(x) - y) ** 2)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        step += 1
        seen += len(idx)
        loss_sum += loss.item() * len(idx)
        if step % 2000 == 0:
            print(f'  epoch {epoch + 1} step {step}/{steps}  loss {loss_sum / seen:.4f}  {seen / (time.time() - started):.0f} pos/s', flush=True)
    print(f'epoch {epoch + 1}: train loss {loss_sum / seen:.4f}  ({time.time() - started:.0f}s)', flush=True)
    metrics = report()
    torch.save({'model': model.state_dict(), 'channels': args.channels, 'blocks': args.blocks, 'metrics': metrics}, out)
