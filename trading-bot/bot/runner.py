"""Botin pääsilmukka paper- ja live-kaupankäyntiin."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from pathlib import Path

from .broker import BotState, Position
from .config import Config
from .data import fetch_recent
from .risk import DrawdownGuard, plan_trade
from .strategy import generate_signals, min_bars_needed

log = logging.getLogger("bot.runner")


class TradingBot:
    def __init__(self, cfg: Config, exchange, broker, state: BotState, state_path: Path):
        self.cfg, self.ex, self.broker = cfg, exchange, broker
        self.state, self.state_path = state, state_path
        self.symbol = cfg.market.symbol
        self.guard = DrawdownGuard(cfg.risk.max_drawdown_pct, peak=state.peak_equity)
        needed = min_bars_needed(cfg.strategy)
        if cfg.runner.history_bars < needed:
            raise ValueError(f"runner.history_bars pitää olla vähintään {needed}")

    # ------------------------------------------------------------------
    def step(self) -> None:
        """Yksi kierros: hae data, tarkista stopit, toimi uusien signaalien mukaan."""
        st, r = self.state, self.cfg.risk
        price = float(self.ex.fetch_ticker(self.symbol)["last"])
        cash, base = self.broker.balances(self.symbol)
        pos_value = st.position.amount * price if st.position else 0.0
        equity = cash + pos_value

        # 1) Stop-loss / take-profit tarkistetaan joka kierroksella
        if st.position:
            if price <= st.position.stop:
                self._exit(price, "stop")
            elif price >= st.position.take_profit:
                self._exit(price, "take_profit")

        # 2) Drawdown-katkaisin
        if not st.halted and not self.guard.update(equity):
            st.halted = True
            log.error("MAX DRAWDOWN SAAVUTETTU (huippu %.2f, nyt %.2f). Uudet kaupat pysäytetty.", self.guard.peak, equity)
            if st.position:
                self._exit(price, "drawdown_halt")
        st.peak_equity = self.guard.peak

        # 3) Uusi suljettu kynttilä -> laske signaali
        df = fetch_recent(self.ex, self.symbol, self.cfg.market.timeframe, self.cfg.runner.history_bars)
        if len(df) >= min_bars_needed(self.cfg.strategy):
            last = generate_signals(df, self.cfg.strategy).iloc[-1]
            ts = int(last["timestamp"])
            if ts > st.last_candle_ts:
                st.last_candle_ts = ts
                signal = int(last["signal"])
                log.info(
                    "Kynttilä %s suljettu: close=%.4f RSI=%.1f EMAf=%.4f EMAs=%.4f signaali=%+d",
                    datetime.fromtimestamp(ts / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M"),
                    last["close"], last["rsi"], last["ema_fast"], last["ema_slow"], signal,
                )
                if signal == -1 and st.position:
                    self._exit(price, "signal")
                elif signal == 1 and not st.position and not st.halted:
                    cash, _ = self.broker.balances(self.symbol)
                    plan = plan_trade(equity, cash, price, float(last["atr"]), r)
                    if plan:
                        self._enter(plan)
                    else:
                        log.info("Ostosignaali, mutta positiota ei voitu mitoittaa (käteinen/ATR)")
        else:
            log.warning("Liian vähän kynttilöitä (%d) indikaattoreille", len(df))

        cash, base = self.broker.balances(self.symbol)
        equity = cash + (st.position.amount * price if st.position else 0.0)
        log.info(
            "Hinta %.4f | pääoma %.2f | %s",
            price, equity,
            f"positio {st.position.amount:.6f} @ {st.position.entry_price:.4f} (SL {st.position.stop:.4f}, TP {st.position.take_profit:.4f})"
            if st.position else "ei positiota",
        )
        st.save(self.state_path)

    # ------------------------------------------------------------------
    def _enter(self, plan) -> None:
        try:
            filled, avg = self.broker.buy(self.symbol, plan.amount, plan.entry)
        except Exception as e:
            log.error("Osto epäonnistui: %s", e)
            return
        # Säilytä alkuperäinen riskietäisyys toteutuneen hinnan ympärillä
        shift = avg - plan.entry
        self.state.position = Position(
            amount=filled, entry_price=avg, stop=plan.stop + shift, take_profit=plan.take_profit + shift,
            opened_at=datetime.now(timezone.utc).isoformat(),
        )
        log.info("OSTETTU %.6f @ %.4f | SL %.4f | TP %.4f", filled, avg, self.state.position.stop, self.state.position.take_profit)
        self.state.save(self.state_path)

    def _exit(self, price: float, reason: str) -> None:
        pos = self.state.position
        try:
            filled, avg = self.broker.sell(self.symbol, pos.amount, price)
        except Exception as e:
            log.error("Myynti epäonnistui (%s): %s", reason, e)
            return
        pnl = (avg - pos.entry_price) * filled
        self.state.trades.append({
            "opened_at": pos.opened_at, "closed_at": datetime.now(timezone.utc).isoformat(),
            "entry": pos.entry_price, "exit": avg, "amount": filled,
            "pnl_before_fees": round(pnl, 4), "reason": reason,
        })
        self.state.position = None
        log.info("MYYTY %.6f @ %.4f (%s) | tulos ennen kuluja %+.2f", filled, avg, reason, pnl)
        self.state.save(self.state_path)

    # ------------------------------------------------------------------
    def run_forever(self) -> None:
        mode = "LIVE" if self.broker.live else "PAPER"
        log.info("Botti käynnistyy [%s] %s %s @ %s", mode, self.symbol, self.cfg.market.timeframe, self.cfg.market.exchange)
        errors = 0
        while True:
            try:
                self.step()
                errors = 0
            except KeyboardInterrupt:
                raise
            except Exception as e:  # verkko-/pörssivirheet: odota ja yritä uudelleen
                errors += 1
                log.exception("Virhe kierroksella (%d peräkkäin): %s", errors, e)
                if errors >= 10:
                    log.error("Liian monta peräkkäistä virhettä – pysäytetään.")
                    raise
            time.sleep(self.cfg.runner.poll_seconds * min(errors + 1, 5))
