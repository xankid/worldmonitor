/**
 * OpenClaw Data Mirror
 * A standalone Node.js HTTP server (zero npm deps, stdlib only) that proxies
 * WorldMonitor's live intelligence data and select public APIs as simple JSON
 * REST endpoints for OpenClaw agents.
 *
 * Port:    9600 (or PORT env var)
 * Upstream: http://localhost:3000 (or WM_BASE_URL env var)
 */

"use strict";

const http  = require("http");
const https = require("https");
const url   = require("url");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT        = parseInt(process.env.PORT || "9600", 10);
const WM_BASE_URL = (process.env.WM_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const NASA_FIRMS_API_KEY = process.env.NASA_FIRMS_API_KEY || "";

// Cache TTLs (seconds)
const TTL = {
  markets:        60,
  news:          120,
  conflicts:     120,
  military:      120,
  weather:       300,
  cyber:         900,
  economic:      900,
  infrastructure: 900,
  predictions:   300,
  sanctions:     900,
  earthquakes:   300,
  aircraft:       15,
  satellites:    600,
  fires:         600,
};

// ---------------------------------------------------------------------------
// In-memory TTL cache
// ---------------------------------------------------------------------------

/**
 * Each cache entry: { data: any, fetchedAt: Date, ttlSeconds: number }
 */
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  const ageMs = Date.now() - entry.fetchedAt.getTime();
  if (ageMs > entry.ttlSeconds * 1000) return null; // expired
  return entry;
}

function cacheSet(key, data, ttlSeconds) {
  cache.set(key, { data, fetchedAt: new Date(), ttlSeconds });
}

function cacheGetStale(key) {
  return cache.get(key) || null; // return even if expired
}

// ---------------------------------------------------------------------------
// HTTP fetch helpers (stdlib only)
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and return the raw body as a string.
 * Follows up to `maxRedirects` HTTP 3xx redirects.
 */
