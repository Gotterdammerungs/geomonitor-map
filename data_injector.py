import time
import os
import requests
import json
import re
from datetime import datetime, timedelta

# ============================================================
# 🌍 GEOLOCATOR IMPORTS (safe Geoapify fallback)
# ============================================================
try:
    from geopy.geocoders import Nominatim, Geoapify
    GEOAPIFY_AVAILABLE = True
except ImportError:
    from geopy.geocoders import Nominatim
    Geoapify = None
    GEOAPIFY_AVAILABLE = False

from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# ============================================================
# 🧭 LOGGING HELPER
# ============================================================
def log(msg):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

# ============================================================
# ⚙️ CONFIGURATION
# ============================================================
FIREBASE_URL = os.environ.get("FIREBASE_URL", "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app")
NEWS_API_KEY = os.environ.get("NEWS_API_KEY")
GEOAPIFY_KEY = os.environ.get("GEOAPIFY_KEY")

log("Booting Geomonitor Data Injector...")
log(f"Firebase URL: {FIREBASE_URL or '❌ NOT SET'}")
log(f"NewsAPI key: {'✅ Present' if NEWS_API_KEY else '❌ NOT SET'}")
log(f"Geoapify key: {'✅ Present' if GEOAPIFY_KEY else '⚠️ Missing (fallback disabled)'}")

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
# 🧠 REGEX PATTERNS
# ============================================================
PLACE_REGEX = re.compile(r"\b(?:in|at|near|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)")
DATELINE_REGEX = re.compile(r"^\s*([A-Z][A-Z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*—|,)", re.UNICODE)

# ============================================================
# 🧩 LOCATION RESOLUTION
# ============================================================
def extract_dateline_location(text):
    """Detects leading dateline like 'OTTAWA —' or 'London,'."""
    if not text:
        return None
    match = DATELINE_REGEX.match(text)
    if match:
        raw = match.group(1).strip()
        normalized = CUSTOM_LOCATIONS.get(raw.lower(), raw)
        return normalized
    return None


def extract_location_hint(text):
    """Finds phrases like 'in Paris' or 'from New York City'."""
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
    Priority:
      1️⃣ Dictionary (source name)
      2️⃣ Dateline detection
      3️⃣ Keyword in text
      4️⃣ Regex fallback
    """
    src = (article.get("source", {}) or {}).get("name", "")
    title = article.get("title", "") or ""
    desc = article.get("description", "") or ""
    combined = f"{title} {desc}"

    # 1️⃣ Dictionary
    key = src.lower().strip()
    if key in CUSTOM_LOCATIONS:
        log(f"📕 Dictionary source match: {key} → {CUSTOM_LOCATIONS[key]}")
        return CUSTOM_LOCATIONS[key]

    # 2️⃣ Dateline
    dateline = extract_dateline_location(title + " " + desc)
    if dateline:
        log(f"📰 Dateline match → {dateline}")
        return dateline

    # 3️⃣ Keyword
    lower_text = combined.lower()
    for word, loc in CUSTOM_LOCATIONS.items():
        if word in lower_text:
            log(f"📗 Keyword match: {word} → {loc}")
            return loc

    # 4️⃣ Regex
    regex_hint = extract_location_hint(combined)
    if regex_hint:
        log(f"📍 Regex match → {regex_hint}")
        return regex_hint

    log("⚠️ No location found by any method.")
    return None

# ============================================================
# 🌍 GEOLOCATION (Nominatim + Geoapify Fallback)
# ============================================================
try:
    geolocator_nom = Nominatim(user_agent="geomonitor_news_app")
    geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY) if GEOAPIFY_AVAILABLE and GEOAPIFY_KEY else None
    if geolocator_geo:
        log("✅ Initialized geocoders: Nominatim + Geoapify fallback.")
    else:
        log("✅ Initialized Nominatim geocoder (Geoapify unavailable).")
except Exception as e:
    log(f"❌ Geocoder initialization error: {e}")
    exit(1)


def geocode_location(location_name):
    if not location_name:
        return None, None

    location_name = location_name.strip().replace(" - ", ", ")
    time.sleep(1.2)  # respect rate limit
    try:
        loc = geolocator_nom.geocode(f"{location_name}, global", timeout=10)
        if loc:
            log(f"🗺️ Nominatim → '{location_name}' → ({loc.latitude:.4f}, {loc.longitude:.4f})")
            return loc.latitude, loc.longitude
    except Exception as e:
        log(f"⚠️ Nominatim failed for '{lo
