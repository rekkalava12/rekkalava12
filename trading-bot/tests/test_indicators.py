import numpy as np
import pandas as pd

from bot.indicators import atr, ema, rsi


def test_ema_constant_series():
    s = pd.Series([5.0] * 50)
    assert np.allclose(ema(s, 10).dropna(), 5.0)


def test_rsi_bounds_and_extremes():
    up = pd.Series(np.arange(1, 60, dtype=float))
    assert rsi(up, 14).dropna().eq(100).all()
    down = pd.Series(np.arange(60, 1, -1, dtype=float))
    assert rsi(down, 14).dropna().lt(1).all()
    rnd = pd.Series(np.random.default_rng(0).normal(0, 1, 500).cumsum() + 100)
    r = rsi(rnd, 14).dropna()
    assert r.between(0, 100).all()


def test_atr_positive():
    df = pd.DataFrame({"high": [11, 12, 13] * 10, "low": [9, 10, 11] * 10, "close": [10, 11, 12] * 10}, dtype=float)
    assert (atr(df, 5).dropna() > 0).all()
