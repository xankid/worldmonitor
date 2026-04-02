# GodEye Implementation Guide — For Claude / OpenClaw Agents

## IMPORTANT: Ask the user for their API keys before proceeding with setup

You need the following from the user. **Do not skip this step.**

```
REQUIRED:
- GROQ_API_KEY (free: https://console.groq.com)

RECOMMENDED (unlock more data feeds):
- FINNHUB_API_KEY (free: https://finnhub.io)
- FRED_API_KEY (free: https://fred.stlouisfed.org/docs/api/api_key.html)
- NASA_FIRMS_API_KEY (free: https://firms.modaps.eosdis.nasa.gov/api/)
- AISSTREAM_API_KEY (free: https://aisstream.io)
- AVIATIONSTACK_API (free: https://aviationstack.com)
- ACLED_ACCESS_TOKEN (free for researchers: https://acleddata.com)
- EIA_API_KEY (free: https://www.eia.gov/opendata/)

OPTIONAL (paid):
- CLOUDFLARE_API_TOKEN (for internet outage data)
- OPENROUTER_API_KEY (for additional LLM provider)
```

---

## What Is GodEye

GodEye is a combined platform consisting of:

1. **WorldMonitor** — Real-time global intelligence dashboard (87 panels, 55+ map layers, 30+ data sources). The existing upstream project by Elie Habib (github.com/koala73/worldmonitor), 46K+ stars.

2. **WorldView** — A new surveillance-class 3D globe page we added inside WorldMonitor. Inspired by Bilawal Sidhu's WorldView spy satellite simulator. Features live aircraft tracking (OpenSky), satellite orbital tracking (CelesTrak/satellite.js), vessel AIS tracking, webcam overlays, and military-grade shader effects (NVG, FLIR, CRT, Anime, Noir, Blueprint). Cyan-on-navy aesthetic with amber branding.

3. **OpenClaw Data Mirror** — A standalone zero-dependency Node.js server (localhost:9600) that proxies WorldMonitor's live data as simple JSON REST endpoints for OpenClaw agents to consume.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│  GodEye (runs on Mac Studio M4 Ultra, user n1-02)│
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ WorldMonitor + WorldView (Docker, port 3000) │ │
│  │   http://localhost:3000/            → Monitor │ │
│  │   http://localhost:3000/worldview.html → View │ │
│  │                                               │ │
│  │   Services: worldmonitor, ais-relay,          │ │
│  │             redis, redis-rest                 │ │
│  └──────────────┬───────────────────────────────┘ │
│                 │ proxies                          │
│  ┌──────────────▼───────────────────────────────┐ │
│  │ OpenClaw Data Mirror (Node.js, port 9600)    │ │
│  │   http://localhost:9600/api/all   → all data  │ │
│  │   http://localhost:9600/api/news  → news      │ │
│  │   http://localhost:9600/api/markets → markets │ │
│  │   ... 16 endpoints total                      │ │
│  │   Also fetches directly from public APIs:     │ │
│  │   USGS, OpenSky, CelesTrak, NASA FIRMS       │ │
│  └──────────────┬───────────────────────────────┘ │
│                 │ called by                        │
│  ┌──────────────▼───────────────────────────────┐ │
│  │ OpenClaw Agents                               │ │
│  │   curl http://localhost:9600/api/all           │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## Step-by-Step Setup

### Prerequisites
- macOS with Docker Desktop (or Podman) installed
- Node.js 22+ (`brew install node` or already installed)
- Git
- Docker Compose

### 1. Clone the Fork (god-eye branch)

```bash
cd ~
git clone -b god-eye https://github.com/xankid/worldmonitor.git
cd worldmonitor
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add the API keys the user provides. At minimum:

```env
GROQ_API_KEY=<user's key>
FINNHUB_API_KEY=<user's key>
FRED_API_KEY=<user's key>
NASA_FIRMS_API_KEY=<user's key>
AISSTREAM_API_KEY=<user's key>
```

### 4. Create Docker Compose Override (for API keys)

Create `docker-compose.override.yml`:

```yaml
services:
  worldmonitor:
    environment:
      GROQ_API_KEY: "<user's key>"
      FINNHUB_API_KEY: "<user's key>"
      FRED_API_KEY: "<user's key>"
      EIA_API_KEY: "<user's key>"
      ACLED_ACCESS_TOKEN: "<user's key>"
      NASA_FIRMS_API_KEY: "<user's key>"
      AVIATIONSTACK_API: "<user's key>"
      AISSTREAM_API_KEY: "<user's key>"
  ais-relay:
    environment:
      AISSTREAM_API_KEY: "<user's key>"
