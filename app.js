// ============================
// 🌍 GEOMONITOR MAP FRONTEND
// ============================

let activeMarkers = {};
let map;

// 1. Initialize the Map
function initMap() {
  map = L.map('map').setView([20, 0], 2);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 12,
  }).addTo(map);

  console.log("🗺️ Map initialized.");
  setupRealtimeListener();
  setupLegendToggle();
}

// 2. Define colors by topic
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

// 3. Visibility by importance (zoom threshold)
function getMinZoomForImportance(importance) {
  const imp = parseInt(importance) || 3;
  switch (imp) {
    case 5: return 0;
    case 4: return 3;
    case 3: return 5;
    case 2: return 7;
    case 1:
    default: return 9;
  }
}

// 4. Firebase Realtime listener
function setupRealtimeListener() {
  const dbRef = firebase.database().ref('/events');

  const clearMarkers = () => {
    Object.values(activeMarkers).forEach(({ marker }) => map.removeLayer(marker));
    activeMarkers = {};
  };

  dbRef.on('value', (snapshot) => {
    clearMarkers();
    const events = snapshot.val();
    if (!events) {
      console.log("⚠️ No events found in database.");
      return;
    }

    const count = Object.keys(events).length;
    console.log(`📡 Received ${count} event${count !== 1 ? "s" : ""}.`);

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
        <div>
          <div class="news-title">${title || "Untitled"}</div>
          <div class="news-source">${type || "Unknown Source"}</div>
          <div class="news-topic">Topic: ${topic || "N/A"} | Priority: ${importance || "?"}</div>
          <div class="news-desc">${description || ""}</div>
          ${url ? `<a href="${url}" target="_blank" class="news-link">Read full article →</a>` : ""}
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

// 5. Show/hide markers based on zoom level
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

// 6. Toggleable Legend
function setupLegendToggle() {
  const toggleBtn = document.getElementById("legend-toggle");
  const legend = document.getElementById("legend");
  toggleBtn.addEventListener("click", () => {
    legend.classList.toggle("hidden");
  });
}

// 7. Start
initMap();
