"""Kaupankäyntistrategia: EMA-risteys + RSI-suodatin + trendisuodatin.

Signaalit lasketaan VAIN suljettujen kynttilöiden perusteella:
  +1 = osta (nousuristeys, RSI ei yliostettu, hinta trendi-EMA:n yläpuolella)
  -1 = myy (laskuristeys tai RSI ylittää poistumisrajan)
   0 = ei toimintoa
"""
from __future__ import annotations

import pandas as pd

from .config import StrategyConfig
from .indicators import atr, ema, rsi


def compute_indicators(df: pd.DataFrame, cfg: StrategyConfig) -> pd.DataFrame:
    out = df.copy()
    out["ema_fast"] = ema(out["close"], cfg.fast_ema)
    out["ema_slow"] = ema(out["close"], cfg.slow_ema)
    out["rsi"] = rsi(out["close"], cfg.rsi_period)
    out["atr"] = atr(out, cfg.atr_period)
    if cfg.trend_ema > 0:
        out["ema_trend"] = ema(out["close"], cfg.trend_ema)
    return out


def generate_signals(df: pd.DataFrame, cfg: StrategyConfig) -> pd.DataFrame:
    out = compute_indicators(df, cfg)
    above = out["ema_fast"] > out["ema_slow"]
    prev_above = above.shift(1, fill_value=False)
    valid = out["ema_slow"].notna() & out["rsi"].notna() & out["atr"].notna()

    cross_up = above & ~prev_above & valid
    cross_down = ~above & prev_above & valid

    buy = cross_up & (out["rsi"] < cfg.rsi_entry_max)
    if cfg.trend_ema > 0:
        buy &= out["ema_trend"].notna() & (out["close"] > out["ema_trend"])

    sell = cross_down | (valid & (out["rsi"] > cfg.rsi_exit))

    out["signal"] = 0
    out.loc[sell, "signal"] = -1
    out.loc[buy, "signal"] = 1
    return out


def min_bars_needed(cfg: StrategyConfig) -> int:
    return max(cfg.slow_ema, cfg.trend_ema, cfg.rsi_period, cfg.atr_period) + 5
