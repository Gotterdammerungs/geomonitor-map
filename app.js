console.log("🛰️ Geomonitor starting up...");
console.log("ℹ️ Verbose diagnostics enabled.");

window.addEventListener("DOMContentLoaded", async () => {
  console.log("loading...");

  // Temporary debug to verify the MapTiler key
  try {
    console.log("🔑 MAPTILER_KEY value:", typeof MAPTILER_KEY !== 'undefined' ? MAPTILER_KEY : 'undefined');
    if (typeof MAPTILER_KEY === 'undefined' || MAPTILER_KEY === 'YOUR_MAPTILER_API_KEY_HERE' || !MAPTILER_KEY) {
      console.warn("⚠️ MAPTILER_KEY missing or still placeholder. Using fallback tiles.");
    } else {
      const testUrl = `https://api.maptiler.com/maps/darkmatter/2/1/1.png?key=${MAPTILER_KEY}`;
      const res = await fetch(testUrl);
      console.log("🧪 MapTiler test status:", res.status);
      if (res.status !== 200) {
        console.warn("⚠️ MapTiler key rejected (status", res.status, "). Using fallback tiles.");
      }
    }
  } catch (e) {
    console.error("Key test error:", e);
  }

  initMap();
});

function initMap() {
  console.log("initializing map...");

  const hasKey =
    typeof MAPTILER_KEY !== "undefined" &&
    MAPTILER_KEY &&
    MAPTILER_KEY !== "YOUR_MAPTILER_API_KEY_HERE";

  const tileSources = hasKey
    ? {
        dark: {
          name: "MapTiler Dark",
          url: `https://api.maptiler.com/maps/darkmatter/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
        },
        light: {
          name: "MapTiler Light",
          url: `https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
        },
      }
    : {
        dark: {
          name: "Carto Dark",
          url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        },
        light: {
          name: "Carto Light",
          url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        },
      };

  console.log(
    "Available tile themes:",
    Object.keys(tileSources).join(", ")
  );

  const map = L.map("map").setView([20, 0], 2);
  const layer = L.tileLayer(tileSources.dark.url, {
    attribution:
      hasKey
        ? '© <a href="https://www.maptiler.com/">MapTiler</a> © <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
        : '© <a href="https://carto.com/">Carto</a>',
  });

  layer.addTo(map);
  console.log(
    "Tile layer added:",
    "dark ->",
    tileSources.dark.name
  );
  console.log("map loaded (" + tileSources.dark.name + ")");
}
