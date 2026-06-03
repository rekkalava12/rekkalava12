# Terveyspäiväkirja 💊🏋️👟

Yksinkertainen sovellus, johon voit kirjata:

- **Lääkkeet** – aamu- ja iltalääkkeet, joita voit merkata otetuksi päiväkohtaisesti (+ muistutukset)
- **Treenit** – treenit liikkeineen, sarjoineen, painoineen ja toistoineen
- **Lenkit** – lenkit käsin kirjattuna **tai** tuotuna Sports Trackerin GPX-tiedostosta
- **Tilastot** – graafit: kilometrit viikoittain ja treeniliikkeen painokehitys

Sovellus on yksi selainsovellus (HTML/CSS/JS). Se toimii puhelimella ja
tietokoneella, myös offline-tilassa, ja kaikki tiedot tallentuvat omaan
laitteeseesi (selaimen localStorage). Mitään palvelinta tai kirjautumista ei
tarvita.

## Käyttöönotto

**Vaihtoehto A – avaa suoraan:**
Lataa kansio ja avaa `index.html` selaimessa.

**Vaihtoehto B – GitHub Pages (suositus puhelinkäyttöön):**
1. Repon asetukset → *Pages* → Build from branch → valitse haara ja `/ (root)`.
2. Avaa annettu osoite puhelimella ja valitse *Lisää aloitusnäyttöön*.
   Sovellus toimii tämän jälkeen kuin natiivisovellus, myös ilman verkkoa.

## Lääkkeet

- Avaa **Hallinnoi lääkkeitä** ja lisää lääkkeet (nimi, annos, ajankohta:
  aamu / ilta / molemmat).
- Päänäkymässä napauta lääkettä merkataksesi sen otetuksi valitulle päivälle.
- Vaihda yläreunan päivämäärää tarkastellaksesi tai täydentääksesi menneitä
  päiviä.

### Muistutukset 🔔

Avaa **Muistutukset**, laita kytkin päälle (selain kysyy luvan ilmoituksiin) ja
aseta aamu- ja iltamuistutuksen kellonajat. Sovellus huomauttaa vielä
ottamattomista lääkkeistä, kun avaat sovelluksen muistutusajan jälkeen.

**Muistutukset myös sovellus suljettuna (push-palvelin):**
Jos haluat muistutukset puhelimeen vaikka sovellus ei ole auki, ota käyttöön
kevyt push-palvelin (kansio [`server/`](server/README.md)). Julkaise se (esim.
ilmaiseksi Render.comissa) ja liitä sen osoite *Push-palvelimen osoite*
-kenttään. Paina *Lähetä testimuistutus* varmistaaksesi toimivuuden. Ohjeet:
[`server/README.md`](server/README.md).

Ilman push-palvelinta muistutukset toimivat parhaiten, kun sovellus on lisätty
puhelimen aloitusnäyttöön ja avaat sen muistutusaikoihin.

## Tilastot

- **Lenkit – km/viikko**: pylväsgraafi viimeisten 8 viikon kilometreistä.
- **Treenit – liikkeen kehitys**: valitse liike, niin näet sen suurimman
  painon kehityksen treeneittäin.

## Treenit

- **+ Uusi treeni** → anna päivä, nimi, lisää liikkeet ja jokaiselle sarjat
  (paino kg + toistot). Lisää muistiinpanot tarvittaessa.
- Napauta olemassa olevaa treeniä muokataksesi tai poistaaksesi sen.

## Lenkit

- **+ Uusi lenkki** käsin: matka, kesto, nousu, muistiinpanot. Vauhti
  lasketaan automaattisesti.
- **Tuo GPX**: valitse yksi tai useampi `.gpx`-tiedosto. Matka, kesto, nousu
  ja päivämäärä lasketaan reittipisteistä automaattisesti.
- Kuukauden yhteenveto (lenkkien määrä, kilometrit, keskivauhti) näkyy listan
  yläpuolella.

### Sports Tracker -tiedoista

Sports Trackerilla **ei ole virallista julkista rajapintaa**, joten lenkit
eivät voi siirtyä täysin automaattisesti reaaliajassa ilman erillistä
palvelinta ja kirjautumista. Käytännöllinen ja luotettava tapa on
**GPX-vienti**:

1. Avaa lenkki Sports Trackerissa (verkkopalvelu sports-tracker.com tai sovellus).
2. Valitse *Export / Vie* → **GPX**.
3. Tuo tiedosto tässä sovelluksessa **Lenkit → Tuo GPX**.

Voit tuoda useita tiedostoja kerralla. Jos haluat myöhemmin täysin
automaattisen synkronoinnin, se vaatii oman taustapalvelun – kerro, niin
voimme suunnitella sellaisen.

## Tietojen sijainti ja varmuuskopiointi

Tiedot ovat vain käyttämässäsi selaimessa/laitteessa. Selaimen tietojen
tyhjentäminen poistaa ne. Eri laitteiden välillä tiedot eivät synkronoidu
tässä versiossa.
