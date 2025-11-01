let activeMarkers = {};
let map;

function initMap() {
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: 'abcd',
    maxZoom: 12,
  }).addTo(map);

  console.log("🗺️ Map initialized.");
  setupRealtimeListener();
  setupPanelControls();
}

function getTopicColor(topic) {
  topic = (topic || "").toLowerCase();
  switch (topic) {
    case "geopolitics": case "conflict": case "diplomacy": case "security": return "red";
    case "economy": case "finance": return "limegreen";
    case "technology": case "cyber": case "science": return "deepskyblue";
    case "environment": case "disaster": case "energy": return "orange";
    default: return "white";
  }
}

function getMinZoomForImportance(importance) {
  const imp = parseInt(importance) || 3;
  return {5:0,4:3,3:5,2:7,1:9}[imp] ?? 9;
}

function setupRealtimeListener() {
  const dbRef = firebase.database().ref('/events');
  const clearMarkers = () => { Object.values(activeMarkers).forEach(({ marker }) => map.removeLayer(marker)); activeMarkers = {}; };

  dbRef.on('value', (snapshot) => {
    clearMarkers();
    const events = snapshot.val();
    if (!events) return console.log("⚠️ No events found.");

    Object.entries(events).forEach(([key, event]) => {
      if (!event.lat || !event.lon) return;
      const { lat, lon, title, description, type, importance, topic, url } = event;

      const color = getTopicColor(topic);
      const minZoom = getMinZoomForImportance(importance);

      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        color, fillColor: color, fillOpacity: 0.85, weight: 1.5
      });

      const popupHTML = `
        <div>
          <div class="news-title">${title || "Untitled"}</div>
          <div class="news-source">${type || "Unknown Source"}</div>
          <div class="news-topic">Topic: ${topic || "N/A"} | Priority: ${importance || "?"}</div>
          <div class="news-desc">${description || ""}</div>
          ${url ? `<a href="${url}" target="_blank" class="news-link">Read full article →</a>` : ""}
        </div>`;
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
    } else if (map.hasLayer(marker)) map.removeLayer(marker);
  });
}

// === Panel + Toggles ===
function setupPanelControls() {
  const panelToggle = document.getElementById("panel-toggle");
  const panel = document.getElementById("panel");
  const crtBtn = document.getElementById("crt-toggle");
  const themeBtn = document.getElementById("theme-toggle");

  panelToggle.addEventListener("click", () => panel.classList.toggle("hidden"));

  // CRT toggle
  crtBtn.addEventListener("click", () => {
    document.body.classList.toggle("crt");
    const enabled = document.body.classList.contains("crt");
    crtBtn.textContent = enabled ? "🧠 CRT Mode: ON" : "💡 CRT Mode: OFF";
    localStorage.setItem("crt_enabled", enabled ? "1" : "0");
  });

  // Theme toggle
  themeBtn.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark");
    document.body.classList.toggle("dark", !isDark);
    document.body.classList.toggle("light", isDark);
    themeBtn.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
    localStorage.setItem("theme", isDark ? "light" : "dark");
  });

  // Restore preferences
  if (localStorage.getItem("crt_enabled") === "0") {
    document.body.classList.remove("crt");
    crtBtn.textContent = "💡 CRT Mode: OFF";
  }
  const savedTheme = localStorage.getItem("theme") || "dark";
  document.body.classList.toggle("dark", savedTheme === "dark");
  document.body.classList.toggle("light", savedTheme === "light");
  themeBtn.textContent = savedTheme === "dark" ? "🌙 Dark Mode" : "☀️ Light Mode";
}

initMap();
