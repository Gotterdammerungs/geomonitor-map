// app.js — Robust Geomonitor frontend (verbose + fallback tiles)
// Replace your current app.js with this file. No workflow changes required.
// This will NOT crash if MAPTILER_KEY is missing; it falls back to Carto tiles.

// ---------------------- Startup ----------------------
console.log("🛰️ Geomonitor starting up...");
console.log("ℹ️ Verbose diagnostics enabled.");

// ---------------------- Globals ----------------------
let map;
let activeMarkers = {};
let tileLayer = null;
let currentTheme = (document.body.getAttribute("data-theme") || "dark");
const statusEl = () => document.getElementById("status-text");

// Read MAPTILER_KEY from page if present (index.html may provide it)
let MAPTILER_KEY_VALUE = (typeof MAPTILER_KEY !== "undefined") ? MAPTILER_KEY : null;

// ---------------------- Helpers ----------------------
function logStatus(msg) {
  try { if (statusEl()) statusEl().textContent = msg; } catch (e) {}
  console.log(msg);
}

function verboseError(msg, err) {
  console.error(msg, err || "");
  logStatus(msg);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[m]);
}

function escapeAttr(s) {
  return String(s || "").replace(/"/g, "%22");
}

// ---------------------- Tile source configuration ----------------------
function getTileSources(maptilerKey) {
  // Carto (free) fallback tiles:
  const carto = {
    dark: {
      name: "Carto Dark",
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    },
    light: {
      name: "Carto Light",
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  };

  if (!maptilerKey || typeof maptilerKey !== "string" || maptilerKey.includes("PLACEHOLDER")) {
    console.warn("⚠️ MapTiler key missing or placeholder detected — using Carto fallback tiles.");
    return {
      dark: carto.dark,
      light: carto.light
    };
  }

  const base = "https://api.maptiler.com/maps";
  return {
    dark: {
      name: "MapTiler Dark",
      url: `${base}/darkmatter/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`,
      attribution: '&copy; OpenStreetMap contributors & MapTiler'
    },
    light: {
      name: "MapTiler Light",
      url: `${base}/basic/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`,
      attribution: '&copy; OpenStreetMap contributors & MapTiler'
    },
    solarized: {
      name: "MapTiler Solarized",
      url: `${base}/solarized-dark/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`,
      attribution: '&copy; OpenStreetMap contributors & MapTiler'
    },
    satellite: {
      name: "MapTiler Satellite",
      url: `${base}/satellite/{z}/{x}/{y}.jpg?key=${encodeURIComponent(maptilerKey)}`,
      attribution: '&copy; OpenStreetMap contributors & MapTiler'
    }
  };
}

// ---------------------- Topic color (theme-aware) ----------------------
function getTopicColor(topic) {
  const t = (topic || "").toLowerCase();
  const isLight = (currentTheme === "light" || currentTheme === "satellite");
  const defaultDot = isLight ? "#000000" : "#ffffff";

  if (["geopolitics", "conflict", "diplomacy", "security"].includes(t)) return "#ef4444";
  if (["economy", "finance"].includes(t)) return "#22c55e";
  if (["technology", "cyber", "science"].includes(t)) return "#0ea5e9";
  if (["environment", "disaster", "energy"].includes(t)) return "#fb923c";
  return defaultDot;
}

// ---------------------- Importance -> zoom ----------------------
function getMinZoomForImportance(importance) {
  const imp = parseInt(importance) || 3;
  switch (imp) {
    case 5: return 0;
    case 4: return 3;
    case 3: return 5;
    case 2: return 7;
    default: return 9;
  }
}

// ---------------------- Initialize Map ----------------------
function initMap() {
  logStatus("loading...");
  console.log("initializing map...");

  // Determine tile sources using current MAPTILER_KEY_VALUE
  const tiles = getTileSources(MAPTILER_KEY_VALUE);

  // If MapTiler key present, we will include MapTiler themes too
  const availableThemes = Object.keys(tiles);
  console.log("Available tile themes:", availableThemes.join(", "));

  // Create map
  map = L.map("map", { preferCanvas: true }).setView([20, 0], 2);

  // Add the initial tile layer (use currentTheme if available, else fallback)
  const initialTheme = availableThemes.includes(currentTheme) ? currentTheme : availableThemes[0];
  try {
    tileLayer = L.tileLayer(tiles[initialTheme].url, {
      attribution: tiles[initialTheme].attribution,
      maxZoom: 12
    }).addTo(map);
    console.log(`Tile layer added: ${initialTheme} -> ${tiles[initialTheme].name}`);
    logStatus(`map loaded (${tiles[initialTheme].name})`);
  } catch (err) {
    verboseError("Failed to add tile layer, see error:", err);
    logStatus("tile init failed — see console");
  }

  // Attach listeners, controls
  setupRealtimeListener();
  setupPanelControls(tiles);
}

// ---------------------- Firebase listener ----------------------
function setupRealtimeListener() {
  console.log("setting up Firebase realtime listener...");
  logStatus("connecting to Firebase...");

  try {
    const dbRef = firebase.database().ref("/events");
    dbRef.on("value", (snapshot) => {
      const events = snapshot.val();
      if (!events) {
        console.warn("Firebase returned no events.");
        logStatus("no events");
        return;
      }
      console.log(`Firebase: got ${Object.keys(events).length} events.`);
      renderMarkers(events);
    }, (err) => {
      verboseError("Firebase listener error:", err);
      logStatus("firebase error");
    });
  } catch (err) {
    verboseError("Failed to set up Firebase listener:", err);
    logStatus("firebase init failed");
  }
}

// ---------------------- Render markers ----------------------
function renderMarkers(events) {
  // Remove previous markers
  Object.values(activeMarkers).forEach(({ marker }) => {
    if (map.hasLayer(marker)) map.removeLayer(marker);
  });
  activeMarkers = {};

  Object.entries(events).forEach(([key, e]) => {
    if (!e || !e.lat || !e.lon) return;
    const color = getTopicColor(e.topic);
    const minZoom = getMinZoomForImportance(e.importance);

    const marker = L.circleMarker([e.lat, e.lon], {
      radius: 7,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 1.5
    });
    marker.options._topic = e.topic || "other";

    const popupHTML = `
      <div style="font-family:system-ui, sans-serif; max-width:260px; color:inherit;">
        <div style="font-weight:700; margin-bottom:6px;">${escapeHtml(e.title || "Untitled")}</div>
        <div style="font-size:12px;color:grey;margin-bottom:6px;">${escapeHtml(e.type || "Source")}</div>
        <div style="font-size:13px;color:grey;margin-bottom:8px;">Topic: ${escapeHtml(e.topic || "N/A")} | Importance: ${escapeHtml(e.importance ? String(e.importance) : "?")}</div>
        <div style="font-size:13px;color:inherit;">${escapeHtml(e.description || "")}</div>
        ${e.url ? `<div style="margin-top:8px;"><a href="${escapeAttr(e.url)}" target="_blank" rel="noopener noreferrer">Read full article →</a></div>` : ""}
      </div>
    `;
    marker.bindPopup(popupHTML);
    activeMarkers[key] = { marker, minZoom };
    marker.addTo(map);
  });

  console.log(`Rendered ${Object.keys(activeMarkers).length} markers.`);
  updateMarkerVisibility();
  map.on("zoomend", updateMarkerVisibility);
  logStatus(`${Object.keys(activeMarkers).length} events displayed`);
}

// ---------------------- Visibility ----------------------
function updateMarkerVisibility() {
  const zoom = map.getZoom();
  Object.values(activeMarkers).forEach(({ marker, minZoom }) => {
    if (zoom >= minZoom) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
  console.log(`Updated marker visibility at zoom ${zoom}.`);
}

// ---------------------- Theme change ----------------------
function changeTheme(theme, tiles) {
  const available = Object.keys(tiles);
  if (!available.includes(theme)) {
    console.warn(`Theme "${theme}" not available for current tile set. Available: ${available.join(", ")}`);
    theme = available[0];
  }
  currentTheme = theme;
  document.body.setAttribute("data-theme", theme);

  if (tileLayer) try { map.removeLayer(tileLayer); } catch (e) {}

  tileLayer = L.tileLayer(tiles[theme].url, { attribution: tiles[theme].attribution, maxZoom: 12 }).addTo(map);
  console.log(`Theme switched to ${theme} -> ${tiles[theme].name}`);

  // recolor markers for light/dark
  Object.values(activeMarkers).forEach(({ marker }) => {
    const topic = marker.options._topic || "other";
    const c = getTopicColor(topic);
    marker.setStyle({ color: c, fillColor: c });
  });

  logStatus(`theme: ${theme}`);
}

// ---------------------- Panel controls ----------------------
function setupPanelControls(tiles) {
  // Ensure DOM elements exist
  const toggle = document.getElementById("gm-panel-toggle");
  const panel = document.getElementById("gm-panel");
  const selector = document.getElementById("gm-theme-selector");
  const slider = document.getElementById("crt-intensity");

  if (!toggle || !panel || !selector || !slider) {
    console.warn("Control panel DOM missing. Skipping control wiring.");
    return;
  }

  // Wire toggle robustly
  function togglePanel(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const hidden = panel.classList.toggle("gm-hidden");
    toggle.setAttribute("aria-expanded", (!hidden).toString());
  }
  ["pointerdown", "mousedown", "click", "touchstart"].forEach(ev => toggle.addEventListener(ev, togglePanel, { passive: false }));

  // Populate theme selector with available tiles
  selector.innerHTML = Object.keys(tiles).map(k => `<option value="${k}" ${k === currentTheme ? "selected": ""}>${tiles[k].name}</option>`).join("");
  selector.addEventListener("change", (ev) => changeTheme(ev.target.value, tiles));

  // CRT slider initialization
  const stored = parseFloat(localStorage.getItem("gm_crt") || "0.45");
  slider.value = stored;
  document.documentElement.style.setProperty("--crt-opacity", stored);
  slider.addEventListener("input", (ev) => {
    const v = ev.target.value;
    document.documentElement.style.setProperty("--crt-opacity", v);
    localStorage.setItem("gm_crt", String(v));
  });

  // Close when clicking outside
  document.addEventListener("pointerdown", (ev) => {
    if (!panel.contains(ev.target) && !toggle.contains(ev.target)) {
      if (!panel.classList.contains("gm-hidden")) {
        panel.classList.add("gm-hidden");
        toggle.setAttribute("aria-expanded", "false");
      }
    }
  }, { passive: true });

  console.log("Control panel wired (robust).");
}

// ---------------------- Start on DOM ready ----------------------
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded — starting initialization.");

  // If MAPTILER_KEY_VALUE present, log masked form; else log fallback
  if (MAPTILER_KEY_VALUE && !MAPTILER_KEY_VALUE.includes("PLACEHOLDER")) {
    const masked = MAPTILER_KEY_VALUE.slice(0, 8) + "..." + MAPTILER_KEY_VALUE.slice(-4);
    console.log(`🔒 MapTiler key detected (masked): ${masked}`);
    logStatus("MapTiler key detected — using MapTiler tiles");
  } else {
    console.warn("⚠️ No MapTiler key detected on page. Using fallback Carto tiles — map will still work.");
    logStatus("No MapTiler key — using fallback tiles");
  }

  try {
    initMap();
    console.log("Initialization finished (no fatal error).");
  } catch (err) {
    verboseError("Fatal initialization error:", err);
    logStatus("initialization failed — see console");
  }
});
