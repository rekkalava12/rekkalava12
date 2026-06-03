# Terveyspäiväkirja – push-palvelin 🔔

Kevyt Node.js-palvelin, joka lähettää lääkemuistutukset **Web Push** -ilmoituksina,
jolloin ne tulevat puhelimeen **myös silloin kun sovellus on suljettu**.

Palvelin tallentaa selainten push-tilaukset ja muistutusajat tiedostoon
(`data.json`) ja lähettää aamu-/iltamuistutuksen oikeaan aikaan käyttäjän
aikavyöhykkeen mukaan.

## Vaatimukset

- Node.js 18+
- **HTTPS-osoite** (Web Push vaatii sen; useimmat ilmaishostit antavat https:n valmiina)

## Paikallinen ajo

```bash
cd server
npm install
npm start
```

Ensimmäisellä käynnistyksellä palvelin tulostaa generoimansa VAPID-avaimet.
**Kopioi ne talteen** ja aseta ympäristömuuttujiksi, jotta tilaukset eivät katkea
uudelleenkäynnistyksessä (ks. alla). Avaimet voi luoda myös erikseen:

```bash
npm run genkeys
```

## Ympäristömuuttujat

| Muuttuja | Pakollinen | Selitys |
|----------|-----------|---------|
| `VAPID_PUBLIC_KEY`  | suositeltu | Web Push -julkinen avain |
| `VAPID_PRIVATE_KEY` | suositeltu | Web Push -yksityinen avain |
| `VAPID_SUBJECT`     | ei | esim. `mailto:oma@email.fi` |
| `PORT`              | ei | portti (hostit asettavat tämän usein itse) |
| `TICK_SECRET`       | ei | jos asetat, `/api/tick` vaatii `?secret=...` |
| `DATA_FILE`         | ei | tilausten tallennuspolku (oletus `data.json`) |

## Julkaisu ilmaiseksi (esim. Render.com)

1. Työnnä tämä repo GitHubiin (on jo).
2. Render → **New → Web Service** → valitse repo.
3. Asetukset:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. **Environment** → lisää `VAPID_PUBLIC_KEY` ja `VAPID_PRIVATE_KEY`
   (luo ne komennolla `npm run genkeys` paikallisesti tai ota ensimmäisen
   käynnistyksen lokista).
5. Deploy. Saat osoitteen, esim. `https://terveys-push.onrender.com`.
6. **Sovelluksessa**: Lääkkeet → Muistutukset → liitä tämä osoite
   *Push-palvelimen osoite* -kenttään ja paina *Lähetä testimuistutus*.

### Ilmaishostien “nukkuminen”

Renderin ilmainen palvelu nukahtaa käyttämättömänä, jolloin sisäinen ajastin ei
pyöri. Varmista muistutukset herättämällä palvelin ulkoisella cronilla:

1. Mene **cron-job.org** (ilmainen).
2. Luo ajastettu kutsu joka **minuutti** (tai 5 min):
   `https://<oma-palvelin>/api/tick`
   (jos asetit `TICK_SECRET`-arvon: `.../api/tick?secret=SALAISUUS`)

Tämä sekä herättää palvelimen että laukaisee muistutusten tarkistuksen.

> Jos käytät aina päällä olevaa hostia (esim. Fly.io / VPS), pelkkä sisäinen
> ajastin riittää eikä cronia tarvita.

## Rajapinta (lyhyesti)

| Metodi & polku | Selitys |
|----------------|---------|
| `GET /api/health` | tila + tilausten määrä |
| `GET /api/vapidPublicKey` | julkinen VAPID-avain |
| `POST /api/subscribe` | `{ subscription, settings }` – tallenna tilaus |
| `POST /api/unsubscribe` | `{ endpoint }` – poista tilaus |
| `POST /api/test` | `{ endpoint }` – lähetä testimuistutus |
| `POST /api/tick` | tarkista ja lähetä ajankohtaiset muistutukset |

## Tietosuoja

Palvelin tallentaa vain push-tilauksen (selaimen anonyymi push-osoite),
muistutusajat, aikavyöhykkeen ja lääkkeiden **nimet** (muistutuksen tekstiä
varten). Se ei tiedä, onko lääke otettu – sen tieto pysyy laitteellasi.
