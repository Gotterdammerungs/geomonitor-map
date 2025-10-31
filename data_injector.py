import time
import os
import requests
import json
import re
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
from datetime import datetime

# ============================================================
# 🧭 LOGGING HELPER
# ============================================================
def log(msg):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

# ============================================================
# ⚙️ CONFIGURATION
# ============================================================
FIREBASE_URL = os.environ.get('FIREBASE_URL')
NEWS_API_KEY = os.environ.get('NEWS_API_KEY')

log("Booting Geomonitor Data Injector...")
log(f"Firebase URL: {FIREBASE_URL or '❌ NOT SET'}")
log(f"NewsAPI key: {'✅ Present' if NEWS_API_KEY else '❌ NOT SET'}")

if not FIREBASE_URL or not NEWS_API_KEY:
    log("FATAL ERROR: FIREBASE_URL or NEWS_API_KEY environment variable is not set.")
    exit(1)

# ============================================================
# 📘 LOAD EXTERNAL DICTIONARY
# ============================================================
DICTIONARY_PATH = os.path.join(os.path.dirname(__file__), "dictionary.json")

try:
    with open(DICTIONARY_PATH, "r", encoding="utf-8") as f:
        CUSTOM_LOCATIONS = json.load(f)
    log(f"📘 Loaded {len(CUSTOM_LOCATIONS)} entries from dictionary.json")
except Exception as e:
    log(f"⚠️ Could not load dictionary file: {e}")
    CUSTOM_LOCATIONS = {}

# ============================================================
# 🧠 REGEX FOR LOCATION PHRASES
# ============================================================
PLACE_REGEX = re.compile(
    r'\b(?:in|at|near|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)'
)

def extract_location_hint(text):
    """
    Finds place-like phrases (e.g. 'in Paris', 'from New York City').
    If the dictionary includes that name, returns its normalized form.
    """
    if not text:
        return None

    match = PLACE_REGEX.search(text)
    if match:
        raw_place = match.group(1).strip()
        normalized = CUSTOM_LOCATIONS.get(raw_place.lower(), raw_place)
        return normalized
    return None

def resolve_location_name(article):
    """
    Uses multiple strategies to find the best location hint:
      1. Exact match from dictionary by source name.
      2. Keyword in title/description that exists in dictionary.
      3. Regex match in text, normalized via dictionary if possible.
    """
    src = (article.get("source", {}) or {}).get("name", "")
    title = article.get("title", "") or ""
    desc = article.get("description", "") or ""

    # --- Step 1: exact match by source name ---
    key = src.lower().strip()
    if key in CUSTOM_LOCATIONS:
        log(f"📕 Dictionary source match: {key} → {CUSTOM_LOCATIONS[key]}")
        return CUSTOM_LOCATIONS[key]

    # --- Step 2: keyword match in title/description ---
    combined_text = f"{title} {desc}".lower()
    for word, loc in CUSTOM_LOCATIONS.items():
        if word in combined_text:
            log(f"📗 Keyword match in text: {word} → {loc}")
            return loc

    # --- Step 3: regex pattern extraction ---
    regex_hint = extract_location_hint(title + " " + desc)
    if regex_hint:
        log(f"📍 Regex match → {regex_hint}")
        return regex_hint

    log("⚠️ No dictionary or regex location found.")
    return None

# ============================================================
# 🌍 GEOLOCATION VIA NOMINATIM
# ============================================================
try:
    geolocator = Nominatim(user_agent="geomonitor_news_app")
    log("Successfully initialized Nominatim geocoder.")
except Exception as e:
    log(f"Error initializing geocoder: {e}")
    exit(1)

def geocode_location(location_name):
    """Converts a location name into (lat, lon) using Nominatim."""
    if not location_name:
        return None, None

    location_name = location_name.strip().replace(" - ", ", ")
    time.sleep(1.2)  # respect Nominatim usage policy
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

# ============================================================
# 📰 FETCH NEWS + CREATE EVENTS
# ============================================================
def fetch_and_geocode_news():
    NEWS_API_URL = (
        f"https://newsapi.org/v2/everything?q=world&language=en&"
        f"sortBy=publishedAt&pageSize=15&apiKey={NEWS_API_KEY}"
    )
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
        log(f"\n[{i+1}/{len(articles)}] Processing: {title}")

        location_hint = resolve_location_name(article)
        if not location_hint:
            log("❌ Could not determine a location hint; skipping.")
            total_fail += 1
            continue

        lat, lon = geocode_location(location_hint)
        if lat and lon:
            total_success += 1
            event_key = f"news_{int(time.time())}_{i}"
            event_data = {
                'title': title,
                'description': article.get('description', 'No Description'),
                'type': (article.get('source', {}) or {}).get('name', 'General News'),
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

# ============================================================
# 🔥 PUSH TO FIREBASE
# ============================================================
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

# ============================================================
# 🚀 MAIN EXECUTION
# ============================================================
if __name__ == "__main__":
    log("=== Starting Data Injection Job ===")
    final_events = fetch_and_geocode_news()
    push_batch_events(final_events)
    log("=== Job Complete ===")
