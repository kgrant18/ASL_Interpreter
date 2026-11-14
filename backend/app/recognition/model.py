"""Lightweight temporal classifier over normalized landmark windows.

Input:  [batch, SEQ_LEN, FEATURE_DIM]
Output: [batch, num_classes] logits (includes an explicit `_UNKNOWN` class)
"""

from __future__ import annotations

import torch
from torch import nn


class SignGRU(nn.Module):
    def __init__(self, feature_dim: int, num_classes: int, hidden: int = 128,
                 proj: int = 192, dropout: float = 0.3):
        super().__init__()
        # frame features + per-step velocity
        self.proj = nn.Sequential(
            nn.Linear(feature_dim * 2, proj),
            nn.LayerNorm(proj),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.gru = nn.GRU(proj, hidden, num_layers=2, batch_first=True,
                          bidirectional=True, dropout=dropout)
        self.head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(hidden * 4, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        vel = torch.zeros_like(x)
        vel[:, 1:] = x[:, 1:] - x[:, :-1]
        h = self.proj(torch.cat([x, vel], dim=-1))
        out, _ = self.gru(h)
        pooled = torch.cat([out.mean(dim=1), out.max(dim=1).values], dim=-1)
        return self.head(pooled)
