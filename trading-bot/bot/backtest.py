"""Backtest-moottori.

Säännöt (ei "tulevaisuuteen kurkistamista"):
  * Signaali lasketaan kynttilän sulkeutuessa, toimeksianto toteutetaan SEURAAVAN kynttilän avauksessa.
  * Stop-loss ja take-profit tarkistetaan kynttilän sisäisellä high/low-arvolla.
    Jos molemmat osuvat samaan kynttilään, oletetaan konservatiivisesti stop-loss.
  * Kaupankäyntikulut ja lipsahdus huomioidaan joka kaupassa.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import Config
from .data import timeframe_ms
from .risk import DrawdownGuard, plan_trade
from .strategy import generate_signals


@dataclass
class Trade:
    entry_time: pd.Timestamp
    entry_price: float
    amount: float
    stop: float
    take_profit: float
    entry_fee: float
    exit_time: pd.Timestamp | None = None
    exit_price: float | None = None
    exit_fee: float = 0.0
    reason: str = ""

    @property
    def pnl(self) -> float:
        if self.exit_price is None:
            return 0.0
        return (self.exit_price - self.entry_price) * self.amount - self.entry_fee - self.exit_fee

    @property
    def pnl_pct(self) -> float:
        return self.pnl / (self.entry_price * self.amount) * 100


@dataclass
class BacktestResult:
    trades: list[Trade]
    equity: pd.Series
    starting_balance: float
    buy_hold_return_pct: float
    timeframe: str
    stats: dict = field(default_factory=dict)

    def summary(self) -> str:
        s = self.stats
        lines = [
            "=" * 46,
            " BACKTEST-TULOKSET",
            "=" * 46,
            f" Jakso:              {self.equity.index[0]:%Y-%m-%d} – {self.equity.index[-1]:%Y-%m-%d}",
            f" Aloituspääoma:      {self.starting_balance:,.2f}",
            f" Loppupääoma:        {s['final_equity']:,.2f}",
            f" Tuotto:             {s['total_return_pct']:+.2f} %",
            f" Osta & pidä:        {self.buy_hold_return_pct:+.2f} %",
            f" Max drawdown:       {s['max_drawdown_pct']:.2f} %",
            f" Sharpe (vuositas.): {s['sharpe']:.2f}",
            f" Kauppoja:           {s['n_trades']}",
            f" Voittoprosentti:    {s['win_rate_pct']:.1f} %",
            f" Profit factor:      {s['profit_factor']:.2f}",
            f" Keskim. kauppa:     {s['avg_trade_pct']:+.2f} %",
            f" Kulut yhteensä:     {s['total_fees']:,.2f}",
            "=" * 46,
        ]
        return "\n".join(lines)

    def trades_frame(self) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "entry_time": t.entry_time, "exit_time": t.exit_time,
                    "entry_price": round(t.entry_price, 8), "exit_price": round(t.exit_price or 0, 8),
                    "amount": t.amount, "stop": t.stop, "take_profit": t.take_profit,
                    "pnl": round(t.pnl, 4), "pnl_pct": round(t.pnl_pct, 3), "reason": t.reason,
                }
                for t in self.trades
            ]
        )


def run_backtest(df: pd.DataFrame, cfg: Config, starting_balance: float | None = None) -> BacktestResult:
    if len(df) < 3:
        raise ValueError("Liian vähän dataa backtestiin")
    r = cfg.risk
    balance0 = starting_balance if starting_balance is not None else cfg.paper.starting_balance
    sig = generate_signals(df, cfg.strategy)

    opens, highs, lows, closes = (sig[c].to_numpy() for c in ("open", "high", "low", "close"))
    signals, atrs = sig["signal"].to_numpy(), sig["atr"].to_numpy()
    times = sig.index

    cash, pos = balance0, None
    trades: list[Trade] = []
    equity = np.empty(len(sig))
    guard = DrawdownGuard(r.max_drawdown_pct, peak=balance0)
    halted = False

    def close_position(i: int, raw_price: float, reason: str) -> None:
        nonlocal cash, pos
        price = raw_price * (1 - r.slippage_pct)
        proceeds = pos.amount * price
        fee = proceeds * r.fee_pct
        cash += proceeds - fee
        pos.exit_time, pos.exit_price, pos.exit_fee, pos.reason = times[i], price, fee, reason
        trades.append(pos)
        pos = None

    equity[0] = cash
    for i in range(1, len(sig)):
        prev_signal = signals[i - 1]

        # 1) Edellisen kynttilän signaali toteutetaan tämän kynttilän avauksessa
        if pos is not None and prev_signal == -1:
            close_position(i, opens[i], "signal")
        elif pos is None and prev_signal == 1 and not halted:
            entry = opens[i] * (1 + r.slippage_pct)
            plan = plan_trade(equity[i - 1], cash, entry, atrs[i - 1], r)
            if plan is not None:
                fee = plan.cost * r.fee_pct
                cash -= plan.cost + fee
                pos = Trade(times[i], entry, plan.amount, plan.stop, plan.take_profit, fee)

        # 2) Stop-loss / take-profit kynttilän aikana
        if pos is not None:
            if opens[i] <= pos.stop:
                close_position(i, opens[i], "stop_gap")
            elif lows[i] <= pos.stop:
                close_position(i, pos.stop, "stop")
            elif opens[i] >= pos.take_profit:
                close_position(i, opens[i], "take_profit")
            elif highs[i] >= pos.take_profit:
                close_position(i, pos.take_profit, "take_profit")

        equity[i] = cash + (pos.amount * closes[i] if pos else 0.0)
        if not guard.update(equity[i]):
            halted = True
            if pos is not None:
                close_position(i, closes[i], "drawdown_halt")
                equity[i] = cash

    if pos is not None:
        close_position(len(sig) - 1, closes[-1], "end_of_data")
        equity[-1] = cash

    eq = pd.Series(equity, index=times, name="equity")
    bh = (closes[-1] / opens[1] - 1) * 100
    result = BacktestResult(trades, eq, balance0, bh, cfg.market.timeframe)
    result.stats = compute_stats(result)
    result.stats["halted"] = halted
    return result


def compute_stats(res: BacktestResult) -> dict:
    eq = res.equity
    pnls = np.array([t.pnl for t in res.trades])
    wins, losses = pnls[pnls > 0], pnls[pnls <= 0]
    dd = (eq.cummax() - eq) / eq.cummax()
    rets = eq.pct_change().dropna()
    bars_per_year = 365 * 86_400_000 / timeframe_ms(res.timeframe)
    sharpe = float(rets.mean() / rets.std() * math.sqrt(bars_per_year)) if rets.std() > 0 else 0.0
    gross_loss = -losses.sum()
    return {
        "final_equity": float(eq.iloc[-1]),
        "total_return_pct": float((eq.iloc[-1] / res.starting_balance - 1) * 100),
        "max_drawdown_pct": float(dd.max() * 100),
        "sharpe": sharpe,
        "n_trades": len(pnls),
        "win_rate_pct": float(len(wins) / len(pnls) * 100) if len(pnls) else 0.0,
        "profit_factor": float(wins.sum() / gross_loss) if gross_loss > 0 else float("inf") if len(wins) else 0.0,
        "avg_trade_pct": float(np.mean([t.pnl_pct for t in res.trades])) if res.trades else 0.0,
        "total_fees": float(sum(t.entry_fee + t.exit_fee for t in res.trades)),
    }
