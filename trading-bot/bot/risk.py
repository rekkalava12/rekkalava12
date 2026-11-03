"""Riskienhallinta: position koko, stop-loss, take-profit ja drawdown-katkaisin."""
from __future__ import annotations

from dataclasses import dataclass

from .config import RiskConfig


@dataclass
class TradePlan:
    amount: float       # ostettava määrä base-valuuttana (esim. BTC)
    entry: float
    stop: float
    take_profit: float

    @property
    def cost(self) -> float:
        return self.amount * self.entry


def plan_trade(equity: float, cash: float, entry: float, atr_value: float, cfg: RiskConfig) -> TradePlan | None:
    """Laske position koko niin, että stop-lossiin osuessa menetetään max risk_per_trade pääomasta."""
    if entry <= 0 or atr_value <= 0 or equity <= 0 or cash <= 0:
        return None
    stop_distance = cfg.stop_atr_mult * atr_value
    stop = entry - stop_distance
    if stop <= 0:
        return None
    risk_amount = equity * cfg.risk_per_trade
    amount = risk_amount / stop_distance
    # Rajoitukset: max-positiokoko ja käytettävissä oleva käteinen (kulut huomioiden)
    max_by_pct = equity * cfg.max_position_pct / entry
    max_by_cash = cash / (entry * (1 + cfg.fee_pct + cfg.slippage_pct))
    amount = min(amount, max_by_pct, max_by_cash)
    if amount <= 0:
        return None
    take_profit = entry + cfg.take_profit_rr * stop_distance
    return TradePlan(amount=amount, entry=entry, stop=stop, take_profit=take_profit)


class DrawdownGuard:
    """Pysäyttää uudet kaupat, jos pääoma putoaa liikaa huipusta."""

    def __init__(self, max_drawdown_pct: float, peak: float = 0.0):
        self.max_drawdown_pct = max_drawdown_pct
        self.peak = peak

    def update(self, equity: float) -> bool:
        """Palauttaa True, jos kaupankäynti saa jatkua."""
        self.peak = max(self.peak, equity)
        if self.peak <= 0:
            return False
        return (self.peak - equity) / self.peak < self.max_drawdown_pct
