import pytest

from bot.config import Config, RiskConfig, load_config
from bot.data import synthetic_ohlcv
from bot.risk import DrawdownGuard, plan_trade
from bot.strategy import generate_signals


def test_example_config_loads():
    cfg = load_config()
    assert cfg.market.symbol


def test_invalid_config_rejected():
    cfg = Config()
    cfg.strategy.fast_ema = 50
    with pytest.raises(ValueError):
        cfg.validate()


def test_signals_no_lookahead():
    """Signaalit eivät saa muuttua, kun dataan lisätään tulevia kynttilöitä."""
    cfg = Config().strategy
    df = synthetic_ohlcv(1500, seed=1)
    full = generate_signals(df, cfg)["signal"]
    part = generate_signals(df.iloc[:1000], cfg)["signal"]
    assert (full.iloc[:1000] == part).all()
    assert set(full.unique()) <= {-1, 0, 1}
    assert (full == 1).sum() > 0


def test_position_size_respects_risk():
    r = RiskConfig(risk_per_trade=0.01, max_position_pct=1.0, stop_atr_mult=2.0)
    plan = plan_trade(equity=10_000, cash=10_000, entry=100, atr_value=2, cfg=r)
    # stop-etäisyys 4 -> riski 100 -> 25 kpl
    assert plan.stop == pytest.approx(96)
    assert plan.amount == pytest.approx(25)
    assert (plan.entry - plan.stop) * plan.amount == pytest.approx(100)
    assert plan.take_profit == pytest.approx(100 + 3 * 4)


def test_position_capped_by_max_pct_and_cash():
    r = RiskConfig(risk_per_trade=0.05, max_position_pct=0.1)
    plan = plan_trade(10_000, 10_000, 100, 0.1, r)
    assert plan.cost <= 1000 + 1e-9
    plan = plan_trade(10_000, 50, 100, 0.1, r)
    assert plan.cost < 50
    assert plan_trade(10_000, 0, 100, 1, r) is None


def test_drawdown_guard():
    g = DrawdownGuard(0.2, peak=1000)
    assert g.update(1200)
    assert g.update(1000)
    assert not g.update(950)
