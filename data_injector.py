import time
import os
import requests
from firebase import firebase
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# --- CONFIGURATION ---
# The script now STRICTLY reads from environment variables passed by GitHub Actions
FIREBASE_URL = os.environ.get('FIREBASE_URL')
NEWS_API_KEY = os.environ.get('NEWS_API_KEY')

# --- INITIALIZATION ---
if not FIREBASE_URL:
    print("FATAL ERROR: FIREBASE_URL environment variable is not set. Check GitHub Secrets and workflow file.")
    exit(1)
if not NEWS_API_KEY:
    print("FATAL ERROR: NEWS_API_KEY environment variable is not set. Check GitHub Secrets and workflow file.")
    exit(1)

try:
    # Initialize Firebase connection
    db = firebase.FirebaseApplication(FIREBASE_URL, None)
    print(f"Successfully connected to Firebase at {FIREBASE_URL}")
    
    # Initialize Nominatim Geocoder (OpenStreetMap). 
    geolocator = Nominatim(user_agent="geomonitor_news_app") 
    
except Exception as e:
    print(f"Error initializing services: {e}")
    exit(1)

# --- HELPER FUNCTIONS ---

def geocode_location(location_name):
    """
    Converts a location name (string) into (lat, lon) coordinates using Nominatim.
    Includes a time delay (1.2 seconds) to comply with Nominatim's usage policy.
    """
    if not location_name:
        return None, None
        
    location_name = location_name.strip().replace(" - ", ", ")
    
    try:
        # Respecting Nominatim's usage policy (delay is crucial)
        time.sleep(1.2) 
        
        location = geolocator.geocode(f"{location_name}, global", timeout=10)
        
        if location:
            print(f"  -> SUCCESS: Geocoded '{location_name}' to ({location.latitude:.4f}, {location.longitude:.4f})")
            return location.latitude, location.longitude
        else:
            print(f"  -> FAILED: Geocoding failed for: '{location_name}'")
            return None, None
            
    except (GeocoderTimedOut, GeocoderServiceError, AttributeError) as e:
        print(f"  -> SERVICE ERROR/TIMEOUT for '{location_name}': {e}. Skipping.")
        return None, None
    except Exception as e:
        print(f"  -> UNEXPECTED ERROR: {e}. Skipping.")
        return None, None


def fetch_and_geocode_news():
    """
    Fetches news from NewsAPI, geocodes the location, and returns a 
    dictionary of map-ready event objects.
    """
    
    # NewsAPI endpoint for general global news
    NEWS_API_URL = f"https://newsapi.org/v2/everything?q=world&language=en&sortBy=publishedAt&pageSize=15&apiKey={NEWS_API_KEY}"
    
    try:
        print("Starting batch job: Fetching news from NewsAPI...")
        response = requests.get(NEWS_API_URL, timeout=15)
        response.raise_for_status() 
        data = response.json()
        articles = data.get('articles', [])
        print(f"Fetched {len(articles)} potential articles.")

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Failed to fetch data from NewsAPI: {e}")
        return {}

    geocoded_events = {} 

    for i, article in enumerate(articles):
        # Strategy: Use the source name as the main location hint (e.g., 'BBC News', 'CNN').
        location_hint = article.get('source', {}).get('name')
        
        if not location_hint:
            continue

        # Geocoding the location
        lat, lon = geocode_location(location_hint)
        
        if lat is not None and lon is not None:
            # Create a unique key for Firebase
            event_key = f"news_{int(time.time())}_{i}"

            # Format the final event object for the map
            event_data = {
                'title': article.get('title', 'No Title'),
                'description': article.get('description', 'No Description'),
                'type': article.get('source', {}).get('name', 'General News'),
                'severity': 'Info',
                'url': article.get('url', '#'),
                'lat': lat,
                'lon': lon,
                'timestamp': article.get('publishedAt') or time.time()
            }
            geocoded_events[event_key] = event_data
            
    return geocoded_events


def push_batch_events(events):
    """
    Clears the existing 'events' node and pushes the new batch of geocoded events.
    """
    if not events:
        print("No geocoded events to push to Firebase.")
        return

    try:
        db.put('/', 'events', events)
        print(f"PUSH COMPLETE: Replaced 'events' node with {len(events)} geolocated articles.")
    except Exception as e:
        print(f"PUSH FAILED to Firebase: {e}")


# --- MAIN EXECUTION ---
if __name__ == "__main__":
    
    # 1. Fetch, Geocode, and Structure Data
    final_events = fetch_and_geocode_news()
    
    # 2. Push to Firebase
    push_batch_events(final_events)
