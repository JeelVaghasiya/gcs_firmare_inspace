# IN-SPACe 2026 — Team 003 Ground Control Station

| Page | For | What it does |
|---|---|---|
| `index.html` | GCS laptop (Chrome / Edge) | Web Serial to the Teensy ground station (`inspace_ground_modular`), 3 live stations, commands, CSV, **Firebase upload** |
| `viewer.html` | everyone else, phone or laptop | read-only; follows whatever mission the GCS is uploading |

Tabs = the three radio links of the ground station:

| Tab | Ground line tag | Vehicle / radio |
|---|---|---|
| PAYLOAD (LoRa) | `PL` | payload, E220 LoRa 866.00 / 867.75 MHz |
| PAYLOAD (XBee) | `PX` | payload, XBee #2 |
| CANSAT (XBee) | `CX` | CanSat, XBee #1 |

Each tab shows all 29 telemetry fields, flight-state track, decoded FLAGS, link quality
(good / bad CRC / dropped / PLR / rate, RSSI + SNR on LoRa, ground radio channel), map,
3D trajectory, 3D attitude (roll/pitch from the onboard AHRS, yaw integrated from spin rate),
and charts for altitude, vertical velocity, acceleration, attitude + spin, temperature, pressure,
voltage + current.

## Run the GCS
```
python serve.py        # http://localhost:8000/index.html
```
Web Serial needs `localhost` or https (GitHub Pages works too). **Connect GCS** → pick the Teensy.
**DEMO** (or Shift+D) runs a simulated two-vehicle flight through the same code path, including upload.

Commands go to the **TARGET** in the command bar (Payload / CanSat / Both). The ground station turns
`PAY:CX,ON` into `CMD,003,CX,ON` and sends it over the payload route (LoRa + XBee by default).
The console's target list also has **GROUND STN** for local commands: `STATS`, `RADIOS`, `SETUP`,
`PROUTE,LORA|XBEE|BOTH`, `GCH,<CX|PX|PL>,<MAIN|BACKUP>`, `RAW`.
`AUTO TEST` runs CX ON → TEST → DEPLOY → (checks leg switch) → STOW → FLIGHT on the target.

## Firebase
`firebase-config.js` holds the project (currently `inspace-f7015`). The GCS 🔥 badge opens a dialog where
you can paste a different config, set the path (`gcs/003`), name the mission, optionally sign in, and tick
"start automatically". Settings are kept in that browser.

```
gcs/003/
  meta                          { missionId, startedAt, updatedAt }
  live/<payload_lora|payload_xbee|cansat>    latest record
  live/links                    ground link stats (every 5 s)
  missions/<missionId>/<station>/<pushId>    every packet (short keys)
```
Rules: `database.rules.json` makes `gcs/003` public-read and writable only by one signed-in account.
Create that user (Authentication → Email/Password), put its email in the rules, publish, and enter the
same email/password in the GCS dialog. If the database is still in test mode, uploads work without signing in.

## Host the viewer on GitHub Pages
Push this folder, Settings → Pages → branch `main`, root. Viewer URL:
`https://<user>.github.io/<repo>/viewer.html`.
