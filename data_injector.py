import os
import time
import json
import re
import requests
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
# 🧭 LOGGING
# ============================================================
def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

# ============================================================
# ⚙️ CONFIG
# ============================================================
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app/"
)
NEWS_API_KEY = os.environ.get("NEWS_API_KEY")
GEOAPIFY_KEY = os.environ.get("GEOAPIFY_KEY")
AI_API_KEY = os.environ.get("AI_API_KEY", "")
AI_IS_ON = True  # toggle manually

log("Booting Geomonitor Data Injector...")
log(f"Firebase URL: {FIREBASE_URL}")
log(f"NewsAPI key: {'✅ Present' if NEWS_API_KEY else '❌ Missing'}")
log(f"Geoapify key: {'✅ Present' if GEOAPIFY_KEY else '⚠️ Missing'}")

if not NEWS_API_KEY:
    log("❌ Missing NEWS_API_KEY; cannot continue.")
    exit(1)

# ============================================================
# 📘 LOAD DICTIONARY
# ============================================================
DICTIONARY_PATH = os.path.join(os.path.dirname(__file__), "dictionary.json")
try:
    with open(DICTIONARY_PATH, "r", encoding="utf-8") as f:
        CUSTOM_LOCATIONS = json.load(f)
    log(f"📘 Loaded {len(CUSTOM_LOCATIONS)} dictionary entries.")
except Exception as e:
    log(f"⚠️ Could not load dictionary file: {e}")
    CUSTOM_LOCATIONS = {}

# ============================================================
# 🔤 REGEX
# ============================================================
PLACE_REGEX = re.compile(r"\b(?:in|at|near|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)")
DATELINE_REGEX = re.compile(r"^\s*([A-Z][A-Z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*—|,)")

# ============================================================
# 🧠 AI FALLBACK
# ============================================================
def ai_guess_location(article):
    """Ask a small AI model to guess a likely city or country."""
    if not AI_IS_ON or not AI_API_KEY:
        return None
    title = article.get("title", "")
    desc = article.get("description", "")
    text = f"Title: {title}\nDescription: {desc}\n\nWhat city or country is this news most likely about? Return only the location name."
    try:
        import openai
        openai.api_key = AI_API_KEY
        resp = openai.ChatCompletion.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a location extraction assistant. Reply with only one location name."},
                {"role": "user", "content": text},
            ],
            max_tokens=10,
            temperature=0.3,
        )
        guess = resp["choices"][0]["message"]["content"].strip()
        log(f"🧠 AI guessed location → {guess}")
        return guess
    except Exception as e:
        log(f"⚠️ AI inference failed: {e}")
        return None

# ============================================================
# 📍 LOCATION HELPERS
# ============================================================
def extract_dateline_location(text: str):
    if not text:
        return None
    match = DATELINE_REGEX.match(text)
    if match:
        raw = match.group(1).strip()
        return CUSTOM_LOCATIONS.get(raw.lower(), raw)
    return None

def extract_location_hint(text: str):
    if not text:
        return None
    match = PLACE_REGEX.search(text)
    if match:
        raw_place = match.group(1).strip()
        return CUSTOM_LOCATIONS.get(raw_place.lower(), raw_place)
    return None

# ============================================================
# 🌍 GEOLOCATORS
# ============================================================
try:
    geolocator_nom = Nominatim(user_agent="geomonitor_news_app")
    geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY) if GEOAPIFY_AVAILABLE and GEOAPIFY_KEY else None
    if geolocator_geo:
        log("✅ Initialized geocoders: Nominatim + Geoapify fallback.")
    else:
        log("✅ Initialized Nominatim geocoder (Geoapify unavailable).")
except Exception as e:
    log(f"❌ Geocoder init failed: {e}")
    exit(1)

def geocode_location(location_name: str):
    if not location_name:
        return None, None
    clean_name = (
        location_name.strip()
        .replace(" - ", ", ")
        .replace("USA", "")
        .replace("Inc.", "")
        .replace("Headquarters", "")
        .strip(", ")
    )
    log(f"Attempting geocode for hint: '{clean_name}'")
    time.sleep(1.2)
    try:
        loc = geolocator_nom.geocode(clean_name, timeout=10)
        if loc:
            log(f"🗺️ Nominatim → '{clean_name}' → ({loc.latitude:.4f}, {loc.longitude:.4f})")
            return loc.latitude, loc.longitude
    except Exception as e:
        log(f"⚠️ Nominatim error: {e}")

    if geolocator_geo:
        try:
            loc = geolocator_geo.geocode(clean_name, timeout=10)
            if loc:
                log(f"🌐 Geoapify → '{clean_name}' → ({loc.latitude:.4f}, {loc.longitude:.4f})")
                return loc.latitude, loc.longitude
        except Exception as e:
            log(f"⚠️ Geoapify error: {e}")

    return None, None

