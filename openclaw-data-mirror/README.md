# OpenClaw Data Mirror

A standalone Node.js HTTP server (zero npm dependencies — stdlib only) that runs on `localhost:9600` and exposes WorldMonitor's live intelligence data as simple JSON REST endpoints for OpenClaw agents.

---

## Prerequisites

- **Node.js** ≥ 18 (ships with macOS 14+ or install via `brew install node`)
- **WorldMonitor** running locally on port 3000 (for the proxied endpoints)
- **NASA FIRMS API key** (optional, for the `/api/fires` endpoint)

---

## Quick Start

```bash
# Clone / navigate to this directory
cd openclaw-data-mirror

# Start the server (no npm install needed)
node server.js
```

The server starts on `http://localhost:9600`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `9600` | Port the mirror listens on |
| `WM_BASE_URL` | `http://localhost:3000` | WorldMonitor base URL |
| `NASA_FIRMS_API_KEY` | *(unset)* | NASA FIRMS API key for wildfire data |

### Example with all variables

```bash
PORT=9600 \
WM_BASE_URL=http://localhost:3000 \
NASA_FIRMS_API_KEY=your_key_here \
node server.js
```

### Getting a NASA FIRMS API key

Register for free at [https://firms.modaps.eosdis.nasa.gov/api/](https://firms.modaps.eosdis.nasa.gov/api/). Without a key, `/api/fires` returns a 503 error but all other endpoints continue to work normally.

---

## API Reference

All responses are JSON with an `_meta` block:

```json
{
  "data": { ... },
  "_meta": {
    "source": "worldmonitor/news",
    "cached": false,
    "fetched_at": "2026-04-03T00:00:00.000Z",
    "ttl_seconds": 120
  }
}
```

### WorldMonitor-proxied endpoints

These proxy to your local WorldMonitor instance. If WorldMonitor is offline, they return `{ "error": "WorldMonitor offline", "data": null }` (or stale cached data if available).

| Endpoint | TTL | WorldMonitor path |
|---|---|---|
| `GET /api/news` | 120s | `/api/news/v1/list-feed-digest` |
| `GET /api/markets` | 60s | `/api/market/v1/list-market-quotes` |
| `GET /api/conflicts` | 120s | `/api/conflict/v1/list-ucdp-events` |
| `GET /api/military` | 120s | `/api/military/v1/list-military-flights` |
| `GET /api/weather` | 300s | `/api/climate/v1/list-climate-anomalies` |
| `GET /api/cyber` | 900s | `/api/cyber/v1/list-cyber-threats` |
| `GET /api/economic` | 900s | `/api/economic/v1/get-economic-calendar` |
| `GET /api/infrastructure` | 900s | `/api/infrastructure/v1/list-internet-outages` |
| `GET /api/predictions` | 300s | `/api/prediction/v1/list-prediction-markets` |
| `GET /api/sanctions` | 900s | `/api/sanctions/v1/list-sanctions-pressure` |

### Direct public API endpoints

These work without WorldMonitor.

| Endpoint | TTL | Source |
|---|---|---|
| `GET /api/earthquakes` | 300s | USGS Significant Earthquakes (past month) |
| `GET /api/aircraft` | 15s | OpenSky Network (rate-limited, 1 req/10s anon) |
| `GET /api/satellites` | 600s | CelesTrak active satellites (TLE data) |
| `GET /api/fires` | 600s | NASA FIRMS VIIRS SNPP NRT (requires API key) |

### Meta endpoints

| Endpoint | Description |
|---|---|
| `GET /api/status` | Health check — lists all feeds with live/stale/uncached status and WorldMonitor reachability |
| `GET /api/all` | Combined snapshot of all 14 data domains in a single response |
| `GET /` | Lists all available endpoints |

---

## Usage Examples

### Quick status check

```bash
curl http://localhost:9600/api/status | jq '.mirror'
```

### Get live market data

```bash
curl http://localhost:9600/api/markets
```

### World brief (everything in one call)

```bash
curl http://localhost:9600/api/all | jq '{news: .news._meta, markets: .markets._meta, earthquakes: .earthquakes.data.count}'
```

### Latest earthquakes (no WorldMonitor needed)

```bash
curl http://localhost:9600/api/earthquakes | jq '.data.features[].place'
```

### Live aircraft count (no WorldMonitor needed)

```bash
curl http://localhost:9600/api/aircraft | jq '.data.count'
```

---

## Caching Behaviour

The server maintains an in-memory TTL cache using a plain `Map`. On each request:

1. If a fresh cache entry exists → return it immediately (`_meta.cached: true`)
2. If no cache entry or entry is expired → fetch from upstream, populate cache, return fresh data (`_meta.cached: false`)
3. If upstream is unreachable and a stale cache entry exists → return stale data with `_meta.stale: true`
4. If upstream is unreachable and no cache exists → return error JSON with appropriate HTTP status

Cache is in-memory only and is cleared on restart.

---

## Auto-Start with macOS LaunchAgent

The included `com.openclaw.data-mirror.plist` configures the server to start automatically on login.

### Install

```bash
# Copy the plist to LaunchAgents
cp com.openclaw.data-mirror.plist ~/Library/LaunchAgents/

# Load immediately (no reboot needed)
launchctl load ~/Library/LaunchAgents/com.openclaw.data-mirror.plist
```

### Check status

```bash
launchctl list | grep openclaw
```

### View logs

```bash
tail -f /tmp/openclaw-data-mirror.log
tail -f /tmp/openclaw-data-mirror.err
```

### Restart

```bash
launchctl unload ~/Library/LaunchAgents/com.openclaw.data-mirror.plist
launchctl load   ~/Library/LaunchAgents/com.openclaw.data-mirror.plist
```

### Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.openclaw.data-mirror.plist
rm ~/Library/LaunchAgents/com.openclaw.data-mirror.plist
```

### Setting environment variables in the LaunchAgent

Edit `com.openclaw.data-mirror.plist` before loading it. The `EnvironmentVariables` block is where you set `NASA_FIRMS_API_KEY` and optionally `WM_BASE_URL`:

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>NASA_FIRMS_API_KEY</key>
    <string>your_key_here</string>
    <key>WM_BASE_URL</key>
    <string>http://localhost:3000</string>
</dict>
```

---

## Error Responses

| Scenario | HTTP Status | Response |
|---|---|---|
| WorldMonitor offline, no cache | 503 | `{ "error": "WorldMonitor offline", "data": null }` |
| WorldMonitor offline, stale cache | 200 | Data with `_meta.stale: true` |
| Public API failed, stale cache | 200 | Data with `_meta.stale: true` |
| Public API failed, no cache | 502 | `{ "error": "Upstream fetch failed: ..." }` |
| NASA key not set | 503 | `{ "error": "NASA_FIRMS_API_KEY not set", "hint": "..." }` |
| Unknown endpoint | 404 | `{ "error": "Not Found" }` |
| Wrong method | 405 | `{ "error": "Method Not Allowed" }` |

---

## Architecture Notes

- **Zero dependencies** — uses only Node.js built-in modules: `http`, `https`, `url`
- **Single file** — all logic in `server.js`
- **Parallel fetches** — `/api/all` fires all 14 upstream fetches simultaneously via `Promise.allSettled`
- **Never crashes** — `uncaughtException` and `unhandledRejection` handlers keep the process alive
- **Graceful shutdown** — `SIGTERM`/`SIGINT` drain active connections before exit
- **CORS** — all responses include `Access-Control-Allow-Origin: *`

---

## File Structure

```
openclaw-data-mirror/
  server.js                         Single-file server (zero deps)
  README.md                         This file
  com.openclaw.data-mirror.plist    macOS LaunchAgent for auto-start
```
