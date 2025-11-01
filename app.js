let activeMarkers = {};
let map;
let darkTiles, lightTiles;

function initMap() {
  // Initialize map and base layers
  map = L.map('map').setView([20, 0], 2);

  darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 12,
  });

  lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 12,
  });

  // Load preferred theme tiles
  const savedTheme = localStorage.getItem("theme") || "dark";
  if (savedTheme === "light") {
    lightTiles.addTo(map);
  } else {
    darkTiles.addTo(map);
  }

  setupRealtimeListener();
  setupPanelControls();
}

// ------------- Topic Colors -------------
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

// ------------- Firebase Data -------------
function setupRealtimeListener() {
  const dbRef = firebase.database().ref('/events');
  const clearMarkers = () => { Object.values(activeMarkers).forEach(({ marker }) => map.removeLayer(marker)); activeMarkers = {}; };

  dbRef.on('value', (snapshot) => {
    clearMarkers();
    const events = snapshot.val();
    if (!events) return;

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
          <div class="news-topic">Topic: ${topic || "N/A"} | Importance: ${importance || "?"}</div>
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

// ------------- Panel Controls -------------
function setupPanelControls() {
  const panelToggle = document.getElementById("panel-toggle");
  const panel = document.getElementById("panel");
  const themeBtn = document.getElementById("theme-toggle");
  const crtSlider = document.getElementById("crt-intensity");

  panelToggle.addEventListener("click", () => panel.classList.toggle("hidden"));

  // Restore and update CRT intensity
  let crtValue = parseFloat(localStorage.getItem("crt_intensity") || "0.5");
  crtSlider.value = crtValue;
  document.documentElement.style.setProperty("--crt-opacity", crtValue);

  crtSlider.addEventListener("input", e => {
    const val = parseFloat(e.target.value);
    localStorage.setItem("crt_intensity", val.toFixed(2));
    document.documentElement.style.setProperty("--crt-opacity", val);
    document.body.style.setProperty("--crt-opacity", val);
  });

  // Theme toggle (switch tiles)
  themeBtn.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark");
    document.body.classList.toggle("dark", !isDark);
    document.body.classList.toggle("light", isDark);
    localStorage.setItem("theme", isDark ? "light" : "dark");

    if (isDark) {
      map.removeLayer(darkTiles);
      lightTiles.addTo(map);
      themeBtn.textContent = "☀️ Light Mode";
    } else {
      map.removeLayer(lightTiles);
      darkTiles.addTo(map);
      themeBtn.textContent = "🌙 Dark Mode";
    }
  });

  // Restore theme preference
  const savedTheme = localStorage.getItem("theme") || "dark";
  document.body.classList.toggle("dark", savedTheme === "dark");
  document.body.classList.toggle("light", savedTheme === "light");
  themeBtn.textContent = savedTheme === "dark" ? "🌙 Dark Mode" : "☀️ Light Mode";
}

initMap();
