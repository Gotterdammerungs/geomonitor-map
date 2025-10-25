// Global variables
let activeMarkers = {}; // Stores markers currently on the map
let map;

// 1. Initialize the Map
function initMap() {
    // Create map centered on the world
    map = L.map('map').setView([20, 0], 2); // Center: near the equator, Zoom: 2 (world view)

    // Add a dark, satellite-style base layer (using CARTO's dark map tiles)
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
    // Reference the 'events' node in your Firebase database
    const dbRef = firebase.database().ref('/events');
    
    // Function to clear all existing markers from the map
    const clearMarkers = () => {
        Object.values(activeMarkers).forEach(marker => map.removeLayer(marker));
        activeMarkers = {};
    };

    // This runs EVERY time data changes in Firebase (the 'real-time' magic!)
    dbRef.on('value', (snapshot) => {
        clearMarkers(); // Clear old data to prevent duplication

        const events = snapshot.val();
        if (events) {
            console.log(`Received ${Object.keys(events).length} events from Firebase.`);
            
            Object.entries(events).forEach(([key, event]) => {
                // Check for required location data
                if (event.lat && event.lon) {
                    const lat = event.lat;
                    const lon = event.lon;
                    
                    // Customize the popup content with event details
                    const popupContent = `
                        <div style="font-family: sans-serif; font-size: 14px; color: #000;">
                            <b>${event.title || 'Unknown Event'}</b><br>
                            <span style="color: #c90">${event.type || 'N/A'}</span>, Severity: ${event.severity || 'N/A'}<br>
                            Description: ${event.description || ''}
                        </div>
                    `;
                    
                    // Create a marker and add it to the map
                    const marker = L.marker([lat, lon]).addTo(map)
                        .bindPopup(popupContent)
                        .openPopup(); 
                        
                    // Store the marker
                    activeMarkers[key] = marker;
                }
            });
            
            // For the test, center the map on the test event (New York)
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
