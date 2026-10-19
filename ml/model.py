"""Hex-convolutional value network: a small ResNet on the 9x9 axial grid."""
import torch
from torch import nn

from hexdata import N_PLANES, board_mask

# In axial coordinates (grid axes q, r) a tile's six neighbours are all 3x3
# offsets except (+1, +1) and (-1, -1)
HEX_KERNEL = torch.ones(3, 3)
HEX_KERNEL[0, 0] = HEX_KERNEL[2, 2] = 0


class HexConv(nn.Conv2d):
    def __init__(self, cin, cout):
        super().__init__(cin, cout, 3, padding=1, bias=False)
        self.register_buffer('kernel_mask', HEX_KERNEL)

    def forward(self, x):
        return nn.functional.conv2d(x, self.weight * self.kernel_mask, None, padding=1)


class Block(nn.Module):
    def __init__(self, c):
        super().__init__()
        self.c1, self.b1 = HexConv(c, c), nn.BatchNorm2d(c)
        self.c2, self.b2 = HexConv(c, c), nn.BatchNorm2d(c)

    def forward(self, x, mask):
        y = torch.relu(self.b1(self.c1(x))) * mask
        y = self.b2(self.c2(y))
        return torch.relu(x + y) * mask


class ValueNet(nn.Module):
    def __init__(self, channels=32, blocks=4):
        super().__init__()
        self.register_buffer('mask', torch.from_numpy(board_mask())[None, None])
        self.stem = HexConv(N_PLANES, channels)
        self.bn = nn.BatchNorm2d(channels)
        self.blocks = nn.ModuleList(Block(channels) for _ in range(blocks))
        self.head = nn.Sequential(nn.Linear(2 * channels, 64), nn.ReLU(), nn.Linear(64, 1))

    def forward(self, x):
        mask = self.mask
        x = torch.relu(self.bn(self.stem(x))) * mask
        for block in self.blocks:
            x = block(x, mask)
        avg = x.sum(dim=(2, 3)) / mask.sum()
        mx = (x - (1 - mask) * 1e4).amax(dim=(2, 3))
        return torch.tanh(self.head(torch.cat([avg, mx], dim=1))).squeeze(1)