function fetchRaw(targetUrl, { headers = {}, timeoutMs = 15000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let redirectsLeft = maxRedirects;

    function doRequest(reqUrl) {
      const parsed = url.parse(reqUrl);
      const lib    = parsed.protocol === "https:" ? https : http;
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port,
        path:     parsed.path,
        method:   "GET",
        headers:  {
          "User-Agent": "OpenClaw-DataMirror/1.0",
          "Accept":     "application/json, text/plain, */*",
          ...headers,
        },
      };

      const req = lib.request(options, (res) => {
        // Handle redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          redirectsLeft--;
          const next = url.resolve(reqUrl, res.headers.location);
          res.resume(); // drain
          doRequest(next);
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers:    res.headers,
            body:       Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms: ${reqUrl}`));
      });

      req.on("error", reject);
      req.end();
    }

    doRequest(targetUrl);
  });
}

/**
 * Fetch JSON from a URL, return parsed object.
 */
async function fetchJSON(targetUrl, opts) {
  const res = await fetchRaw(targetUrl, opts);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`HTTP ${res.statusCode} from ${targetUrl}`);
  }
  return JSON.parse(res.body);
}

/**
 * Fetch CSV/text from a URL, return raw string.
 */
async function fetchText(targetUrl, opts) {
  const res = await fetchRaw(targetUrl, opts);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`HTTP ${res.statusCode} from ${targetUrl}`);
  }
  return res.body;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg, ...args) {
  const ts = new Date().toISOString();
  console[level === "error" ? "error" : "log"](`[${ts}] [${level.toUpperCase()}] ${msg}`, ...args);
}

function logRequest(req, status, cached) {
  log("info", `${req.method} ${req.url} → ${status}${cached ? " (cache hit)" : ""}`);
}

// ---------------------------------------------------------------------------
// WorldMonitor proxy helpers
// The bootstrap endpoint returns bulk data. We also support individual
// domain endpoints for more targeted refreshes.
// ---------------------------------------------------------------------------

/**
 * Proxy a single WorldMonitor API endpoint and return its JSON response.
 */
async function wmFetch(path) {
  const fullUrl = `${WM_BASE_URL}${path}`;
  return await fetchJSON(fullUrl, { timeoutMs: 20000 });
}

/**
 * Try to fetch WorldMonitor bootstrap bulk data.
 * Returns null if WM is offline.
 */
async function wmBootstrap() {
  try {
    return await wmFetch("/api/bootstrap");
  } catch (e) {
    log("warn", `WorldMonitor bootstrap unavailable: ${e.message}`);
    return null;
  }
}

/**
 * Generic cached WorldMonitor domain fetcher.
 * `cacheKey`  — the cache key to use
 * `ttl`       — TTL in seconds
 * `wmPaths`   — array of WM API paths to try in order (first success wins)
 * `extract`   — optional fn(raw) → data transformation
 */
async function fetchWmDomain(cacheKey, ttl, wmPaths, extract) {
  // Check fresh cache
  const cached = cacheGet(cacheKey);
  if (cached) {
    return { data: cached.data, cached: true, fetchedAt: cached.fetchedAt };
  }

  // Try each WM path in order
  for (const wmPath of wmPaths) {
    try {
      const raw  = await wmFetch(wmPath);
      const data = extract ? extract(raw) : raw;
      cacheSet(cacheKey, data, ttl);
      return { data, cached: false, fetchedAt: new Date() };
    } catch (e) {
      log("warn", `WM path ${wmPath} failed: ${e.message}`);
    }
  }

  // All WM paths failed — return stale cache or offline indicator
  const stale = cacheGetStale(cacheKey);
  if (stale) {
    log("warn", `${cacheKey}: returning stale cache (WM offline)`);
    return { data: stale.data, cached: true, stale: true, fetchedAt: stale.fetchedAt };
  }
  return null; // truly offline, no cache
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type":  "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function buildMeta(source, cached, fetchedAt, ttlSeconds, extra = {}) {
  return {
    source,
    cached:     !!cached,
    fetched_at: (fetchedAt || new Date()).toISOString(),
    ttl_seconds: ttlSeconds,
    ...extra,
  };
}

function offlineMeta(source) {
  return {
    source,
    cached:     false,
    fetched_at: new Date().toISOString(),
    ttl_seconds: 0,
    offline:    true,
  };
}

// ---------------------------------------------------------------------------
// Individual endpoint handlers
// ---------------------------------------------------------------------------

// --- WorldMonitor domain endpoints ---

async function handleNews(req, res) {
  const result = await fetchWmDomain(
    "news",
    TTL.news,
    [
      "/api/news/v1/list-feed-digest",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/news"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/news", result.cached, result.fetchedAt, TTL.news,
      result.stale ? { stale: true } : {}),
  });
}

async function handleMarkets(req, res) {
  const result = await fetchWmDomain(
    "markets",
    TTL.markets,
    [
      "/api/market/v1/list-market-quotes",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/markets"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/markets", result.cached, result.fetchedAt, TTL.markets,
      result.stale ? { stale: true } : {}),
  });
}

async function handleConflicts(req, res) {
  const result = await fetchWmDomain(
    "conflicts",
    TTL.conflicts,
    [
      "/api/conflict/v1/list-ucdp-events",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/conflicts"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/conflicts", result.cached, result.fetchedAt, TTL.conflicts,
      result.stale ? { stale: true } : {}),
  });
}

async function handleMilitary(req, res) {
  const result = await fetchWmDomain(
    "military",
    TTL.military,
    [
      "/api/military/v1/list-military-flights",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/military"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/military", result.cached, result.fetchedAt, TTL.military,
      result.stale ? { stale: true } : {}),
  });
}

async function handleWeather(req, res) {
  const result = await fetchWmDomain(
    "weather",
    TTL.weather,
    [
      "/api/climate/v1/list-climate-anomalies",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/weather"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/weather", result.cached, result.fetchedAt, TTL.weather,
      result.stale ? { stale: true } : {}),
  });
}

async function handleCyber(req, res) {
  const result = await fetchWmDomain(
    "cyber",
    TTL.cyber,
    [
      "/api/cyber/v1/list-cyber-threats",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/cyber"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/cyber", result.cached, result.fetchedAt, TTL.cyber,
      result.stale ? { stale: true } : {}),
  });
}

async function handleEconomic(req, res) {
  const result = await fetchWmDomain(
    "economic",
    TTL.economic,
    [
      "/api/economic/v1/get-economic-calendar",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/economic"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/economic", result.cached, result.fetchedAt, TTL.economic,
      result.stale ? { stale: true } : {}),
  });
}

async function handleInfrastructure(req, res) {
  const result = await fetchWmDomain(
    "infrastructure",
    TTL.infrastructure,
    [
      "/api/infrastructure/v1/list-internet-outages",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/infrastructure"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/infrastructure", result.cached, result.fetchedAt, TTL.infrastructure,
      result.stale ? { stale: true } : {}),
  });
}

async function handlePredictions(req, res) {
  const result = await fetchWmDomain(
    "predictions",
    TTL.predictions,
    [
      "/api/prediction/v1/list-prediction-markets",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/predictions"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/predictions", result.cached, result.fetchedAt, TTL.predictions,
      result.stale ? { stale: true } : {}),
  });
}

async function handleSanctions(req, res) {
  const result = await fetchWmDomain(
    "sanctions",
    TTL.sanctions,
    [
      "/api/sanctions/v1/list-sanctions-pressure",
    ],
  );

  if (!result) {
    return sendJSON(res, 503, {
      error: "WorldMonitor offline",
      fallback: true,
      data: null,
      _meta: offlineMeta("worldmonitor/sanctions"),
    });
  }

  sendJSON(res, 200, {
    data: result.data,
    _meta: buildMeta("worldmonitor/sanctions", result.cached, result.fetchedAt, TTL.sanctions,
      result.stale ? { stale: true } : {}),
  });
}

// --- Public API endpoints ---

async function handleEarthquakes(req, res) {
  const cacheKey = "earthquakes";
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendJSON(res, 200, {
      data: cached.data,
      _meta: buildMeta("usgs/earthquake-feed", true, cached.fetchedAt, TTL.earthquakes),
    });
  }

  try {
    const raw = await fetchJSON(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson",
      { timeoutMs: 15000 }
    );

    // Flatten GeoJSON features into a simpler array
    const data = {
      type:   "FeatureCollection",
      count:  raw.features ? raw.features.length : 0,
      generated: raw.metadata ? raw.metadata.generated : null,
      features: (raw.features || []).map((f) => ({
        id:        f.id,
        magnitude: f.properties.mag,
        place:     f.properties.place,
        time:      f.properties.time,
        time_iso:  new Date(f.properties.time).toISOString(),
        updated:   f.properties.updated,
        url:       f.properties.url,
        status:    f.properties.status,
        depth_km:  f.geometry && f.geometry.coordinates ? f.geometry.coordinates[2] : null,
        longitude: f.geometry && f.geometry.coordinates ? f.geometry.coordinates[0] : null,
        latitude:  f.geometry && f.geometry.coordinates ? f.geometry.coordinates[1] : null,
        tsunami:   f.properties.tsunami,
        felt:      f.properties.felt,
        alert:     f.properties.alert,
        type:      f.properties.type,
      })),
    };

    cacheSet(cacheKey, data, TTL.earthquakes);
    sendJSON(res, 200, {
      data,
      _meta: buildMeta("usgs/earthquake-feed", false, new Date(), TTL.earthquakes),
    });
  } catch (e) {
    log("error", `Earthquakes fetch failed: ${e.message}`);
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      return sendJSON(res, 200, {
        data: stale.data,
        _meta: buildMeta("usgs/earthquake-feed", true, stale.fetchedAt, TTL.earthquakes, { stale: true }),
      });
    }
    sendJSON(res, 502, {
      error: `Upstream fetch failed: ${e.message}`,
      data: null,
      _meta: offlineMeta("usgs/earthquake-feed"),
    });
  }
}

// OpenSky rate limit: 1 req/10s anon. We enforce this via the cache TTL (15s).
async function handleAircraft(req, res) {
  const cacheKey = "aircraft";
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendJSON(res, 200, {
      data: cached.data,
      _meta: buildMeta("opensky-network", true, cached.fetchedAt, TTL.aircraft),
    });
  }

  try {
    const raw = await fetchJSON(
      "https://opensky-network.org/api/states/all",
      { timeoutMs: 20000 }
    );

    // OpenSky returns { time, states: [ [...fields] ] }
    // Fields: icao24, callsign, origin_country, time_position, last_contact,
    //         longitude, latitude, baro_altitude, on_ground, velocity,
    //         true_track, vertical_rate, sensors, geo_altitude, squawk,
    //         spi, position_source, category
    const FIELDS = [
      "icao24", "callsign", "origin_country", "time_position", "last_contact",
      "longitude", "latitude", "baro_altitude", "on_ground", "velocity",
      "true_track", "vertical_rate", "sensors", "geo_altitude", "squawk",
      "spi", "position_source", "category",
    ];

    const states = (raw.states || []).map((arr) => {
      const obj = {};
      FIELDS.forEach((k, i) => { obj[k] = arr[i] !== undefined ? arr[i] : null; });
      return obj;
    });

    const data = {
      time:    raw.time,
      time_iso: new Date(raw.time * 1000).toISOString(),
      count:   states.length,
      states,
    };

    cacheSet(cacheKey, data, TTL.aircraft);
    sendJSON(res, 200, {
      data,
      _meta: buildMeta("opensky-network", false, new Date(), TTL.aircraft),
    });
  } catch (e) {
    log("error", `Aircraft fetch failed: ${e.message}`);
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      return sendJSON(res, 200, {
        data: stale.data,
        _meta: buildMeta("opensky-network", true, stale.fetchedAt, TTL.aircraft, { stale: true }),
      });
    }
    sendJSON(res, 502, {
      error: `Upstream fetch failed: ${e.message}`,
      data: null,
      _meta: offlineMeta("opensky-network"),
    });
  }
}

async function handleSatellites(req, res) {
  const cacheKey = "satellites";
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendJSON(res, 200, {
      data: cached.data,
      _meta: buildMeta("celestrak/active-satellites", true, cached.fetchedAt, TTL.satellites),
    });
  }

  try {
    const raw = await fetchJSON(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json",
      { timeoutMs: 30000 }
    );

    const data = {
      count: Array.isArray(raw) ? raw.length : 0,
      satellites: Array.isArray(raw) ? raw.map((s) => ({
        name:         s.OBJECT_NAME,
        norad_cat_id: s.NORAD_CAT_ID,
        object_type:  s.OBJECT_TYPE,
        classification: s.CLASSIFICATION_TYPE,
        intl_designator: s.INTLDES,
        epoch:        s.EPOCH,
        mean_motion:  s.MEAN_MOTION,           // revs/day
        eccentricity: s.ECCENTRICITY,
        inclination:  s.INCLINATION,           // degrees
        ra_asc_node:  s.RA_OF_ASC_NODE,        // degrees
        arg_perigee:  s.ARG_OF_PERICENTER,     // degrees
        mean_anomaly: s.MEAN_ANOMALY,          // degrees
        ephemeris_type: s.EPHEMERIS_TYPE,
        element_set_no: s.ELEMENT_SET_NO,
        rev_at_epoch: s.REV_AT_EPOCH,
        bstar:        s.BSTAR,
        mean_motion_dot: s.MEAN_MOTION_DOT,
        mean_motion_ddot: s.MEAN_MOTION_DDOT,
      })) : [],
    };

    cacheSet(cacheKey, data, TTL.satellites);
    sendJSON(res, 200, {
      data,
      _meta: buildMeta("celestrak/active-satellites", false, new Date(), TTL.satellites),
    });
  } catch (e) {
    log("error", `Satellites fetch failed: ${e.message}`);
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      return sendJSON(res, 200, {
        data: stale.data,
        _meta: buildMeta("celestrak/active-satellites", true, stale.fetchedAt, TTL.satellites, { stale: true }),
      });
    }
    sendJSON(res, 502, {
      error: `Upstream fetch failed: ${e.message}`,
      data: null,
      _meta: offlineMeta("celestrak/active-satellites"),
    });
  }
}

async function handleFires(req, res) {
  const cacheKey = "fires";
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendJSON(res, 200, {
      data: cached.data,
      _meta: buildMeta("nasa-firms/VIIRS_SNPP_NRT", true, cached.fetchedAt, TTL.fires),
    });
  }

  if (!NASA_FIRMS_API_KEY) {
    return sendJSON(res, 503, {
      error: "NASA_FIRMS_API_KEY environment variable not set",
      hint:  "Set NASA_FIRMS_API_KEY to a valid NASA FIRMS API key. Get one at https://firms.modaps.eosdis.nasa.gov/api/",
      data:  null,
      _meta: offlineMeta("nasa-firms/VIIRS_SNPP_NRT"),
    });
  }

  try {
    const csvUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${NASA_FIRMS_API_KEY}/VIIRS_SNPP_NRT/world/1`;
    const rawCsv = await fetchText(csvUrl, { timeoutMs: 30000 });

    // Parse CSV into objects
    const lines = rawCsv.trim().split("\n");
    if (lines.length < 2) {
      throw new Error("Empty or malformed CSV response from NASA FIRMS");
    }

    const headers = lines[0].split(",").map((h) => h.trim());
    const fires = lines.slice(1).map((line) => {
      const vals = line.split(",");
      const obj = {};
      headers.forEach((h, i) => {
        const v = vals[i] !== undefined ? vals[i].trim() : null;
        // Coerce numeric fields
        const num = parseFloat(v);
        obj[h] = !isNaN(num) && v !== "" ? num : v;
      });
      return obj;
    }).filter((f) => f.latitude !== null && f.latitude !== undefined);

    const data = {
      count: fires.length,
      source_dataset: "VIIRS_SNPP_NRT",
      coverage_days: 1,
      fires,
    };

    cacheSet(cacheKey, data, TTL.fires);
    sendJSON(res, 200, {
      data,
      _meta: buildMeta("nasa-firms/VIIRS_SNPP_NRT", false, new Date(), TTL.fires),
    });
  } catch (e) {
    log("error", `Fires fetch failed: ${e.message}`);
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      return sendJSON(res, 200, {
        data: stale.data,
        _meta: buildMeta("nasa-firms/VIIRS_SNPP_NRT", true, stale.fetchedAt, TTL.fires, { stale: true }),
      });
    }
    sendJSON(res, 502, {
      error: `Upstream fetch failed: ${e.message}`,
      data: null,
      _meta: offlineMeta("nasa-firms/VIIRS_SNPP_NRT"),
    });
  }
}

// ---------------------------------------------------------------------------
// /api/status — health check
// ---------------------------------------------------------------------------

async function handleStatus(req, res) {
  // Check WorldMonitor reachability
  let wmOnline = false;
  let wmLatencyMs = null;
  try {
    const t0 = Date.now();
    await fetchJSON(`${WM_BASE_URL}/api/health`, { timeoutMs: 5000 });
    wmLatencyMs = Date.now() - t0;
    wmOnline = true;
  } catch {
    // WM offline — not a fatal error for the mirror
  }

  // Summarise cache state for every key
  const now = Date.now();
  const cacheStatus = {};
  for (const [key, entry] of cache.entries()) {
    const ageMs    = now - entry.fetchedAt.getTime();
    const fresh    = ageMs < entry.ttlSeconds * 1000;
    cacheStatus[key] = {
      cached:      true,
      fresh,
      age_seconds: Math.round(ageMs / 1000),
      ttl_seconds: entry.ttlSeconds,
      fetched_at:  entry.fetchedAt.toISOString(),
    };
  }

  const domains = [
    "news", "markets", "conflicts", "military", "weather",
    "cyber", "economic", "infrastructure", "predictions", "sanctions",
    "earthquakes", "aircraft", "satellites", "fires",
  ];

  const feeds = {};
  for (const domain of domains) {
    const isWmDomain = !["earthquakes", "aircraft", "satellites", "fires"].includes(domain);
    const cs = cacheStatus[domain];
    feeds[domain] = {
      source: isWmDomain ? "worldmonitor" : "public-api",
      status: cs ? (cs.fresh ? "live" : "stale") : "uncached",
      cached: !!cs,
      ...(cs || {}),
      requires_wm: isWmDomain,
      wm_reachable: isWmDomain ? wmOnline : undefined,
    };
  }

  sendJSON(res, 200, {
    mirror: {
      version:    "1.0.0",
      port:       PORT,
      wm_base_url: WM_BASE_URL,
      wm_online:  wmOnline,
      wm_latency_ms: wmLatencyMs,
      nasa_firms_key_set: !!NASA_FIRMS_API_KEY,
      uptime_seconds: Math.round(process.uptime()),
    },
    feeds,
    _meta: {
      source:     "openclaw-data-mirror",
      cached:     false,
      fetched_at: new Date().toISOString(),
      ttl_seconds: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// /api/all — combined snapshot
// ---------------------------------------------------------------------------

async function handleAll(req, res) {
  const fetchedAt = new Date();

  /**
   * Resolve a domain: returns { data, _meta } without sending to res.
   * We re-use the individual fetch logic by temporarily capturing the response.
   */
  async function resolveWmDomain(cacheKey, ttl, wmPath) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      return {
        data: cached.data,
        _meta: buildMeta(`worldmonitor/${cacheKey}`, true, cached.fetchedAt, ttl),
      };
    }
    try {
      const raw = await wmFetch(wmPath);
      cacheSet(cacheKey, raw, ttl);
      return {
        data: raw,
        _meta: buildMeta(`worldmonitor/${cacheKey}`, false, new Date(), ttl),
      };
    } catch {
      const stale = cacheGetStale(cacheKey);
      if (stale) {
        return {
          data: stale.data,
          _meta: buildMeta(`worldmonitor/${cacheKey}`, true, stale.fetchedAt, ttl, { stale: true }),
        };
      }
      return {
        data: null,
        _meta: { ...offlineMeta(`worldmonitor/${cacheKey}`), error: "WorldMonitor offline" },
      };
    }
  }

  async function resolvePublicDomain(cacheKey, ttl, fetcher, sourceName) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      return {
        data: cached.data,
        _meta: buildMeta(sourceName, true, cached.fetchedAt, ttl),
      };
    }
    try {
      const data = await fetcher();
      cacheSet(cacheKey, data, ttl);
      return { data, _meta: buildMeta(sourceName, false, new Date(), ttl) };
    } catch (e) {
      const stale = cacheGetStale(cacheKey);
      if (stale) {
        return {
          data: stale.data,
          _meta: buildMeta(sourceName, true, stale.fetchedAt, ttl, { stale: true }),
        };
      }
      return {
        data: null,
        _meta: { ...offlineMeta(sourceName), error: e.message },
      };
    }
  }

  // Fire all fetches in parallel
  const [
    news, markets, conflicts, military, weather,
    cyber, economic, infrastructure, predictions, sanctions,
    earthquakes, aircraft, satellites, fires,
  ] = await Promise.allSettled([
    resolveWmDomain("news",           TTL.news,           "/api/news/v1/list-feed-digest"),
    resolveWmDomain("markets",        TTL.markets,        "/api/market/v1/list-market-quotes"),
    resolveWmDomain("conflicts",      TTL.conflicts,      "/api/conflict/v1/list-ucdp-events"),
    resolveWmDomain("military",       TTL.military,       "/api/military/v1/list-military-flights"),
    resolveWmDomain("weather",        TTL.weather,        "/api/climate/v1/list-climate-anomalies"),
    resolveWmDomain("cyber",          TTL.cyber,          "/api/cyber/v1/list-cyber-threats"),
    resolveWmDomain("economic",       TTL.economic,       "/api/economic/v1/get-economic-calendar"),
    resolveWmDomain("infrastructure", TTL.infrastructure, "/api/infrastructure/v1/list-internet-outages"),
    resolveWmDomain("predictions",    TTL.predictions,    "/api/prediction/v1/list-prediction-markets"),
    resolveWmDomain("sanctions",      TTL.sanctions,      "/api/sanctions/v1/list-sanctions-pressure"),

    // Public APIs
    resolvePublicDomain("earthquakes", TTL.earthquakes, async () => {
      const raw = await fetchJSON(
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson"
      );
      return {
        type: "FeatureCollection",
        count: raw.features ? raw.features.length : 0,
        generated: raw.metadata ? raw.metadata.generated : null,
        features: (raw.features || []).map((f) => ({
          id:        f.id,
          magnitude: f.properties.mag,
          place:     f.properties.place,
          time:      f.properties.time,
          time_iso:  new Date(f.properties.time).toISOString(),
          depth_km:  f.geometry && f.geometry.coordinates ? f.geometry.coordinates[2] : null,
          longitude: f.geometry && f.geometry.coordinates ? f.geometry.coordinates[0] : null,
          latitude:  f.geometry && f.geometry.coordinates ? f.geometry.coordinates[1] : null,
          tsunami:   f.properties.tsunami,
          alert:     f.properties.alert,
          url:       f.properties.url,
        })),
      };
    }, "usgs/earthquake-feed"),

    resolvePublicDomain("aircraft", TTL.aircraft, async () => {
      const raw = await fetchJSON("https://opensky-network.org/api/states/all");
      const FIELDS = [
        "icao24","callsign","origin_country","time_position","last_contact",
        "longitude","latitude","baro_altitude","on_ground","velocity",
        "true_track","vertical_rate","sensors","geo_altitude","squawk",
        "spi","position_source","category",
      ];
      const states = (raw.states || []).map((arr) => {
        const obj = {};
        FIELDS.forEach((k, i) => { obj[k] = arr[i] !== undefined ? arr[i] : null; });
        return obj;
      });
      return {
        time: raw.time,
        time_iso: new Date(raw.time * 1000).toISOString(),
        count: states.length,
        states,
      };
    }, "opensky-network"),

    resolvePublicDomain("satellites", TTL.satellites, async () => {
      const raw = await fetchJSON(
        "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json",
        { timeoutMs: 30000 }
      );
      return {
        count: Array.isArray(raw) ? raw.length : 0,
        satellites: Array.isArray(raw) ? raw.map((s) => ({
          name:         s.OBJECT_NAME,
          norad_cat_id: s.NORAD_CAT_ID,
          object_type:  s.OBJECT_TYPE,
          classification: s.CLASSIFICATION_TYPE,
          epoch:        s.EPOCH,
          mean_motion:  s.MEAN_MOTION,
          eccentricity: s.ECCENTRICITY,
          inclination:  s.INCLINATION,
        })) : [],
      };
    }, "celestrak/active-satellites"),

    NASA_FIRMS_API_KEY
      ? resolvePublicDomain("fires", TTL.fires, async () => {
          const csvUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${NASA_FIRMS_API_KEY}/VIIRS_SNPP_NRT/world/1`;
          const rawCsv = await fetchText(csvUrl, { timeoutMs: 30000 });
          const lines = rawCsv.trim().split("\n");
          const headers = lines[0].split(",").map((h) => h.trim());
          const fires = lines.slice(1).map((line) => {
            const vals = line.split(",");
            const obj = {};
            headers.forEach((h, i) => {
              const v = vals[i] !== undefined ? vals[i].trim() : null;
              const num = parseFloat(v);
              obj[h] = !isNaN(num) && v !== "" ? num : v;
            });
            return obj;
          }).filter((f) => f.latitude !== null && f.latitude !== undefined);
          return { count: fires.length, source_dataset: "VIIRS_SNPP_NRT", coverage_days: 1, fires };
        }, "nasa-firms/VIIRS_SNPP_NRT")
      : Promise.resolve({
          data: null,
          _meta: { ...offlineMeta("nasa-firms/VIIRS_SNPP_NRT"), error: "NASA_FIRMS_API_KEY not set" },
        }),
  ]);

  // Helper: extract value from Promise.allSettled result
  function settle(r) {
    if (r.status === "fulfilled") return r.value;
    return { data: null, _meta: { ...offlineMeta("unknown"), error: String(r.reason) } };
  }

  sendJSON(res, 200, {
    _fetched_at: fetchedAt.toISOString(),
    _note: "Combined snapshot of all data domains. Each domain has its own _meta block.",
    news:           settle(news),
    markets:        settle(markets),
    conflicts:      settle(conflicts),
    military:       settle(military),
    weather:        settle(weather),
    cyber:          settle(cyber),
    economic:       settle(economic),
    infrastructure: settle(infrastructure),
    predictions:    settle(predictions),
    sanctions:      settle(sanctions),
    earthquakes:    settle(earthquakes),
    aircraft:       settle(aircraft),
    satellites:     settle(satellites),
    fires:          settle(fires),
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ROUTES = [
  // Pattern → handler
  [/^\/api\/news(\?.*)?$/,           handleNews],
  [/^\/api\/markets(\?.*)?$/,        handleMarkets],
  [/^\/api\/conflicts(\?.*)?$/,      handleConflicts],
  [/^\/api\/military(\?.*)?$/,       handleMilitary],
  [/^\/api\/weather(\?.*)?$/,        handleWeather],
  [/^\/api\/cyber(\?.*)?$/,          handleCyber],
  [/^\/api\/economic(\?.*)?$/,       handleEconomic],
  [/^\/api\/infrastructure(\?.*)?$/, handleInfrastructure],
  [/^\/api\/predictions(\?.*)?$/,    handlePredictions],
  [/^\/api\/sanctions(\?.*)?$/,      handleSanctions],
  [/^\/api\/earthquakes(\?.*)?$/,    handleEarthquakes],
  [/^\/api\/aircraft(\?.*)?$/,       handleAircraft],
  [/^\/api\/satellites(\?.*)?$/,     handleSatellites],
  [/^\/api\/fires(\?.*)?$/,          handleFires],
  [/^\/api\/status(\?.*)?$/,         handleStatus],
  [/^\/api\/all(\?.*)?$/,            handleAll],
  // Root — async wrapper so the router can always call .then()
  [/^\/$/, async (req, res) => sendJSON(res, 200, {
    name:    "OpenClaw Data Mirror",
    version: "1.0.0",
    port:    PORT,
    endpoints: [
      "/api/news", "/api/markets", "/api/conflicts", "/api/military",
      "/api/weather", "/api/cyber", "/api/economic", "/api/infrastructure",
      "/api/predictions", "/api/sanctions",
      "/api/earthquakes", "/api/aircraft", "/api/satellites", "/api/fires",
      "/api/status", "/api/all",
    ],
  })],
];

function route(req, res) {
  const reqPath = url.parse(req.url).pathname || req.url;

  // Only GET requests are supported
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJSON(res, 405, { error: "Method Not Allowed" });
  }

  for (const [pattern, handler] of ROUTES) {
    if (pattern.test(req.url)) {
      const start = Date.now();
      const cachedBefore = cache.has(reqPath);
      handler(req, res).then(() => {
        logRequest(req, res.statusCode, cachedBefore);
      }).catch((err) => {
        log("error", `Unhandled error in ${req.url}: ${err.message}`, err.stack);
        if (!res.headersSent) {
          sendJSON(res, 500, { error: "Internal server error", detail: err.message });
        }
      });
      return;
    }
  }

  sendJSON(res, 404, { error: "Not Found", url: req.url });
  logRequest(req, 404, false);
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  try {
    route(req, res);
  } catch (err) {
    log("error", `Fatal route error: ${err.message}`, err.stack);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: "Internal server error", detail: err.message });
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log("info", `OpenClaw Data Mirror listening on http://127.0.0.1:${PORT}`);
  log("info", `WorldMonitor upstream: ${WM_BASE_URL}`);
  log("info", `NASA FIRMS key: ${NASA_FIRMS_API_KEY ? "set" : "NOT SET (fires endpoint disabled)"}`);
  log("info", "Endpoints: /api/{news,markets,conflicts,military,weather,cyber,economic,infrastructure,predictions,sanctions,earthquakes,aircraft,satellites,fires,status,all}");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    log("error", `Port ${PORT} is already in use. Set PORT env var to use a different port.`);
  } else {
    log("error", `Server error: ${err.message}`);
  }
  process.exit(1);
});

function shutdown(signal) {
  log("info", `Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    log("info", "Server closed. Goodbye.");
    process.exit(0);
  });
  // Force exit after 10 seconds if something hangs
  setTimeout(() => {
    log("warn", "Forced exit after 10s timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  log("error", `Uncaught exception: ${err.message}`, err.stack);
  // Keep running — the server should never die
});

process.on("unhandledRejection", (reason) => {
  log("error", `Unhandled promise rejection: ${reason}`);
  // Keep running
});
