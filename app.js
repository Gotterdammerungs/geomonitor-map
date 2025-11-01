// app.js - full, latest version with SVG hurricane icons (colorized)
// Assumes: leaflet + firebase already loaded in the page

// Global variables
let activeMarkers = {};
let map;
let hurricaneLayer;
let darkTiles, lightTiles;

// Path to your SVG icon (put your uploaded file here)
const ICON_PATH = "assets/icons/noun-cyclone-5286192.svg";

// Cache for generated SVG data URLs keyed by color
const svgDataUrlCache = {};

// Utility: create a colorized SVG data URL from an SVG file path
async function getColoredSvgDataUrl(color) {
  // Normalize color key (e.g. '#ff0000' or 'red')
  const key = String(color).toLowerCase();
  if (svgDataUrlCache[key]) return svgDataUrlCache[key];

  try {
    const res = await fetch(ICON_PATH);
    if (!res.ok) throw new Error(`SVG fetch failed: ${res.status}`);
    let svgText = await res.text();

    // Try to inject a fill color:
    // 1) Remove existing fill attributes
    svgText = svgText.replace(/fill="[^"]*"/gi, "");
    svgText = svgText.replace(/fill:\s*[^;"]+;?/gi, "");

    // 2) Add style="fill:COLOR" to <svg ...> tag (or create it)
    svgText = svgText.replace(/<svg([^>]*)>/i, (m, attrs) => {
      // keep existing attrs and append style
      // if there's already a style attr, append; otherwise add one
      if (/style=/i.test(attrs)) {
        return `<svg${attrs.replace(/style="([^"]*)"/i, (m2, s) => `style="${s};fill:${color};"`)}>`;
      } else {
        return `<svg${attrs} style="fill:${color}">`;
      }
    });

    // Ensure width/height or viewBox exist; Leaflet will scale iconSize
    // Encode and return data URL
    const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    svgDataUrlCache[key] = dataUrl;
    return dataUrl;
  } catch (err) {
    console.warn("Could not load/modify SVG icon:", err);
    svgDataUrlCache[key] = null; // cache null so we don't retry heavily
    return null;
  }
}

// Create a Leaflet Icon from a data URL (or returns null on failure)
async function createSvgLeafletIcon(color, size = 36) {
  const dataUrl = await getColoredSvgDataUrl(color);
  if (!dataUrl) return null;
  return L.icon({
    iconUrl: dataUrl,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
    className: "geomonitor-hurricane-icon"
  });
}

// Initialize the map and layers
function initMap() {
  map = L.map('map').setView([20, 0], 2);

  darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors & CARTO',
    subdomains: 'abcd',
    maxZoom: 12,
  }).addTo(map);

  lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors & CARTO',
    subdomains: 'abcd',
    maxZoom: 12,
  });

  // load saved theme
  const savedTheme = localStorage.getItem("theme") || "dark";
  if (savedTheme === "light") {
    map.removeLayer(darkTiles);
    lightTiles.addTo(map);
    document.body.classList.add("light");
    document.body.classList.remove("dark");
  } else {
    map.removeLayer(lightTiles);
    darkTiles.addTo(map);
    document.body.classList.add("dark");
    document.body.classList.remove("light");
  }

  // create hurricane layer
  hurricaneLayer = L.layerGroup();

  // base + overlay control
  const baseMaps = { "🌑 Dark": darkTiles, "🌕 Light": lightTiles };
  const overlays = { "🌀 Hurricanes": hurricaneLayer };
  L.control.layers(baseMaps, overlays, { position: "bottomright" }).addTo(map);

  setupRealtimeListener();

  // initial hurricane fetch + periodic
  fetchHurricanes();
  setInterval(fetchHurricanes, 15 * 60 * 1000); // 15 minutes
}

// Topic color helper (for news markers)
function getTopicColor(topic) {
  topic = (topic || "").toLowerCase();
  switch (topic) {
    case "geopolitics":
    case "conflict":
    case "diplomacy":
    case "security":
      return "red";
    case "economy":
    case "finance":
      return "limegreen";
    case "technology":
    case "cyber":
    case "science":
      return "deepskyblue";
    case "environment":
    case "disaster":
    case "energy":
      return "orange";
    default:
      return "white";
  }
}

// Importance to minimum zoom
function getMinZoomForImportance(importance) {
  switch (parseInt(importance)) {
    case 5: return 0;
    case 4: return 3;
    case 3: return 5;
    case 2: return 7;
    case 1:
    default: return 9;
  }
}

