import time
import os
import requests # Used for both NewsAPI and Firebase REST
import json
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# --- CONFIGURATION ---
# Reads from environment variables passed by GitHub Actions
FIREBASE_URL = os.environ.get('FIREBASE_URL')
NEWS_API_KEY = os.environ.get('NEWS_API_KEY')

# --- INITIALIZATION & SETUP ---
if not FIREBASE_URL or not NEWS_API_KEY:
    # This check is still necessary in case the Action fails to set the variables
    print("FATAL ERROR: FIREBASE_URL or NEWS_API_KEY environment variable is not set.")
    exit(1)

try:
    # Initialize Nominatim Geocoder (OpenStreetMap). 
    geolocator = Nominatim(user_agent="geomonitor_news_app") 
    print("Successfully initialized services (NewsAPI access and Geocoder ready).")
    
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
        # Crucial delay to avoid overwhelming the free Nominatim service
        time.sleep(1.2) 
        
        # We search globally to avoid misinterpreting "London" as a small US town
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
        print(f"  -> UNEXPECTED ERROR during geocoding: {e}. Skipping.")
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
        # NEW STRATEGY: Create a combined, more descriptive location hint
        source_name = article.get('source', {}).get('name', '')
        article_title = article.get('title', '')
        
        # We try to geocode the source name first, as it's cleaner.
        location_hint = source_name
        
        # If the source name is too generic or missing, use the title.
        if not location_hint or 'news' in location_hint.lower() or 'press' in location_hint.lower():
             # If the title is less than 50 chars, use the whole thing. Otherwise, take the first 3 words.
             location_hint = article_title if len(article_title) < 50 else ' '.join(article_title.split()[:3])

        if not location_hint:
            continue

        print(f"Attempting to geocode hint: '{location_hint}'")
        lat, lon = geocode_location(location_hint)
        
        if lat is not None and lon is not None:
            # Create a unique key for Firebase
            event_key = f"news_{int(time.time())}_{i}"

            # Format the final event object for the map
            event_data = {
                'title': article_title,
                'description': article.get('description', 'No Description'),
                'type': source_name or 'General News',
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
    Clears the existing 'events' node and pushes the new batch of geocoded events 
    directly using the Firebase REST API via 'requests.put'.
    """
    if not events:
        print("No geocoded events to push to Firebase. Database will remain empty.")
        # We still need to push an empty object to clear any old/stale data
        events = {}


    # Firebase REST API endpoint structure: [BASE_URL]/[PATH].json
    # PUT replaces the entire data node, which is what we want.
    FIREBASE_REST_URL = f"{FIREBASE_URL}/events.json"

    try:
        response = requests.put(FIREBASE_REST_URL, data=json.dumps(events))
        response.raise_for_status() # Raise exception for bad status codes
        
        if events:
            print(f"PUSH COMPLETE: Replaced 'events' node with {len(events)} geolocated articles.")
        else:
            print("PUSH COMPLETE: Cleared 'events' node in Firebase.")
            
    except requests.exceptions.RequestException as e:
        print(f"PUSH FAILED to Firebase via REST API. Error: {e}")
    except Exception as e:
        print(f"UNEXPECTED PUSH ERROR: {e}")


# --- MAIN EXECUTION ---
if __name__ == "__main__":
    
    # 1. Fetch, Geocode, and Structure Data
    final_events = fetch_and_geocode_news()
    
    # 2. Push to Firebase
    push_batch_events(final_events)
