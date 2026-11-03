"""Koko botin silmukka valepörssiä vasten (ei verkkoa)."""
from bot.broker import BotState, PaperBroker
from bot.config import Config
from bot.data import synthetic_ohlcv, timeframe_ms
from bot.runner import TradingBot


class FakeExchange:
    def __init__(self, df):
        self.rows = df[["timestamp", "open", "high", "low", "close", "volume"]].values.tolist()
        self.i = 300

    def milliseconds(self):
        # "nyt" = kesken olevan kynttilän sisällä
        return int(self.rows[self.i][0] + timeframe_ms("1h") // 2)

    def fetch_ohlcv(self, symbol, timeframe, limit=100, since=None):
        return self.rows[max(0, self.i + 1 - limit): self.i + 1]

    def fetch_ticker(self, symbol):
        return {"last": self.rows[self.i][4]}


def test_paper_bot_trades_and_persists(tmp_path):
    cfg = Config()
    df = synthetic_ohlcv(2500, seed=7)
    ex = FakeExchange(df)
    path = tmp_path / "state.json"
    state = BotState.load(path, default_cash=1000)
    bot = TradingBot(cfg, ex, PaperBroker(state, cfg.risk), state, path)
    for i in range(300, 2499):
        ex.i = i
        bot.step()
        if state.position:
            assert state.base > 0
    assert len(state.trades) > 0
    assert path.exists()
    reloaded = BotState.load(path)
    assert reloaded.cash == state.cash and len(reloaded.trades) == len(state.trades)
    assert state.cash > 0
