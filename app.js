// Global variables
let activeMarkers = {}; 
let map;

// 1. Initialize the Map
function initMap() {
    // Create map centered on the world
    map = L.map('map').setView([20, 0], 2); 

    // Add a dark, satellite-style base layer (free/open source)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    console.log("Map initialized and dark theme applied.");
    
    // Start listening for data immediately after map is ready
    setupRealtimeListener();
}

// 2. Setup Real-Time Listener
function setupRealtimeListener() {
    const dbRef = firebase.database().ref('/events');
    
    const clearMarkers = () => {
        Object.values(activeMarkers).forEach(marker => map.removeLayer(marker));
        activeMarkers = {};
    };

    dbRef.on('value', (snapshot) => {
        clearMarkers(); 

        const events = snapshot.val();
        if (events) {
            console.log(`Received ${Object.keys(events).length} events from Firebase.`);
            
            Object.entries(events).forEach(([key, event]) => {
                if (event.lat && event.lon) {
                    const lat = event.lat;
                    const lon = event.lon;
                    
                    const popupContent = `
                        <b>${event.title || 'Unknown Event'}</b><br>
                        Type: ${event.type || 'N/A'}<br>
                        Severity: ${event.severity || 'N/A'}<br>
                        Description: ${event.description || ''}
                    `;
                    
                    const marker = L.marker([lat, lon]).addTo(map)
                        .bindPopup(popupContent)
                        .openPopup();
                        
                    activeMarkers[key] = marker;
                }
            });
            
            // Center the map on the test event (New York) and zoom in
            map.setView([40.7128, -74.0060], 10); 
            
        } else {
            console.log("No events found in the database.");
        }
    }, (error) => {
         console.error("Firebase connection error:", error.message);
    });
}

// Start the whole Geomonitor process
initMap();
