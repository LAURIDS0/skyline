# Skyline Tycoon

Et multiplayer-tycoonspil med flyselskaber, bygget på rigtige lufthavne og rigtige fly.

## Kør spillet

```
docker compose up --build
```

Kopiér `.env.example` til `.env` og indsæt din gratis CARTO-nøgle (kortet) – opret den på carto.com. Åbn http://localhost:8080. Første gang backend starter, henter den ca. 9.500 lufthavne fra OurAirports (tager 10-30 sek.).

Skift adgangskoderne til databasen i produktion: `DB_PASSWORD=... DB_ROOT_PASSWORD=... docker compose up`.

## Struktur

- `frontend/` – ren HTML/CSS/JS (Leaflet-kort), serveret af nginx, der også sender `/api` videre til backend
- `backend/` – Node.js + Express + MariaDB. Spilregler og data ligger i `src/catalog.js`, økonomien i `src/economy.js`
- `backend/test/` – kør med `npm test` i `backend/`

## Open data/API'er

- **OurAirports** – alle lufthavne og banelængder (public domain)
- **OpenStreetMap + CARTO** – kortet
- **Open-Meteo** – live-vejr for hver lufthavn

## Sådan virker spillet

Uret går 1 spilminut pr. sekund (flyene flyver i realistisk tempo), mens pengene tæller 4 spiltimers resultat pr. sekund – justér `GAME_HOURS_PER_SEC` og `MONEY_HOURS_PER_SEC` i `backend/src/catalog.js`. Du starter med $8 mio. Køb en lufthavn, byg terminal og gates, køb et fly og giv det en rute.
Belægningen afhænger af lufthavnenes størrelse, afstanden, din billetpris og konkurrenternes kapacitet på samme rute.
Flyver du til en lufthavn, som en anden spiller ejer, betaler du landingsafgift til den spiller.

Krav og systemer: licenser (Regional → National → Kontinental → Interkontinental) låses op med erfaring + penge og styrer flytyper og rutelængde.
Jetfly kræver kontroltårn, brændstofdepot og brandstation; wide-body kræver hangar; fragtfly kræver fragtterminal og fragtstand.
Fly slides og grounded under 20% – eftersyn kræver hangar. Brændstofprisen svinger, live-vejr (frost/storm) skærer i banekapaciteten, og banken låner ud mod renter. Kassen må gå i minus, men ved overtræk over $250.000 pr. lufthavn går selskabet konkurs.

Se [HANDOVER.md](HANDOVER.md) for arkitektur, datamodel og kendte begrænsninger.

## Sprog

Spillet findes på dansk, engelsk, tysk, spansk, fransk og svensk. Dansk er kildesproget: den danske tekst er nøglen, og hver fil i `frontend/js/lang/` oversætter den.
Nyt sprog: kopiér `frontend/js/lang/en.js`, oversæt værdierne, og tilføj sproget i `LANGS` i både `frontend/js/i18n.js` og `backend/src/server.js`.
Tjek at alle tekster er oversat: `node scripts/check-i18n.mjs`.

## Lufthavnseditoren (3D)

1 felt = 10 m. Hovedbanen har den rigtige længde, og tilkørselsvejen ligger fast. Styring: WASD flyt, Q/E drej, scroll zoom, højreklik-træk for at se rundt, R roter, X nedriv, PageUp/PageDown skifter etage.
Alt har en funktion (se `backend/src/analysis.js`): gates og hangarer skal forbindes til banen med taxivej eller forplads, terminaler og parkering skal have vejadgang,
og egne bygninger virker kun, når de er lukkede (gulv + vægge + dør ud mod et fortov). Kapaciteten i en egen terminal er den laveste af gulvareal, check-in, sikkerhed, bagage, toiletter og siddepladser.
Øvre etager kræver trappe, rulletrappe eller elevator. Hangarpladser skal passe til antallet af fly (S = 1, M = 2, L = 4 pladser).
