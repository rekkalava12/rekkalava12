from bot.backtest import run_backtest
from bot.config import Config
from bot.data import synthetic_ohlcv


def test_backtest_runs_and_is_consistent():
    cfg = Config()
    res = run_backtest(synthetic_ohlcv(3000, seed=3), cfg, 1000)
    assert len(res.equity) == 3000
    assert res.stats["n_trades"] == len(res.trades)
    # Loppupääoma = alku + kauppojen tulokset (kulut mukana)
    assert abs(res.stats["final_equity"] - (1000 + sum(t.pnl for t in res.trades))) < 1e-6
    for t in res.trades:
        assert t.exit_time >= t.entry_time
        assert t.stop < t.entry_price < t.take_profit


def test_single_trade_loss_limited_by_risk():
    cfg = Config()
    res = run_backtest(synthetic_ohlcv(3000, seed=5), cfg, 1000)
    for t in res.trades:
        if t.reason == "stop":
            # menetys n. 1 % pääomasta + kulut/lipsahdus
            assert t.pnl > -1000 * 0.03
