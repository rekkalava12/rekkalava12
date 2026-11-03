"""Välittäjät: PaperBroker (simuloitu, ei oikeaa rahaa) ja LiveBroker (oikeat toimeksiannot ccxt:llä)."""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .config import RiskConfig

log = logging.getLogger("bot.broker")


@dataclass
class Position:
    amount: float
    entry_price: float
    stop: float
    take_profit: float
    opened_at: str


@dataclass
class BotState:
    """Botin pysyvä tila – tallennetaan JSON-tiedostoon, jotta uudelleenkäynnistys ei unohda positiota."""
    cash: float = 0.0               # vain paper-tilassa
    base: float = 0.0               # vain paper-tilassa
    position: Position | None = None
    peak_equity: float = 0.0
    last_candle_ts: int = 0
    halted: bool = False
    trades: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path, default_cash: float = 0.0) -> "BotState":
        if not path.exists():
            return cls(cash=default_cash, peak_equity=default_cash)
        raw = json.loads(path.read_text(encoding="utf-8"))
        pos = raw.pop("position", None)
        st = cls(**raw)
        st.position = Position(**pos) if pos else None
        return st

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2, default=str), encoding="utf-8")
        tmp.replace(path)


class PaperBroker:
    """Simuloi toimeksiannot oikeilla markkinahinnoilla, mutta ilman oikeaa rahaa."""

    live = False

    def __init__(self, state: BotState, risk: RiskConfig):
        self.state, self.risk = state, risk

    def balances(self, symbol: str) -> tuple[float, float]:
        return self.state.cash, self.state.base

    def buy(self, symbol: str, amount: float, ref_price: float) -> tuple[float, float]:
        price = ref_price * (1 + self.risk.slippage_pct)
        cost = amount * price
        fee = cost * self.risk.fee_pct
        if cost + fee > self.state.cash + 1e-9:
            raise RuntimeError("Paper: ei tarpeeksi käteistä")
        self.state.cash -= cost + fee
        self.state.base += amount
        return amount, price

    def sell(self, symbol: str, amount: float, ref_price: float) -> tuple[float, float]:
        amount = min(amount, self.state.base)
        price = ref_price * (1 - self.risk.slippage_pct)
        proceeds = amount * price
        self.state.cash += proceeds - proceeds * self.risk.fee_pct
        self.state.base -= amount
        return amount, price


class LiveBroker:
    """OIKEAT toimeksiannot pörssiin. Käytä vain jos ymmärrät riskit."""

    live = True

    def __init__(self, exchange, symbol: str):
        self.ex = exchange
        self.ex.load_markets()
        if symbol not in self.ex.markets:
            raise ValueError(f"Pörssissä ei ole markkinaa {symbol}")
        self.market = self.ex.markets[symbol]

    def balances(self, symbol: str) -> tuple[float, float]:
        bal = self.ex.fetch_balance()
        quote, base = self.market["quote"], self.market["base"]
        return float(bal.get(quote, {}).get("free") or 0), float(bal.get(base, {}).get("free") or 0)

    def _check_limits(self, amount: float, price: float) -> float:
        amount = float(self.ex.amount_to_precision(self.market["symbol"], amount))
        limits = self.market.get("limits", {})
        min_amt = (limits.get("amount") or {}).get("min") or 0
        min_cost = (limits.get("cost") or {}).get("min") or 0
        if amount <= 0 or amount < min_amt or amount * price < min_cost:
            raise RuntimeError(
                f"Toimeksianto liian pieni pörssille (määrä {amount}, min {min_amt}; arvo {amount * price:.2f}, min {min_cost})"
            )
        return amount

    def _fill(self, order: dict, fallback_amount: float, fallback_price: float) -> tuple[float, float]:
        try:
            order = self.ex.fetch_order(order["id"], self.market["symbol"])
        except Exception:  # kaikki pörssit eivät tue fetch_orderia heti
            pass
        filled = float(order.get("filled") or fallback_amount)
        avg = float(order.get("average") or order.get("price") or fallback_price)
        return filled, avg

    def buy(self, symbol: str, amount: float, ref_price: float) -> tuple[float, float]:
        amount = self._check_limits(amount, ref_price)
        log.warning("LIVE OSTO %s %s @ ~%s", amount, symbol, ref_price)
        order = self.ex.create_market_buy_order(symbol, amount)
        return self._fill(order, amount, ref_price)

    def sell(self, symbol: str, amount: float, ref_price: float) -> tuple[float, float]:
        _, free_base = self.balances(symbol)
        amount = self._check_limits(min(amount, free_base), ref_price)
        log.warning("LIVE MYYNTI %s %s @ ~%s", amount, symbol, ref_price)
        order = self.ex.create_market_sell_order(symbol, amount)
        return self._fill(order, amount, ref_price)
