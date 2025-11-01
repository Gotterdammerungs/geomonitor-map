import time
import os
import requests
import json
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
from datetime import datetime

# --- LOGGING HELPER ---
def log(msg):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

# --- CONFIGURATION ---
FIREBASE_URL = os.environ.get('FIREBASE_URL')
NEWS_API_KEY = os.environ.get('NEWS_API_KEY')

log("Booting Geomonitor Data Injector...")
log(f"Firebase URL: {FIREBASE_URL or '❌ NOT SET'}")
log(f"NewsAPI key: {'✅ Present' if NEWS_API_KEY else '❌ NOT SET'}")

if not FIREBASE_URL or not NEWS_API_KEY:
    log("FATAL ERROR: FIREBASE_URL or NEWS_API_KEY environment variable is not set.")
    exit(1)

# --- INITIALIZATION ---
try:
    geolocator = Nominatim(user_agent="geomonitor_news_app")
    log("Successfully initialized Nominatim geocoder.")
except Exception as e:
    log(f"Error initializing geocoder: {e}")
    exit(1)

# --- GEOLOCATION ---
def geocode_location(location_name):
    if not location_name:
        return None, None
    location_name = location_name.strip().replace(" - ", ", ")
    time.sleep(1.2)
    try:
        location = geolocator.geocode(f"{location_name}, global", timeout=10)
        if location:
            log(f"🗺️ Geocoded '{location_name}' → ({location.latitude:.4f}, {location.longitude:.4f})")
            return location.latitude, location.longitude
        else:
            log(f"⚠️ Failed to geocode: '{location_name}'")
            return None, None
    except (GeocoderTimedOut, GeocoderServiceError) as e:
        log(f"⏱️ Timeout/Service error for '{location_name}': {e}")
        return None, None
    except Exception as e:
        log(f"❌ Unexpected geocode error for '{location_name}': {e}")
        return None, None

# --- FETCH & GEOCODE ---
def fetch_and_geocode_news():
    NEWS_API_URL = f"https://newsapi.org/v2/everything?q=world&language=en&sortBy=publishedAt&pageSize=15&apiKey={NEWS_API_KEY}"
    log(f"Fetching news from NewsAPI: {NEWS_API_URL}")
    try:
        response = requests.get(NEWS_API_URL, timeout=15)
        response.raise_for_status()
        data = response.json()
        articles = data.get('articles', [])
        log(f"Fetched {len(articles)} articles.")
    except requests.exceptions.RequestException as e:
        log(f"ERROR: Failed to fetch data from NewsAPI: {e}")
        return {}

    geocoded_events = {}
    total_success = total_fail = 0

    for i, article in enumerate(articles):
        title = article.get('title', '').strip() or 'Untitled'
        source_name = article.get('source', {}).get('name', '').strip()
        log(f"\n[{i+1}/{len(articles)}] Processing: {title}")
        location_hint = source_name if source_name else title
        if not location_hint or 'news' in location_hint.lower() or 'press' in location_hint.lower():
            location_hint = title if len(title) < 50 else ' '.join(title.split()[:3])

        lat, lon = geocode_location(location_hint)
        if lat and lon:
            total_success += 1
            event_key = f"news_{int(time.time())}_{i}"
            event_data = {
                'title': title,
                'description': article.get('description', 'No Description'),
                'type': source_name or 'General News',
                'severity': 'Info',
                'url': article.get('url', '#'),
                'lat': lat,
                'lon': lon,
                'timestamp': article.get('publishedAt') or time.time()
            }
            geocoded_events[event_key] = event_data
        else:
            total_fail += 1

    log(f"\n✅ Geocoding complete: {total_success} success, {total_fail} failed.")
    return geocoded_events

# --- PUSH TO FIREBASE ---
def push_batch_events(events):
    FIREBASE_REST_URL = f"{FIREBASE_URL}/events.json"
    log(f"Pushing {len(events)} events to Firebase → {FIREBASE_REST_URL}")

    if not events:
        log("No geocoded events to push. Sending empty object to clear old data.")
        events = {}

    try:
        log(f"Preview of data: {json.dumps(dict(list(events.items())[:2]), indent=2) if events else '{}'}")
        response = requests.put(FIREBASE_REST_URL, data=json.dumps(events))
        response.raise_for_status()
        log(f"✅ PUSH COMPLETE: {len(events)} events now stored in Firebase.")
    except requests.exceptions.RequestException as e:
        log(f"❌ PUSH FAILED: {e}")
    except Exception as e:
        log(f"❌ UNEXPECTED PUSH ERROR: {e}")

# --- MAIN EXECUTION ---
if __name__ == "__main__":
    log("=== Starting Data Injection Job ===")
    final_events = fetch_and_geocode_news()
    push_batch_events(final_events)
    log("=== Job Complete ===")
