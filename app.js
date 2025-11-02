let map, darkTiles, lightTiles, hurricaneLayer;
let activeMarkers = {};

function initMap() {
  map = L.map('map').setView([20, 0], 2);

  darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors & CARTO',
    subdomains: 'abcd',
    maxZoom: 12
  }).addTo(map);

  lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors & CARTO',
    subdomains: 'abcd',
    maxZoom: 12
  });

  hurricaneLayer = L.layerGroup().addTo(map);

  setupRealtimeListener();
  setupHurricaneListener();
}

// --- Theme toggle ---
document.getElementById("themeToggle").addEventListener("change", (e) => {
  if (e.target.checked) {
    document.body.classList.add("dark");
    document.body.classList.remove("light");
    map.removeLayer(lightTiles);
    darkTiles.addTo(map);
  } else {
    document.body.classList.add("light");
    document.body.classList.remove("dark");
    map.removeLayer(darkTiles);
    lightTiles.addTo(map);
  }
});

// --- CRT slider ---
document.getElementById("crtIntensity").addEventListener("input", (e) => {
  const value = e.target.value;
  document.documentElement.style.setProperty("--crt-opacity", value);
});

// --- Hurricanes ---
document.getElementById("hurricaneToggle").addEventListener("change", (e) => {
  if (e.target.checked) map.addLayer(hurricaneLayer);
  else map.removeLayer(hurricaneLayer);
});

function setupHurricaneListener() {
  const dbRef = firebase.database().ref('/hurricanes');
  dbRef.on('value', (snapshot) => {
    hurricaneLayer.clearLayers();
    const hurricanes = snapshot.val();
    if (!hurricanes) return;
    Object.values(hurricanes).forEach(h => {
      const color =
        h.alertlevel === "red" ? "#ff5555" :
        h.alertlevel === "orange" ? "#ffae42" :
        h.alertlevel === "yellow" ? "#ffd93d" : "#7dd36b";

      const icon = L.icon({
        iconUrl: "assets/icons/noun-cyclone-5286192.svg",
        iconSize: [36, 36],
      });

      const popup = `
        <div>
          <b>${h.name}</b><br>
          <small>${h.country}</small><br>
          <b style="color:${color}">${h.alertlevel.toUpperCase()}</b><br>
          <a href="${h.url}" target="_blank">View on GDACS →</a>
        </div>
      `;
      L.marker([h.lat, h.lon], { icon }).bindPopup(popup).addTo(hurricaneLayer);
    });
    console.log(`🌪️ Loaded ${Object.keys(hurricanes).length} hurricanes.`);
  });
}

// --- News listener ---
function setupRealtimeListener() {
  const dbRef = firebase.database().ref('/events');
  dbRef.on('value', (snapshot) => {
    const events = snapshot.val();
    if (!events) return;

    Object.values(activeMarkers).forEach(m => map.removeLayer(m));
    activeMarkers = {};

    for (const [key, event] of Object.entries(events)) {
      const { lat, lon, title, description, type, importance, topic, url } = event;
      if (!lat || !lon) continue;

      const color = getTopicColor(topic);
      const minZoom = getMinZoom(importance);

      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 1.5
      });

      const popup = `
        <div>
          <b>${title}</b><br>
          ${description}<br>
          <small>${type}</small><br>
          <a href="${url}" target="_blank">Read →</a>
        </div>
      `;

      marker.bindPopup(popup);
      activeMarkers[key] = { marker, minZoom };
      marker.addTo(map);
    }
  });
}

function getTopicColor(t) {
  switch ((t || "").toLowerCase()) {
    case "geopolitics": return "red";
    case "finance": return "green";
    case "tech": return "deepskyblue";
    case "disaster": return "orange";
    case "science": return "violet";
    default: return "white";
  }
}

function getMinZoom(i) {
  return i >= 5 ? 0 : i === 4 ? 3 : i === 3 ? 5 : i === 2 ? 7 : 9;
}

initMap();
