"""Asetusten lataus TOML-tiedostosta."""
from __future__ import annotations

import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path


@dataclass
class MarketConfig:
    exchange: str = "binance"
    symbol: str = "BTC/USDT"
    timeframe: str = "1h"


@dataclass
class StrategyConfig:
    fast_ema: int = 12
    slow_ema: int = 26
    rsi_period: int = 14
    rsi_entry_max: float = 70.0
    rsi_exit: float = 80.0
    trend_ema: int = 200
    atr_period: int = 14


@dataclass
class RiskConfig:
    risk_per_trade: float = 0.01
    max_position_pct: float = 0.25
    stop_atr_mult: float = 2.0
    take_profit_rr: float = 3.0
    max_drawdown_pct: float = 0.20
    fee_pct: float = 0.001
    slippage_pct: float = 0.0005


@dataclass
class PaperConfig:
    starting_balance: float = 1000.0
    state_file: str = "paper_state.json"


@dataclass
class RunnerConfig:
    poll_seconds: int = 60
    history_bars: int = 300


@dataclass
class Config:
    market: MarketConfig = field(default_factory=MarketConfig)
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    paper: PaperConfig = field(default_factory=PaperConfig)
    runner: RunnerConfig = field(default_factory=RunnerConfig)

    def validate(self) -> None:
        s, r = self.strategy, self.risk
        if s.fast_ema >= s.slow_ema:
            raise ValueError("strategy.fast_ema pitää olla pienempi kuin slow_ema")
        if not 0 < r.risk_per_trade <= 0.05:
            raise ValueError("risk.risk_per_trade pitää olla välillä 0–0.05 (max 5 %)")
        if not 0 < r.max_position_pct <= 1:
            raise ValueError("risk.max_position_pct pitää olla välillä 0–1")
        if r.stop_atr_mult <= 0 or r.take_profit_rr <= 0:
            raise ValueError("stop_atr_mult ja take_profit_rr pitää olla > 0")
        if not 0 < r.max_drawdown_pct < 1:
            raise ValueError("risk.max_drawdown_pct pitää olla välillä 0–1")


def _build(cls, data: dict):
    known = {f.name for f in fields(cls)}
    unknown = set(data) - known
    if unknown:
        raise ValueError(f"Tuntemattomat asetukset [{cls.__name__}]: {', '.join(sorted(unknown))}")
    return cls(**data)


def load_config(path: str | Path | None = None) -> Config:
    """Lataa config.toml. Jos sitä ei ole, käytetään config.example.toml:ia."""
    base = Path(__file__).resolve().parent.parent
    candidates = [Path(path)] if path else [base / "config.toml", base / "config.example.toml"]
    for p in candidates:
        if p.exists():
            raw = tomllib.loads(p.read_text(encoding="utf-8"))
            cfg = Config(
                market=_build(MarketConfig, raw.get("market", {})),
                strategy=_build(StrategyConfig, raw.get("strategy", {})),
                risk=_build(RiskConfig, raw.get("risk", {})),
                paper=_build(PaperConfig, raw.get("paper", {})),
                runner=_build(RunnerConfig, raw.get("runner", {})),
            )
            cfg.validate()
            return cfg
    if path:
        raise FileNotFoundError(f"Asetustiedostoa ei löydy: {path}")
    cfg = Config()
    cfg.validate()
    return cfg
