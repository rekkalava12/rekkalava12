"""Hintadatan haku pörssistä (ccxt), CSV-tiedostosta tai synteettisesti testausta varten."""
from __future__ import annotations

import os
import time

import numpy as np
import pandas as pd

COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"]


def timeframe_ms(timeframe: str) -> int:
    units = {"m": 60_000, "h": 3_600_000, "d": 86_400_000, "w": 604_800_000}
    return int(timeframe[:-1]) * units[timeframe[-1]]


def make_exchange(name: str, authenticated: bool = False):
    import ccxt

    if not hasattr(ccxt, name):
        raise ValueError(f"Tuntematon pörssi '{name}'. Katso ccxt.exchanges.")
    params: dict = {"enableRateLimit": True}
    if authenticated:
        key, secret = os.environ.get("BOT_API_KEY"), os.environ.get("BOT_API_SECRET")
        if not key or not secret:
            raise RuntimeError("Live-tila vaatii ympäristömuuttujat BOT_API_KEY ja BOT_API_SECRET")
        params.update(apiKey=key, secret=secret)
        if os.environ.get("BOT_API_PASSWORD"):
            params["password"] = os.environ["BOT_API_PASSWORD"]
    return getattr(ccxt, name)(params)


def to_frame(rows: list[list]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=COLUMNS)
    df = df.drop_duplicates("timestamp").sort_values("timestamp")
    df.index = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    return df.astype({c: float for c in COLUMNS[1:]})


def fetch_recent(exchange, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    """Hae viimeisimmät kynttilät ja poista vielä kesken oleva kynttilä."""
    rows = exchange.fetch_ohlcv(symbol, timeframe, limit=limit + 1)
    df = to_frame(rows)
    now_ms = exchange.milliseconds()
    if len(df) and df["timestamp"].iloc[-1] + timeframe_ms(timeframe) > now_ms:
        df = df.iloc[:-1]
    return df


def fetch_history(exchange, symbol: str, timeframe: str, days: int) -> pd.DataFrame:
    """Hae pidempi historia sivuttain backtestiä varten."""
    tf = timeframe_ms(timeframe)
    since = exchange.milliseconds() - days * 86_400_000
    rows: list[list] = []
    while True:
        batch = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=1000)
        if not batch:
            break
        rows.extend(batch)
        since = batch[-1][0] + tf
        if len(batch) < 2 or since >= exchange.milliseconds():
            break
        time.sleep(exchange.rateLimit / 1000)
    df = to_frame(rows)
    # pudota keskeneräinen kynttilä
    if len(df) and df["timestamp"].iloc[-1] + tf > exchange.milliseconds():
        df = df.iloc[:-1]
    return df


def load_csv(path: str) -> pd.DataFrame:
    raw = pd.read_csv(path)
    missing = set(COLUMNS) - set(raw.columns)
    if missing:
        raise ValueError(f"CSV:stä puuttuu sarakkeet: {', '.join(sorted(missing))}")
    return to_frame(raw[COLUMNS].values.tolist())


def save_csv(df: pd.DataFrame, path: str) -> None:
    df[COLUMNS].to_csv(path, index=False)


def synthetic_ohlcv(bars: int = 3000, timeframe: str = "1h", seed: int = 42, start_price: float = 30_000.0) -> pd.DataFrame:
    """Satunnaisdataa (vaihtelevat nousu-/laskutrendit) offline-testaukseen. EI oikeaa markkinadataa."""
    rng = np.random.default_rng(seed)
    regime_len = 200
    drifts = rng.normal(0, 0.0015, size=bars // regime_len + 1).repeat(regime_len)[:bars]
    vol = 0.008
    rets = drifts + rng.normal(0, vol, size=bars)
    close = start_price * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[start_price], close[:-1]])
    wick = np.abs(rng.normal(0, vol / 2, size=(2, bars)))
    high = np.maximum(open_, close) * (1 + wick[0])
    low = np.minimum(open_, close) * (1 - wick[1])
    volume = rng.uniform(10, 100, size=bars)
    tf = timeframe_ms(timeframe)
    start = 1_700_000_000_000
    ts = start + np.arange(bars) * tf
    rows = np.column_stack([ts, open_, high, low, close, volume]).tolist()
    return to_frame(rows)