```

### 5. Start WorldMonitor via Docker

```bash
docker compose up -d --build
```

This starts 4 services:
- `worldmonitor` — the main app (port 3000)
- `ais-relay` — AIS WebSocket relay (port 3004, internal)
- `redis` — data cache
- `redis-rest` — Redis REST API adapter (port 8079, internal)

### 6. Seed Initial Data into Redis

```bash
./scripts/run-seeders.sh
```

This populates the Redis cache with initial data from all configured sources. Takes 1-2 minutes.

### 7. Verify WorldMonitor Is Running

```bash
open http://localhost:3000
```

The full intelligence dashboard should load. Panels will populate as data feeds connect.

### 8. Verify WorldView Is Running

```bash
open http://localhost:3000/worldview.html
```

The surveillance globe page should load with the cyan-on-navy UI. Aircraft, satellite, and webcam data will begin streaming.

---

## OpenClaw Data Mirror Setup

### 9. Start the Data Mirror

```bash
cd ~/worldmonitor/openclaw-data-mirror

# Set the NASA FIRMS key if you have one
export NASA_FIRMS_API_KEY="<user's key>"

# Start the server
node server.js
```

The mirror starts on `http://localhost:9600`.

### 10. Verify the Data Mirror

```bash
# Health check
curl -s http://localhost:9600/api/status | python3 -m json.tool

# Get everything in one call
curl -s http://localhost:9600/api/all | python3 -m json.tool | head -50

# Test individual endpoints
curl -s http://localhost:9600/api/earthquakes | python3 -m json.tool
curl -s http://localhost:9600/api/aircraft | python3 -m json.tool
curl -s http://localhost:9600/api/satellites | python3 -m json.tool
```

### 11. Install Data Mirror as LaunchAgent (Auto-Start on Login)

First, edit the plist to match the user's actual Node.js path:

```bash
# Find node path
which node
# e.g., /opt/homebrew/bin/node

# Edit the plist if needed (update the node path)
# The default assumes /usr/local/bin/node
# If using Homebrew, change to /opt/homebrew/bin/node
```

Edit `openclaw-data-mirror/com.openclaw.data-mirror.plist`:
- Line with `/usr/local/bin/node` → change to actual `which node` output
- Line with `/Users/n1-02/worldmonitor/` → verify this matches actual clone path
- Add `NASA_FIRMS_API_KEY` value if the user has one

Then install:

```bash
cp openclaw-data-mirror/com.openclaw.data-mirror.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.openclaw.data-mirror.plist
```

To check it's running:
```bash
launchctl list | grep openclaw
curl -s http://localhost:9600/api/status
```

Logs are at:
- stdout: `/tmp/openclaw-data-mirror.log`
- stderr: `/tmp/openclaw-data-mirror.err`

---

## Data Mirror API Reference (for OpenClaw Agents)

All responses are JSON with `_meta` block containing `source`, `cached`, `fetched_at`, `ttl_seconds`.

### Proxied from WorldMonitor (requires WorldMonitor running on port 3000)

| Endpoint | Data | Cache TTL |
|---|---|---|
| `GET /api/news` | AI-classified geopolitical news | 120s |
| `GET /api/markets` | Stocks, crypto, commodities, forex | 60s |
| `GET /api/conflicts` | Armed conflicts, UCDP events | 120s |
| `GET /api/military` | Military flights, theater posture | 120s |
| `GET /api/weather` | Climate anomalies, weather alerts | 300s |
| `GET /api/cyber` | Cyber threat intelligence, IOCs | 900s |
| `GET /api/economic` | Economic calendar, macro signals | 900s |
| `GET /api/infrastructure` | Internet outages, service status | 900s |
| `GET /api/predictions` | Polymarket prediction markets | 300s |
| `GET /api/sanctions` | OFAC sanctions, pressure scores | 900s |

### Direct from Public APIs (works even if WorldMonitor is offline)

| Endpoint | Source | Cache TTL |
|---|---|---|
| `GET /api/earthquakes` | USGS GeoJSON feed | 300s |
| `GET /api/aircraft` | OpenSky Network ADS-B | 15s |
| `GET /api/satellites` | CelesTrak GP JSON | 600s |
| `GET /api/fires` | NASA FIRMS (needs API key) | 600s |

