# FIZ – Feuerwehr-Informationszentrale / Simulation

Browserbasierte Simulation einer Feuerwehr-Leitstelle mit Fahrzeughalle/Wache, aPager und digitalem Meldeempfänger (DME). Die Komponenten kommunizieren über MQTT; Karten und Straßenrouting werden über externe APIs bereitgestellt.

## Komponenten

- **Leitstelle** – 5-W-Einsatzaufnahme, Alarmierung, Karte, Fahrzeugstatus und Admin-Protokoll
- **Fahrzeughalle / Wache** – Rückmeldungsübersicht, Fahrzeugstatus und Fahrzeugsimulation
- **aPager** – Alarmempfang und Rückmeldung `KOMME` / `KOMME NICHT`
- **DME** – Alarmempfang und Quittierung

## Projektstruktur

```text
FIZ/
├── assets/
│   ├── audio/
│   └── images/
├── css/
├── html/
├── js/
│   └── shared/
├── .gitignore
└── README.md
```

## Ersteinrichtung

1. `js/shared/config.local.example.js` nach `js/shared/config.local.js` kopieren.
2. In `config.local.js` den eigenen MapTiler- und OpenRouteService-Key eintragen.
3. `html/leitstelle.html` öffnen. Für die Gesamtsimulation zusätzlich `fahrzeughalle.html`, `apager.html` und `digitaler-meldeempfaenger.html` öffnen.

PowerShell:

```powershell
Copy-Item .\js\shared\config.local.example.js .\js\shared\config.local.js
```

`config.local.js` wird durch `.gitignore` nicht versioniert.

## Git – erster Commit

```powershell
git init
git add .
git status
git commit -m "Initial commit: FIZ Feuerwehr-Simulation"
git branch -M main
```

Danach das vorhandene Remote-Repository verbinden:

```powershell
git remote add origin DEINE_REPOSITORY_URL
git push -u origin main
```

## Konfiguration

Öffentliche Standardwerte stehen in `js/shared/config.js`. Lokale API-Schlüssel stehen ausschließlich in `js/shared/config.local.js`.

> Wichtig: Keine API-Schlüssel in `config.js` committen. Vor jedem Commit mit `git diff --cached` bzw. `git status` kontrollieren, was eingecheckt wird.

## Externe Dienste

- MQTT über WebSocket
- MapTiler für Karten/Geocoding
- OpenRouteService für Straßenrouting

Die Anwendung ist eine Simulation und nicht für den operativen Feuerwehreinsatz vorgesehen.
