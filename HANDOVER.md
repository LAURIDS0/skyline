# Handover – Skyline Tycoon

Status pr. 5. november 2026. Dette dokument er til den, der arbejder videre på projektet.

## Hvad det er

Et multiplayer-tycoonspil i browseren: man driver et flyselskab på rigtige lufthavne (OurAirports) med rigtige flytyper,
bygger sine lufthavne i 3D og konkurrerer med andre spillere på ruter, lufthavne og rangliste.

## Kom i gang

```
cp .env.example .env        # indsæt en gratis CARTO-nøgle (carto.com) – kortet viser en fejl-flise uden
docker compose up --build   # http://localhost:8080
```

- Første opstart henter ~9.500 lufthavne fra OurAirports og lægger dem i MariaDB (10–30 sek.).
- Tests: `cd backend && npm install && npm test` (16 tests, Node's indbyggede testrunner).
- Oversættelser: `node scripts/check-i18n.mjs` skal give 0 manglende nøgler i alle sprog.
- Database-adgangskoder: sæt `DB_PASSWORD` og `DB_ROOT_PASSWORD` i `.env` før drift.

## Arkitektur

```
frontend/  (nginx, ren HTML/CSS/JS, ingen build-step)        backend/  (Node 22 + Express 5)        MariaDB 11
  index.html      skal + importmap (Three.js, Leaflet fra CDN)   src/server.js    alle /api-endpoints
  js/app.js       hovedapp: login, paneler, kort, Min side       src/catalog.js   spilregler + data (fly, bygninger, licenser)
  js/map.js       Leaflet-kort, ruter, fly-animation             src/economy.js   økonomimodel (ren funktion, testet)
  js/builder3d.js 3D-lufthavnseditor                              src/layout.js    pladsplan: felter, lag, kanter, migreringer
  js/models3d.js  procedurale 3D-modeller                         src/analysis.js  hvad virker: forbindelser, lukkede bygninger
  js/i18n.js      sprog (dansk tekst = nøgle)                     src/db.js        skema, import, layout-migreringer
  js/lang/*.js    en, de, es, fr, sv                              src/weather.js   Open-Meteo-cache (30 min)
  nginx.conf      sender /api videre til backend                  test/            node:test
```

Frontend og backend deler regler ved at backend sender `catalog.js` ud via `GET /api/catalog`.
Placeringsreglerne i `builder3d.js` er en kopi af `layout.js` til øjeblikkelig feedback – serveren validerer altid selv.

## Spilmodellen (vigtigste regler)

- **Tid:** 1 sek. = 1 spilminut (ur og fly). Penge krediteres med 4 spiltimers resultat pr. sekund (`MONEY_HOURS_PER_SEC`).
  Indtjening opgøres dovent i `settle()` ved hvert kald; offline-indtjening er loftet til 4 timer.
- **Efterspørgsel og pris:** hver rute har etablerede NPC-selskaber (`NPC_SHARE`). Passagerer fordeles efter kapacitet × appel,
  hvor appel = pris^−2 × lufthavnens kvalitet. Billig = flere passagerer, dyr = tomme sæder.
- **Omkostninger:** brændstof (svinger med tiden), vedligehold (stiger med slid), besætning, forsikring, landingsafgift
  (går til ejeren, hvis lufthavnen er en anden spillers), administration, drift af bygninger, renter og overtræksrente.
- **Konkurs:** kassen må gå i minus; ved overtræk > $250.000 × antal lufthavne (mindst 1) nulstilles selskabet (`bankrupt()` i server.js).
- **Licenser** styrer flytyper og rutelængde; **slid** grounder fly under 20 %; eftersyn kræver hangar.
- **Lufthavne (3D):** 1 felt = 10 m. Hovedbane (rigtig længde) og tilkørselsvej er faste. `analysis.js` afgør hvad der virker:
  - gates/stande/hangarer skal hænge sammen med banen via taxivej/forplads; terminaler/parkering skal have vejadgang;
  - egne bygninger skal være lukkede (gulv + vægge + dør mod fortov/vej); kapacitet = mindste led i kæden
    gulvareal → check-in → sikkerhed → bagage → toiletter → siddepladser;
  - øvre etager tæller kun via trappe/rulletrappe/elevator; hangarpladser skal dække flåden (S=1, M=2, L=4).

## Data

Tabeller: `airports`, `users`, `sessions` (sha256 af token), `owned_airports` (layout som JSON i MEDIUMTEXT + `layout_v`),
`aircraft`, `history` (kasse pr. minut, 24 t), `avatars` (billeder, kun PNG/JPEG/WebP tjekket på magic bytes).

Skemaet oprettes/udvides ved opstart i `db.js` (`CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) – der er ingen migrationsværktøj.
Layouts migreres én gang pr. version: v1→v2 (2D-gitter til 10 m-plan), v2→v3 (automatiske veje/taxiveje).
Ændrer du layoutformatet igen: tilføj v3→v4 i `db.js` og hæv versionen ved køb af lufthavn i `server.js`.

## API (alle under /api, JSON)

Offentlige: `catalog`, `airports?s&w&n&e&z`, `airports/search?q`, `airports/:id`, `world`, `leaderboard`, `users/:id`, `users/:id/avatar`.
Med login (Bearer-token): `state`, `logout`, `license`, `loan`, `airports/:id/buy|build|demolish`, `aircraft`,
`aircraft/:id/preview|route|overhaul|sell`, `me`, `me/password|logout-all|delete|ack-bankruptcy`, `me/avatar` (PUT), `me/avatar/delete`.
Fejl returneres som `{ error, key, params }`; `key` er en dansk skabelon, som frontend oversætter.

## Kendte begrænsninger

- Kapacitet i en lufthavn tæller kun spillerens egne fly, ikke andre spilleres ankomster (`economy.js`, markeret `shortcut:`).
- Rangliste og selskabsværdi beregnes i JS over alle rækker (`server.js`, `shortcut:`) – flyt til et cachet job ved mange spillere.
- Ingen rate limiting på login, ingen "glemt adgangskode", ingen moderering af profilbilleder/bio.
- Editoren mangler fortryd, kopier område og animerede passagerer. 3D-visningen er ikke testet i alle browsere.
- Ingen frontend-tests; backend-tests dækker økonomi, pladsplan og analyse.

## Idéer til næste skridt

1. Fortryd/gentag i editoren (gem de sidste layouts i hukommelsen).
2. Rate limiting på `/api/login` og `/api/register`.
3. Cache rangliste og `companyValues()` i et interval.
4. Chat eller beskeder mellem spillere.