// Firebase news listener (keeps original behaviour)
function setupRealtimeListener() {
  const dbRef = firebase.database().ref('/events');

  const clearMarkers = () => {
    Object.values(activeMarkers).forEach(({ marker }) => {
      try { map.removeLayer(marker); } catch (e) { /* ignore */ }
    });
    activeMarkers = {};
  };

  dbRef.on('value', (snapshot) => {
    clearMarkers();
    const events = snapshot.val();
    if (!events) {
      console.log("⚠️ No events found in database.");
      return;
    }

    console.log(`📡 Received ${Object.keys(events).length} events.`);
    Object.entries(events).forEach(([key, event]) => {
      if (!event.lat || !event.lon) return;

      const { lat, lon, title, description, type, importance, topic, url } = event;
      const color = getTopicColor(topic);
      const minZoom = getMinZoomForImportance(importance);

      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1.5
      });

      const popupHTML = `
        <div style="font-family:sans-serif;color:#fff;max-width:260px;">
          <div style="font-weight:600;font-size:15px;margin-bottom:4px;">${title || "Untitled"}</div>
          <div style="font-size:12px;color:#9ca3af;margin-bottom:6px;">${type || "Unknown Source"}</div>
          <div style="font-size:13px;margin-bottom:6px;">Topic: ${topic || "N/A"} | Priority: ${importance || "?"}</div>
          <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px;">${description || ""}</div>
          ${url ? `<a href="${url}" target="_blank" style="color:#60a5fa;font-weight:600;">Read full article →</a>` : ""}
        </div>
      `;

      marker.bindPopup(popupHTML);
      activeMarkers[key] = { marker, minZoom };
      marker.addTo(map);
    });

    updateMarkerVisibility();
    map.on("zoomend", updateMarkerVisibility);
  });
}

function updateMarkerVisibility() {
  const zoom = map.getZoom();
  Object.values(activeMarkers).forEach(({ marker, minZoom }) => {
    if (zoom >= minZoom) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

// Map of GDACS alert -> color to use for icons
const ALERT_COLOR_MAP = {
  red: "#ff4d4d",
  orange: "#ff9a3c",
  yellow: "#ffd24d",
  green: "#7dd36b",
  default: "#ffd24d"
};

// Fetch GDACS tropical cyclone GeoJSON and display icon at latest report position
async function fetchHurricanes() {
  const GDACS_URL = "https://www.gdacs.org/gdacsapi/api/eventsgeojson?eventtype=TC";
  try {
    console.log("🌪️ Fetching GDACS hurricane data...");
    const res = await fetch(GDACS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`GDACS fetch failed: ${res.status}`);
    const data = await res.json();

    // clear previous hurricane markers
    hurricaneLayer.clearLayers();

    // For each active feature, place one icon at its reported coordinate
    // GDACS feature.geometry.coordinates is [lon, lat]
    for (const feature of data.features) {
      const geometry = feature.geometry;
      const props = feature.properties || {};
      if (!geometry || !geometry.coordinates) continue;
      const [lon, lat] = geometry.coordinates;
      const name = props.eventname || "Unnamed Cyclone";
      // gdacs uses "alertlevel" string typically 'green','orange','red' maybe 'yellow'
      const alert = (props.alertlevel || "default").toLowerCase();
      const color = ALERT_COLOR_MAP[alert] || ALERT_COLOR_MAP.default;
      const dateStr = props.fromdate || props.updated || "";
      const url = props.eventid
        ? `https://www.gdacs.org/report.aspx?eventid=${props.eventid}&eventtype=TC`
        : "https://www.gdacs.org/";
      const location = props.country || props.region || "Unknown region";

      // Try to create an SVG icon colored for this alert level
      let icon = null;
      try {
        icon = await createSvgLeafletIcon(color, 36);
      } catch (err) {
        console.warn("SVG icon create error:", err);
      }

      // Fallback to circle marker if SVG icon unavailable
      if (icon) {
        const marker = L.marker([lat, lon], { icon })
          .bindPopup(`
            <div style="font-family:sans-serif;color:#fff;max-width:260px;">
              <div style="font-weight:700;font-size:15px;margin-bottom:6px;">🌀 ${escapeHtml(name)}</div>
              <div style="margin-bottom:4px;">Alert: <b style="color:${color};text-transform:uppercase;">${escapeHtml(alert)}</b></div>
              <div style="margin-bottom:4px;">Region: ${escapeHtml(location)}</div>
              <div style="margin-bottom:6px;">Updated: ${dateStr ? new Date(dateStr).toLocaleString() : "Unknown"}</div>
              <a href="${url}" target="_blank" style="color:#60a5fa;font-weight:600;">Open GDACS report →</a>
            </div>
          `);
        hurricaneLayer.addLayer(marker);
      } else {
        // circle marker fallback
        const fallback = L.circleMarker([lat, lon], {
          radius: 10, color, fillColor: color, fillOpacity: 0.85, weight: 2
        }).bindPopup(`
          <div style="font-family:sans-serif;color:#fff;max-width:260px;">
            <div style="font-weight:700;font-size:15px;margin-bottom:6px;">🌀 ${escapeHtml(name)}</div>
            <div style="margin-bottom:4px;">Alert: <b style="color:${color};text-transform:uppercase;">${escapeHtml(alert)}</b></div>
            <div style="margin-bottom:4px;">Region: ${escapeHtml(location)}</div>
            <div style="margin-bottom:6px;">Updated: ${dateStr ? new Date(dateStr).toLocaleString() : "Unknown"}</div>
            <a href="${url}" target="_blank" style="color:#60a5fa;font-weight:600;">Open GDACS report →</a>
          </div>
        `);
        hurricaneLayer.addLayer(fallback);
      }
    }

    console.log(`✅ GDACS: displayed ${data.features.length} cyclones.`);
  } catch (err) {
    console.error("❌ Failed to fetch/display GDACS data:", err);
  }
}

// Simple HTML escape helper for popup safety
function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Start up
initMap();