# ============================================================
# 🔎 LOCATION RESOLUTION PIPELINE
# ============================================================
def resolve_location_name(article: dict):
    src = (article.get("source", {}) or {}).get("name", "")
    title = article.get("title", "") or ""
    desc = article.get("description", "") or ""
    combined = f"{title} {desc}"

    key = src.lower().strip()
    if key in CUSTOM_LOCATIONS:
        log(f"📕 Dictionary source match: {key} → {CUSTOM_LOCATIONS[key]}")
        return CUSTOM_LOCATIONS[key]

    dateline = extract_dateline_location(combined)
    if dateline:
        log(f"📰 Dateline match → {dateline}")
        return dateline

    lower_text = combined.lower()
    for word, loc in sorted(CUSTOM_LOCATIONS.items(), key=lambda kv: -len(kv[0])):
        if len(word) <= 2:
            continue
        if re.search(rf"\b{re.escape(word.lower())}\b", lower_text):
            log(f"📗 Keyword match → {word} → {loc}")
            return loc

    regex_hint = extract_location_hint(combined)
    if regex_hint:
        log(f"📍 Regex match → {regex_hint}")
        return regex_hint

    if AI_IS_ON:
        guess = ai_guess_location(article)
        if guess:
            log(f"🧩 Using AI location guess: {guess}")
            return guess

    log("⚠️ No location found by any method.")
    return None

# ============================================================
# 📰 FETCH NEWS
# ============================================================
def fetch_and_geocode_news():
    url = f"https://newsapi.org/v2/everything?q=world&language=en&sortBy=publishedAt&pageSize=15&apiKey={NEWS_API_KEY}"
    log(f"Fetching news: {url}")
    try:
        data = requests.get(url, timeout=20).json()
        articles = data.get("articles", [])
        log(f"Fetched {len(articles)} articles.")
    except Exception as e:
        log(f"❌ Failed to fetch: {e}")
        return {}

    events = {}
    for i, art in enumerate(articles):
        title = art.get("title", "Untitled").strip()
        log(f"\n[{i+1}/{len(articles)}] Processing: {title}")

        loc_hint = resolve_location_name(art)
        if not loc_hint:
            log("❌ No location hint found; skipping.")
            continue

        lat, lon = geocode_location(loc_hint)
        if lat and lon:
            key = f"news_{int(time.time())}_{i}"
            events[key] = {
                "title": title,
                "description": art.get("description", "No Description"),
                "type": (art.get("source", {}) or {}).get("name", "General News"),
                "severity": "Info",
                "url": art.get("url", "#"),
                "lat": lat,
                "lon": lon,
                "timestamp": art.get("publishedAt") or datetime.utcnow().isoformat(),
            }
    return events

# ============================================================
# 🔥 PUSH TO FIREBASE
# ============================================================
def push_batch_events(new_events):
    fb_url = f"{FIREBASE_URL}/events.json"
    cutoff = datetime.utcnow() - timedelta(days=2)
    try:
        old = requests.get(fb_url, timeout=10).json() or {}
        log(f"Fetched {len(old)} existing events.")
    except Exception:
        old = {}
    kept = {}
    for key, ev in old.items():
        ts = ev.get("timestamp")
        if not ts:
            continue
        try:
            if datetime.fromisoformat(ts.replace("Z", "")) > cutoff:
                kept[key] = ev
        except Exception:
            continue
    log(f"Keeping {len(kept)} old events (last 2 days).")
    merged = {**kept, **new_events}
    try:
        r = requests.put(fb_url, data=json.dumps(merged))
        r.raise_for_status()
        log(f"✅ PUSH COMPLETE: {len(merged)} total events.")
    except Exception as e:
        log(f"❌ PUSH FAILED: {e}")

# ============================================================
# 🚀 MAIN
# ============================================================
if __name__ == "__main__":
    log("=== Starting Data Injection Job ===")
    events = fetch_and_geocode_news()
    push_batch_events(events)
    log("=== Job Complete ===")
