// ===============================
// Geomonitor Map Frontend
// ===============================

let activeMarkers = {};
let map;
let crtOverlay = document.createElement("div");
crtOverlay.classList.add("crt-scanlines", "crt-flicker", "crt-colorsep");
document.body.appendChild(crtOverlay);

// Initialize Firebase (MUST come before database usage)
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "geomonitor-2025.firebaseapp.com",
  databaseURL: "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "geomonitor-2025",
  storageBucket: "geomonitor-2025.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
firebase.initializeApp(firebaseConfig);

// ===============================
// 1. Initialize Map
// ===============================
function initMap() {
  map = L.map("map").setView([20, 0], 2);

  window.tileLayers = {
    dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 12,
    }),
    light: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 12,
    }),
  };

  tileLayers.dark.addTo(map);
  setupRealtimeListener();
  console.log("🗺️ Map initialized.");
}

// ===============================
// 2. Colors by topic
// ===============================
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
      return "green";
    case "technology":
    case "tech":
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

// ===============================
// 3. Zoom threshold by importance
// ===============================
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

// ===============================
// 4. Firebase listener
// ===============================
function setupRealtimeListener() {
  const dbRef = firebase.database().ref("/events");

  dbRef.on("value", (snapshot) => {
    const events = snapshot.val();
    if (!events) {
      console.log("⚠️ No events found in database.");
      return;
    }

    Object.values(activeMarkers).forEach(({ marker }) => map.removeLayer(marker));
    activeMarkers = {};

    Object.entries(events).forEach(([key, event]) => {
      if (!event.lat || !event.lon) return;

      const { lat, lon, title, description, topic, importance, url, type } = event;
      const color = getTopicColor(topic);
      const minZoom = getMinZoomForImportance(importance);

      let marker;
      if (type === "Hurricane") {
        const hurricaneIcon = L.icon({
          iconUrl: "assets/hurricane.svg",
          iconSize: [40, 40],
          iconAnchor: [20, 20],
          popupAnchor: [0, -20],
        });
        marker = L.marker([lat, lon], { icon: hurricaneIcon });
      } else {
        marker = L.circleMarker([lat, lon], {
          radius: 7,
          color,
          fillColor: color,
          fillOpacity: 0.85,
          weight: 1.5,
        });
      }

      const popupHTML = `
        <div style="font-family:sans-serif;color:#fff;max-width:250px;">
          <div class="news-title">${title || "Untitled"}</div>
          <div class="news-source">${type || "Unknown Source"}</div>
          <div class="news-topic">Topic: ${topic || "N/A"} | Importance: ${importance || "?"}</div>
          <div class="news-desc">${description || ""}</div>
          ${url ? `<a href="${url}" target="_blank" class="news-link">Read full article →</a>` : ""}
        </div>
      `;

      marker.bindPopup(popupHTML);
      marker.addTo(map);
      activeMarkers[key] = { marker, minZoom };
    });

    updateMarkerVisibility();
    map.on("zoomend", updateMarkerVisibility);
  });
}

// ===============================
// 5. Marker visibility
// ===============================
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

// ===============================
// 6. UI Controls
// ===============================
const controlPanel = document.createElement("div");
controlPanel.className = "control-panel";
controlPanel.innerHTML = `
  <h4>🛰️ GeoMonitor</h4>
  <label><input type="checkbox" id="toggle-dark" checked> Dark Mode</label><br>
  <label><input type="checkbox" id="toggle-hurricanes" checked> Show Hurricanes</label><br>
  <label for="crt-intensity">CRT Intensity</label>
  <input type="range" id="crt-intensity" min="0" max="1" step="0.05" value="0.5">
`;
document.body.appendChild(controlPanel);

document.getElementById("toggle-dark").addEventListener("change", (e) => {
  if (e.target.checked) {
    map.removeLayer(tileLayers.light);
    map.addLayer(tileLayers.dark);
    document.body.classList.remove("light");
  } else {
    map.removeLayer(tileLayers.dark);
    map.addLayer(tileLayers.light);
    document.body.classList.add("light");
  }
});

document.getElementById("toggle-hurricanes").addEventListener("change", (e) => {
  const visible = e.target.checked;
  Object.values(activeMarkers).forEach(({ marker }) => {
    if (marker.options.icon && marker.options.icon.options.iconUrl.includes("hurricane")) {
      if (visible) map.addLayer(marker);
      else map.removeLayer(marker);
    }
  });
});

document.getElementById("crt-intensity").addEventListener("input", (e) => {
  crtOverlay.style.opacity = e.target.value;
});

// ===============================
// Start
// ===============================
initMap();
