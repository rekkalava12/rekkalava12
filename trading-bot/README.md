# Krypto-trading bot 🤖📈

Python-botti, joka käy automaattisesti kauppaa kryptovaluutoilla (esim. BTC/USDT)
lähes missä tahansa pörssissä [ccxt](https://github.com/ccxt/ccxt)-kirjaston kautta
(Binance, Kraken, Coinbase, Bybit, KuCoin ...).

> ⚠️ **Varoitus:** Kryptovaluutat ovat erittäin volatiileja. Mikään strategia ei takaa voittoa,
> ja hyvä backtest-tulos ei tarkoita voittoa tulevaisuudessa. Käytä vain rahaa, jonka sinulla on varaa
> menettää. Testaa aina ensin `backtest`- ja `paper`-tilassa.

## Ominaisuudet

| | |
|---|---|
| **Strategia** | EMA-risteys (12/26) + RSI-suodatin + 200-EMA trendisuodatin |
| **Riskienhallinta** | Position koko mitoitetaan niin, että stop-lossiin osuessa menetetään max 1 % pääomasta |
| **Stop-loss / take-profit** | ATR-pohjainen stop (2×ATR) ja take-profit 3× riskin suuruinen |
| **Drawdown-katkaisin** | Botti pysäyttää kaupankäynnin, jos pääoma laskee 20 % huipusta |
| **Backtest** | Kulut, lipsahdus, ei tulevaisuuteen kurkistamista (toimeksianto seuraavan kynttilän avauksessa) |
| **Paper trading** | Oikeat markkinahinnat, simuloitu raha |
| **Live trading** | Oikeat markkinatoimeksiannot, API-avaimet ympäristömuuttujista, vahvistuskysely |
| **Pysyvä tila** | Avoin positio ja kaupat tallennetaan JSONiin – uudelleenkäynnistys ei unohda niitä |

## Asennus

```bash
cd trading-bot
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp config.example.toml config.toml
```

Muokkaa `config.toml`-tiedostosta pörssi, kauppapari, aikaväli ja riskiasetukset.

## Käyttö

### 1. Backtest – miten strategia olisi pärjännyt?

```bash
python main.py backtest --days 365                    # hakee vuoden datan pörssistä
python main.py backtest --days 365 --save-trades kaupat.csv
python main.py download --days 730 --out btc.csv      # lataa data kerran ...
python main.py backtest --csv btc.csv                 # ... ja testaa monta kertaa nopeasti
python main.py backtest --synthetic                   # offline-testi satunnaisdatalla
```

Vertaa tulosta riviin **"Osta & pidä"** – jos botti ei voita pelkkää ostamista ja pitämistä,
strategiaa kannattaa säätää.

### 2. Paper trading – oikeat hinnat, ei oikeaa rahaa

```bash
python main.py paper            # pyörii kunnes painat Ctrl+C
python main.py status           # saldo, avoin positio ja kauppahistoria
```

Loki tallentuu tiedostoon `paper.log` ja tila tiedostoon `paper_state.json`.
Aloita alusta poistamalla `paper_state.json`. Anna botin pyöriä vähintään muutama viikko.

### 3. Live trading – oikea raha

1. Luo pörssissä API-avain **vain kaupankäyntioikeuksilla – ÄLÄ KOSKAAN anna nosto-oikeutta (withdraw)**.
   Rajaa avain mielellään omaan IP-osoitteeseesi.
2. Aseta avaimet ympäristömuuttujiin (ei koskaan tiedostoihin tai gitiin):
   ```bash
   export BOT_API_KEY="..."
   export BOT_API_SECRET="..."
   export BOT_API_PASSWORD="..."   # vain jos pörssi vaatii (esim. KuCoin)
   ```
3. Testaa ensin pörssin testnetissä, jos se on tuettu (esim. Binance, Bybit):
   ```bash
   python main.py live --sandbox
   ```
4. Kun olet varma: `python main.py live` ja kirjoita `KYLLÄ`.

Tärkeää live-tilassa:
- Botti hallitsee **vain itse avaamiaan positioita**; tilillä jo olevaan kryptoon se ei koske.
- Stop-loss on botin sisäinen (tarkistetaan `poll_seconds` välein), joten botin täytyy olla käynnissä.
  Aja se esim. palvelimella `tmux`/`screen`/systemd:llä.
- Kaupan minimikoko riippuu pörssistä (usein ~5–10 USDT). Pienellä pääomalla riski-% voi johtaa liian pieniin kauppoihin.

## Asetukset (`config.toml`)

| Asetus | Merkitys |
|---|---|
| `market.exchange` | ccxt-pörssin nimi, esim. `binance`, `kraken`, `bybit` |
| `market.symbol` | kauppapari, esim. `ETH/USDT` |
| `market.timeframe` | kynttilän pituus: `15m`, `1h`, `4h`, `1d` |
| `strategy.fast_ema` / `slow_ema` | nopean ja hitaan EMA:n pituus |
| `strategy.rsi_entry_max` | ei ostoa jos RSI yli tämän |
| `strategy.rsi_exit` | myy jos RSI nousee yli tämän |
| `strategy.trend_ema` | osta vain kun hinta on tämän EMA:n yläpuolella (`0` = pois) |
| `risk.risk_per_trade` | max tappio per kauppa osuutena pääomasta |
| `risk.max_position_pct` | position max koko osuutena pääomasta |
| `risk.stop_atr_mult` | stop-loss-etäisyys ATR:n monikertana |
| `risk.take_profit_rr` | take-profit riskin monikertana |
| `risk.max_drawdown_pct` | pysäytysraja |

## Rakenne

```
trading-bot/
├── main.py              komentorivikäyttöliittymä
├── config.example.toml  esimerkkiasetukset
├── bot/
│   ├── config.py        asetusten lataus ja validointi
│   ├── indicators.py    EMA, SMA, RSI, ATR
│   ├── strategy.py      signaalien laskenta
│   ├── risk.py          position koko, SL/TP, drawdown-katkaisin
│   ├── data.py          datan haku (ccxt / CSV / synteettinen)
│   ├── backtest.py      backtest-moottori ja tunnusluvut
│   ├── broker.py        PaperBroker, LiveBroker, tilan tallennus
│   └── runner.py        botin pääsilmukka
└── tests/               pytest-testit
```

## Testit

```bash
python -m pytest -q
```

## Oman strategian tekeminen

Muokkaa `bot/strategy.py`:n funktiota `generate_signals` – sen pitää palauttaa DataFrame, jossa on
sarake `signal` (`1` = osta, `-1` = myy, `0` = ei mitään) sekä `atr`. Backtest, paper ja live käyttävät
kaikki samaa funktiota, joten backtestattu logiikka on täsmälleen sama kuin livenä ajettava.
