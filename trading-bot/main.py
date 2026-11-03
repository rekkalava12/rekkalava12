#!/usr/bin/env python3
"""Krypto-trading bot – komentorivikäyttöliittymä.

Esimerkit:
  python main.py backtest --synthetic            # testaa offline-satunnaisdatalla
  python main.py backtest --days 365             # testaa oikealla historiadatalla
  python main.py download --days 365 --out btc.csv
  python main.py backtest --csv btc.csv
  python main.py paper                           # simuloitu kaupankäynti oikeilla hinnoilla
  python main.py status                          # näytä paper-tilan saldo ja kaupat
  python main.py live                            # OIKEA RAHA – lue README ensin!
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from bot.backtest import run_backtest
from bot.broker import BotState, LiveBroker, PaperBroker
from bot.config import load_config
from bot.data import fetch_history, load_csv, make_exchange, save_csv, synthetic_ohlcv

HERE = Path(__file__).resolve().parent


def setup_logging(logfile: str | None = None, verbose: bool = False) -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    if logfile:
        handlers.append(logging.FileHandler(HERE / logfile, encoding="utf-8"))
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )


def cmd_backtest(args, cfg) -> None:
    if args.synthetic:
        print("HUOM: synteettinen satunnaisdata – tulokset eivät kerro mitään oikeista markkinoista.\n")
        df = synthetic_ohlcv(bars=args.bars, timeframe=cfg.market.timeframe, seed=args.seed)
    elif args.csv:
        df = load_csv(args.csv)
    else:
        ex = make_exchange(cfg.market.exchange)
        print(f"Haetaan {args.days} päivän data: {cfg.market.symbol} {cfg.market.timeframe} @ {cfg.market.exchange} ...")
        df = fetch_history(ex, cfg.market.symbol, cfg.market.timeframe, args.days)
    print(f"Kynttilöitä: {len(df)}")
    res = run_backtest(df, cfg, args.balance)
    print(res.summary())
    if res.stats.get("halted"):
        print(" ! Drawdown-katkaisin laukesi backtestin aikana.")
    if args.save_trades:
        res.trades_frame().to_csv(args.save_trades, index=False)
        print(f"Kaupat tallennettu: {args.save_trades}")
    elif res.trades:
        print("\nViimeiset kaupat:")
        print(res.trades_frame().tail(10).to_string(index=False))


def cmd_download(args, cfg) -> None:
    ex = make_exchange(cfg.market.exchange)
    df = fetch_history(ex, cfg.market.symbol, cfg.market.timeframe, args.days)
    save_csv(df, args.out)
    print(f"Tallennettu {len(df)} kynttilää tiedostoon {args.out}")


def cmd_paper(args, cfg) -> None:
    from bot.runner import TradingBot

    setup_logging("paper.log", args.verbose)
    state_path = HERE / cfg.paper.state_file
    state = BotState.load(state_path, default_cash=cfg.paper.starting_balance)
    ex = make_exchange(cfg.market.exchange)
    bot = TradingBot(cfg, ex, PaperBroker(state, cfg.risk), state, state_path)
    try:
        bot.run_forever() if not args.once else bot.step()
    except KeyboardInterrupt:
        state.save(state_path)
        print("\nPysäytetty. Tila tallennettu:", state_path)


def cmd_live(args, cfg) -> None:
    from bot.runner import TradingBot

    print("=" * 60)
    print(" VAROITUS: LIVE-TILA KÄYTTÄÄ OIKEAA RAHAA")
    print(f" Pörssi: {cfg.market.exchange}  Pari: {cfg.market.symbol}  Aikaväli: {cfg.market.timeframe}")
    print(f" Riski/kauppa: {cfg.risk.risk_per_trade:.1%}  Max positio: {cfg.risk.max_position_pct:.0%}")
    print(" Voit menettää koko sijoittamasi summan. Testaa ensin paper-tilassa.")
    print("=" * 60)
    if not args.yes:
        if input('Kirjoita "KYLLÄ" jatkaaksesi: ').strip() != "KYLLÄ":
            print("Peruttu.")
            return
    setup_logging("live.log", args.verbose)
    state_path = HERE / "live_state.json"
    state = BotState.load(state_path)
    ex = make_exchange(cfg.market.exchange, authenticated=True)
    if args.sandbox:
        ex.set_sandbox_mode(True)
        logging.getLogger().info("Pörssin sandbox/testnet-tila päällä")
    bot = TradingBot(cfg, ex, LiveBroker(ex, cfg.market.symbol), state, state_path)
    try:
        bot.run_forever()
    except KeyboardInterrupt:
        state.save(state_path)
        print("\nPysäytetty. HUOM: avoin positio jää pörssiin, botti jatkaa sen hallintaa seuraavalla käynnistyksellä.")


def cmd_status(args, cfg) -> None:
    for label, path in (("PAPER", HERE / cfg.paper.state_file), ("LIVE", HERE / "live_state.json")):
        if not path.exists():
            continue
        st = BotState.load(path)
        print(f"--- {label} ({path.name}) ---")
        if label == "PAPER":
            print(f"Käteinen: {st.cash:.2f}  Base: {st.base:.6f}")
        print(f"Huippupääoma: {st.peak_equity:.2f}  Pysäytetty: {'kyllä' if st.halted else 'ei'}")
        if st.position:
            p = st.position
            print(f"Positio: {p.amount:.6f} @ {p.entry_price:.4f}  SL {p.stop:.4f}  TP {p.take_profit:.4f}")
        print(f"Suljettuja kauppoja: {len(st.trades)}")
        for t in st.trades[-10:]:
            print(f"  {t['closed_at'][:16]}  {t['entry']:.4f} -> {t['exit']:.4f}  {t['pnl_before_fees']:+.2f}  ({t['reason']})")


def main() -> None:
    p = argparse.ArgumentParser(description="Kryptovaluuttojen trading bot")
    p.add_argument("--config", help="asetustiedosto (oletus config.toml tai config.example.toml)")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("backtest", help="testaa strategiaa historiadatalla")
    src = b.add_mutually_exclusive_group()
    src.add_argument("--days", type=int, default=365, help="montako päivää historiaa haetaan pörssistä")
    src.add_argument("--csv", help="lue data CSV-tiedostosta")
    src.add_argument("--synthetic", action="store_true", help="käytä satunnaisdataa (offline-testi)")
    b.add_argument("--bars", type=int, default=5000, help="synteettisen datan pituus")
    b.add_argument("--seed", type=int, default=42)
    b.add_argument("--balance", type=float, help="aloituspääoma (oletus asetuksista)")
    b.add_argument("--save-trades", help="tallenna kaupat CSV-tiedostoon")

    d = sub.add_parser("download", help="lataa historiadata CSV:ksi")
    d.add_argument("--days", type=int, default=365)
    d.add_argument("--out", required=True)

    pp = sub.add_parser("paper", help="simuloitu kaupankäynti oikeilla hinnoilla")
    pp.add_argument("--once", action="store_true", help="aja vain yksi kierros")

    lv = sub.add_parser("live", help="OIKEA kaupankäynti (vaatii API-avaimet)")
    lv.add_argument("--yes", action="store_true", help="ohita vahvistuskysymys")
    lv.add_argument("--sandbox", action="store_true", help="käytä pörssin testnetiä, jos tuettu")

    sub.add_parser("status", help="näytä botin tila")

    args = p.parse_args()
    cfg = load_config(args.config)
    {"backtest": cmd_backtest, "download": cmd_download, "paper": cmd_paper,
     "live": cmd_live, "status": cmd_status}[args.cmd](args, cfg)


if __name__ == "__main__":
    main()
