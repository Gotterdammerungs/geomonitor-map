import time
import random
import os
from firebase import firebase

# --- CONFIGURATION ---
# IMPORTANT: The script now reads the Firebase URL from a GitHub Secret (FIREBASE_URL)
# This is how we keep the data secure and flexible.
FIREBASE_URL = os.environ.get('FIREBASE_URL')

# Time in seconds between updates (set to 0, as the schedule is controlled by GitHub Actions)
UPDATE_INTERVAL_SECONDS = 0 

# --- FIREBASE SETUP ---
if not FIREBASE_URL:
    print("FATAL ERROR: FIREBASE_URL environment variable is not set. Check GitHub Secrets.")
    exit(1)

try:
    # Connect to Firebase
    db = firebase.FirebaseApplication(FIREBASE_URL, None)
    print(f"Successfully connected to Firebase at {FIREBASE_URL}")
except Exception as e:
    print(f"Error connecting to Firebase: {e}")
    exit(1)

# --- HELPER FUNCTIONS ---

def generate_random_event():
    """Generates a plausible, random event for demonstration."""
    
    # Random location anywhere in the world
    lat = round(random.uniform(-80, 80), 4)
    lon = round(random.uniform(-180, 180), 4)

    # Randomly select a type and severity
    event_types = ["Seismic Activity", "Weather Anomaly", "Infrastructure Alert", "Wildlife Sighting", "General Monitoring"]
    severities = ["Low", "Moderate", "High"]
    
    event_type = random.choice(event_types)
    severity = random.choice(severities)

    # Simple description based on type
    if event_type == "Seismic Activity":
        title = f"Minor Quake ({random.randint(1, 4)}.0 Mag)"
        description = "Routine seismic event detected in remote region."
    elif event_type == "Weather Anomaly":
        title = f"High Wind Warning (Gusts up to {random.randint(50, 80)} mph)"
        description = "Unusual pressure system detected."
    else:
        title = f"Geomonitor Ping #{random.randint(100, 999)}"
        description = f"Routine data capture for {event_type}."

    # The payload structure that matches what our map expects
    event_data = {
        'title': title,
        'type': event_type,
        'description': description,
        'severity': severity,
        'lat': lat,
        'lon': lon,
        'timestamp': time.time()  # Useful for tracking
    }
    return event_data

def push_event(event_data):
    """Pushes a new event to the /events node."""
    
    # We use a unique, timestamped key for each event
    event_key = f"event_{int(time.time())}" 
    
    try:
        # Pushes the data to the 'events' path. 
        # Note: This will replace the *entire* 'events' data node with the new single event. 
        # If you wanted multiple markers, we would change the structure slightly.
        db.put('/events', event_key, event_data)
        print(f"[{time.strftime('%H:%M:%S')}] PUSH SUCCESS: {event_data['title']} at ({event_data['lat']:.2f}, {event_data['lon']:.2f})")
    except Exception as e:
        print(f"PUSH FAILED: {e}")


# --- MAIN EXECUTION ---
if __name__ == "__main__":
    event = generate_random_event()
    push_event(event)