### Meta Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/status` | Health check: all feed states, WM reachability, uptime |
| `GET /api/all` | Combined snapshot of all 14 data domains in one call |
| `GET /` | Endpoint directory with descriptions |

### Example Agent Usage

```bash
# Get a full world briefing in one call
curl -s http://localhost:9600/api/all

# Check if any earthquakes are happening
curl -s http://localhost:9600/api/earthquakes

# Get live aircraft data
curl -s http://localhost:9600/api/aircraft

# Check system health
curl -s http://localhost:9600/api/status
```

---

## WorldView Page Details

### File Structure (all under the worldmonitor repo)

```
worldview.html                          — HTML entry point (project root)
src/worldview/
  worldview-main.ts                     — App bootstrap, data loops, wiring
  worldview.css                         — Full stylesheet (895 lines)
  globe-renderer.ts                     — maplibre-gl globe + deck.gl layers
  data-feeds.ts                         — OpenSky, CelesTrak, AIS, webcams
  shader-effects.ts                     — CSS filter chains per shader mode
  hud-panels.ts                         — All HUD DOM components
  types.ts                              — Shared TypeScript types
```

### How WorldView Fetches Data

- **Aircraft**: Direct from OpenSky Network (`https://opensky-network.org/api/states/all`), 15-second poll interval, anonymous rate limit respected
- **Satellites**: Via WorldMonitor's `/api/satellites` endpoint (which fetches from CelesTrak), then propagated locally using satellite.js every 3 seconds
- **Vessels**: Via WorldMonitor's `/api/ais-snapshot` endpoint (requires AISSTREAM_API_KEY)
- **Webcams**: Via WorldMonitor's `/api/webcam/v1/list-webcams`, falls back to 8 hardcoded landmark locations

### Shader Modes

| Mode | CSS Filter | Overlay |
|---|---|---|
| Normal | none | none |
| CRT | contrast(1.1) brightness(0.92) saturate(0.9) | Heavy scanlines + vignette + flicker |
| NVG | brightness(1.3) contrast(1.4) saturate(0) sepia(1) hue-rotate(75deg) brightness(0.7) | Green tint |
| FLIR | contrast(1.6) saturate(2.2) hue-rotate(180deg) brightness(0.9) | Warm edge radial |
| Anime | contrast(1.2) saturate(1.6) brightness(1.1) | Warm soft glow |
| Noir | saturate(0) contrast(1.4) brightness(0.85) | Heavy vignette |
| Blueprint | brightness(0.75) contrast(1.3) saturate(0) sepia(1) hue-rotate(180deg) | Grid overlay |

---

## Keeping GodEye Updated

The god-eye branch is designed to stay merge-clean with upstream. WorldMonitor upstream gets ~45 commits/day.

```bash
cd ~/worldmonitor
git fetch upstream
git merge upstream/main
```

Our files live in `src/worldview/`, `worldview.html`, `openclaw-data-mirror/` — none of which exist in upstream. The only shared file is `vite.config.ts` with a single added line (the worldview MPA entry), which git auto-merges cleanly.

---

## Troubleshooting

### WorldMonitor won't start
```bash
docker compose logs worldmonitor
```
Common issue: missing API keys. Check `.env` and `docker-compose.override.yml`.

### Data Mirror shows "WorldMonitor offline"
WorldMonitor must be running on port 3000 first. The mirror's proxied endpoints (`/api/news`, `/api/markets`, etc.) need it. Public API endpoints (`/api/earthquakes`, `/api/aircraft`, `/api/satellites`) work independently.

### WorldView shows blank globe
Check browser console for errors. Common issues:
- maplibre-gl WebGL context lost → refresh the page
- CORS errors on OpenSky → the API may be temporarily down, data will load on next poll

### LaunchAgent not starting
```bash
launchctl list | grep openclaw
cat /tmp/openclaw-data-mirror.err
```
Usually a wrong Node.js path in the plist. Fix with `which node` and update the plist.

---

## Dev Mode (without Docker)

For development/iteration on WorldView without Docker:

```bash
cd ~/worldmonitor
npm install
npm run dev
```

This starts Vite dev server on `http://localhost:5173`:
- `http://localhost:5173/` → WorldMonitor
- `http://localhost:5173/worldview.html` → WorldView

Note: In dev mode, the sebuf API handlers run as Vite plugins, and some data feeds that depend on Redis/seeders won't work. Aircraft and satellite tracking will still work (they hit public APIs directly).
