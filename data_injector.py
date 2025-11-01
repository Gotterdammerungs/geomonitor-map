#!/usr/bin/env python3
"""
data_injector.py

Fetches filtered news from NewsAPI, classifies relevance/topic/importance with a small LLM
(Mistral 7B via OpenRouter), resolves locations (dictionary -> dateline -> keyword -> regex -> AI),
geocodes using Nominatim (with optional Geoapify fallback), and pushes events to Firebase.
- Uses environment variables for secrets.
- AI usage is optional and controlled via toggles.
- Keeps events for 2 days and merges new events with existing ones.
"""

import os
import time
import json
import re
import requests
from datetime import datetime, timedelta

# ---------------------------
# Safe geopy imports (Geoapify optional)
# ---------------------------
try:
    from geopy.geocoders import Nominatim, Geoapify
    GEOAPIFY_AVAILABLE = True
except ImportError:
    from geopy.geocoders import Nominatim
    Geoapify = None
    GEOAPIFY_AVAILABLE = False

from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# ---------------------------
# Basic logging helper
# ---------------------------
def log(msg: str):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

# ---------------------------
# Configuration (via env vars)
# ---------------------------
FIREBASE_URL = os.environ.get(
    "FIREBASE_URL",
    "https://geomonitor-2025-default-rtdb.europe-west1.firebasedatabase.app/"
).rstrip('/')
NEWS_API_KEY = os.environ.get("NEWS_API_KEY")
GEOAPIFY_KEY = os.environ.get("GEOAPIFY_KEY")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY")

# AI toggles
AI_IS_ON = True               # allow AI usage at all (both classification and location fallback)
AI_CLASSIFY_ON = True         # use AI for classification (show/topic/importance)
AI_LOCATION_FALLBACK_ON = True  # use AI to guess location if other methods fail

# Caches (persist between runs)
BASE_DIR = os.path.dirname(__file__)
GEOCACHE_PATH = os.path.join(BASE_DIR, "geocache.json")
CLASSIFY_CACHE_PATH = os.path.join(BASE_DIR, "classify_cache.json")

# Load caches
try:
    with open(GEOCACHE_PATH, "r", encoding="utf-8") as f:
        GEOCACHE = json.load(f)
except Exception:
    GEOCACHE = {}

try:
    with open(CLASSIFY_CACHE_PATH, "r", encoding="utf-8") as f:
        CLASSIFY_CACHE = json.load(f)
except Exception:
    CLASSIFY_CACHE = {}

# Small safety checks
log("Booting Geomonitor Data Injector...")
log(f"Firebase URL: {FIREBASE_URL or '❌ NOT SET'}")
log(f"NewsAPI key: {'✅ Present' if NEWS_API_KEY else '❌ NOT SET'}")
log(f"Geoapify key: {'✅ Present' if GEOAPIFY_KEY else '⚠️ Missing'}")
log(f"OpenRouter key: {'✅ Present' if OPENROUTER_KEY else '⚠️ Missing'}")
if not NEWS_API_KEY:
    log("FATAL ERROR: NEWS_API_KEY is required. Set it in the environment and re-run.")
    raise SystemExit(1)

# ---------------------------
# Load custom dictionary
# ---------------------------
DICTIONARY_PATH = os.path.join(BASE_DIR, "dictionary.json")
try:
    with open(DICTIONARY_PATH, "r", encoding="utf-8") as f:
        CUSTOM_LOCATIONS = json.load(f)
    log(f"📘 Loaded {len(CUSTOM_LOCATIONS)} dictionary entries from dictionary.json")
except Exception as e:
    log(f"⚠️ Could not load dictionary.json: {e}")
    CUSTOM_LOCATIONS = {}

# ---------------------------
# Regex patterns
# ---------------------------
PLACE_REGEX = re.compile(r"\b(?:in|at|near|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)")
DATELINE_REGEX = re.compile(r"^\s*([A-Z][A-Z]+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:\s*—|,)")
AI_CLASSIFY_PROMPT = (
    "You are a strict news filter and classifier. "
    "Given a short news title and description, decide three values:\n"
    " - show: true or false (should this story be displayed on a serious world map?)\n"
    " - topic: one-word topic chosen from geopolitics, finance, tech, disaster, social, science, other\n"
    " - importance: 1,2,3,4 (1=local, 2=regional/national, 3=national/continental, 4=major global)\n\n"
    "Return EXACTLY in this format (lowercase):\n"
    "show=<true|false>; topic=<topic>; importance=<1-4>\n\n"
    "If unsure, be conservative: show=false for fluff, topic=other, importance=1.\n"
    "Examples:\n"
    "show=true; topic=geopolitics; importance=4\n"
)

AI_LOCATION_PROMPT = (
    "You are a concise location guesser. Given a short news title and description, "
    "return a single likely city or country name (e.g. 'Paris' or 'France' or 'Cupertino, California'). "
    "Return only the location string, nothing else."
)

# ---------------------------
# Initialize geocoders
# ---------------------------
try:
    geolocator_nom = Nominatim(user_agent="geomonitor_news_app")
    geolocator_geo = Geoapify(api_key=GEOAPIFY_KEY) if GEOAPIFY_AVAILABLE and GEOAPIFY_KEY else None
    if geolocator_geo:
        log("✅ Initialized geocoders: Nominatim + Geoapify fallback.")
    else:
        log("✅ Initialized Nominatim geocoder (Geoapify unavailable).")
except Exception as e:
    log(f"❌ Geocoder initialization error: {e}")
    raise SystemExit(1)

# ---------------------------
# Helper: Save caches to disk
# ---------------------------
def persist_caches():
    try:
        with open(GEOCACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(GEOCACHE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    try:
        with open(CLASSIFY_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(CLASSIFY_CACHE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# ---------------------------
# AI: classification (OpenRouter Mistral 7B)
# ---------------------------
def ai_classify_article(article):
    """
    Returns (show:bool, topic:str, importance:int)
    Caches results to reduce token usage.
    """
    if not AI_IS_ON or not AI_CLASSIFY_ON or not OPENROUTER_KEY:
        return True, "other", 2  # default: show but medium importance

    title = (article.get("title") or "").strip()
    desc = (article.get("description") or "").strip()
    cache_key = (title + "\n" + desc)[:2000]

    if cache_key in CLASSIFY_CACHE:
        entry = CLASSIFY_CACHE[cache_key]
        return entry.get("show", True), entry.get("topic", "other"), int(entry.get("importance", 2))

    payload = {
        "model": "mistralai/mistral-7b-instruct",
        "messages": [
            {"role": "system", "content": AI_CLASSIFY_PROMPT},
            {"role": "user", "content": f"Title: {title}\nDescription: {desc}"}
        ],
        "max_tokens": 30,
        "temperature": 0.0,
    }

    try:
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=20
        )
        resp.raise_for_status()
        j = resp.json()
        raw = j["choices"][0]["message"]["content"].strip().lower()
        log(f"🧠 AI classification raw → {raw}")

        # parse: show=<true|false>; topic=<word>; importance=<1-4>
        show = True
        topic = "other"
        importance = 2

        m_show = re.search(r"show=(true|false)", raw)
        if m_show:
            show = m_show.group(1) == "true"
        m_topic = re.search(r"topic=([a-z]+)", raw)
        if m_topic:
            topic = m_topic.group(1)
        m_imp = re.search(r"importance=([1-4])", raw)
        if m_imp:
            importance = int(m_imp.group(1))

        CLASSIFY_CACHE[cache_key] = {"show": show, "topic": topic, "importance": importance, "raw": raw}
        persist_caches()
        return show, topic, importance
    except Exception as e:
        log(f"⚠️ AI classification failed: {e}")
        # fallback conservative default
        return True, "other", 2

# ---------------------------
# AI: location guess (if all else fails)
# ---------------------------
def ai_guess_location(article):
    if not AI_IS_ON or not AI_LOCATION_FALLBACK_ON or not OPENROUTER_KEY:
        return None

    title = (article.get("title") or "").strip()
    desc = (article.get("description") or "").strip()
    prompt_text = f"Title: {title}\nDescription: {desc}\n\n{AI_LOCATION_PROMPT}"

    try:
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
            json={
                "model": "mistralai/mistral-7b-instruct",
                "messages": [
                    {"role": "system", "content": AI_LOCATION_PROMPT},
                    {"role": "user", "content": prompt_text}
                ],
                "max_tokens": 12,
                "temperature": 0.0,
            },
            timeout=20
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        log(f"🧠 AI location guess → {raw}")
        return raw
    except Exception as e:
        log(f"⚠️ AI location guess failed: {e}")
        return None

# ---------------------------
# Location extraction helpers
# ---------------------------
def extract_dateline_location(text: str):
    if not text:
        return None
    m = DATELINE_REGEX.match(text)
    if m:
        raw = m.group(1).strip()
        return CUSTOM_LOCATIONS.get(raw.lower(), raw)
    return None

def extract_location_hint(text: str):
    if not text:
        return None
    m = PLACE_REGEX.search(text)
    if m:
        raw = m.group(1).strip()
        return CUSTOM_LOCATIONS.get(raw.lower(), raw)
    return None

# ---------------------------
# Geocoding with caching
# ---------------------------
def geocode_location(location_name):
    if not location_name:
        return None, None

    # Use exact cache hit (case-insensitive)
    key = location_name.strip().lower()
    if key in GEOCACHE:
        lat, lon = GEOCACHE[key]["lat"], GEOCACHE[key]["lon"]
        log(f"♻️ Geocache hit for '{location_name}' → ({lat}, {lon})")
        return lat, lon

    clean_name = (
        location_name.strip()
        .replace(" - ", ", ")
        .replace("Inc.", "")
        .replace("Headquarters", "")
        .strip(", ")
    )

    # Respect Nominatim rate limits
    time.sleep(1.2)
    try:
        loc = geolocator_nom.geocode(clean_name, timeout=10)
        if not loc:
            # try some common fallbacks
            loc = geolocator_nom.geocode(f"{clean_name}, United States", timeout=10)
        if loc:
            lat, lon = float(loc.latitude), float(loc.longitude)
            GEOCACHE[key] = {"query": clean_name, "lat": lat, "lon": lon}
            persist_caches()
            log(f"🗺️ Nominatim → '{clean_name}' → ({lat:.4f}, {lon:.4f})")
            return lat, lon
        else:
            log(f"⚠️ Nominatim returned no result for '{clean_name}'")
    except Exception as e:
        log(f"⚠️ Nominatim error for '{clean_name}': {e}")

    # Geoapify fallback (if available)
    if geolocator_geo:
        try:
            loc = geolocator_geo.geocode(clean_name, timeout=10)
            if loc:
                lat, lon = float(loc.latitude), float(loc.longitude)
                GEOCACHE[key] = {"query": clean_name, "lat": lat, "lon": lon}
                persist_caches()
                log(f"🌐 Geoapify → '{clean_name}' → ({lat:.4f}, {lon:.4f})")
                return lat, lon
            else:
                log(f"⚠️ Geoapify returned no result for '{clean_name}'")
        except Exception as e:
            log(f"⚠️ Geoapify error for '{clean_name}': {e}")

    return None, None

# ---------------------------
# Fetch, filter, classify, geocode, push
# ---------------------------
def fetch_and_process():
    # Query construction - focused topics
    TOPICS = [
        "geopolitics",
        "international relations",
        "war OR conflict",
        "finance OR stock market OR economic crisis",
        "technology OR AI OR semiconductor OR cyber attack",
        "natural disaster OR earthquake OR hurricane"
    ]
    QUERY = " OR ".join(TOPICS)
    url = f"https://newsapi.org/v2/everything?q={requests.utils.quote(QUERY)}&language=en&sortBy=publishedAt&pageSize=30&apiKey={NEWS_API_KEY}"
    log(f"Fetching news: {url}")

    try:
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        data = resp.json()
        articles = data.get("articles", [])
        log(f"Fetched {len(articles)} raw articles.")
    except Exception as e:
        log(f"❌ Failed to fetch news: {e}")
        return {}

    # Basic rejection filter for obvious fluff
    REJECT_KEYWORDS = [
        "recipe", "bake", "fashion", "celebrity", "film", "tv", "movie",
        "video game", "football", "nba", "halloween", "netflix", "prime video",
        "music", "album", "concert", "review", "sports", "holiday", "pets",
        "horoscope", "dating", "lifestyle", "garden", "cooking", "travel", "how to"
    ]

    filtered = []
    for art in articles:
        title = (art.get("title") or "").lower()
        desc = (art.get("description") or "").lower()
        if any(bad in title or bad in desc for bad in REJECT_KEYWORDS):
            continue
        filtered.append(art)
    articles = filtered
    log(f"Filtered down to {len(articles)} articles after fluff removal.")

    events = {}
    for i, art in enumerate(articles):
        title = art.get("title") or ""
        desc = art.get("description") or ""
        combined = f"{title} {desc}".strip()
        log(f"\n[{i+1}/{len(articles)}] Processing: {title}")

        # 1) Quick AI classification to decide whether to show and to tag topic/importance
        show, topic, importance = True, "other", 2
        if AI_CLASSIFY_ON and AI_IS_ON and OPENROUTER_KEY:
            try:
                show, topic, importance = ai_classify_article(art)
                log(f"Classification → show={show}, topic={topic}, importance={importance}")
            except Exception as e:
                log(f"⚠️ Classification error (fallback): {e}")
                show, topic, importance = True, "other", 2

        # If the classifier says do not show, skip this article
        if not show:
            log("⛔ AI decided to hide this article.")
            continue

        # 2) Resolve a location hint (dictionary, dateline, keyword, regex)
        src = (art.get("source") or {}).get("name", "") or ""
        src_key = src.lower().strip()
        loc_hint = None

        # Dictionary match on source
        if src_key in CUSTOM_LOCATIONS:
            loc_hint = CUSTOM_LOCATIONS[src_key]
            log(f"📕 Dictionary source match: {src_key} -> {loc_hint}")
        # dateline
        if not loc_hint:
            dateline = extract_dateline_location(combined)
            if dateline:
                loc_hint = dateline
                log(f"📰 Dateline match -> {loc_hint}")
        # keyword (whole-word)
        if not loc_hint:
            lower_text = combined.lower()
            dict_items_sorted = sorted(CUSTOM_LOCATIONS.items(), key=lambda kv: -len(kv[0]))
            for word, loc in dict_items_sorted:
                if len(word) <= 2:
                    continue
                if re.search(r'\b' + re.escape(word.lower()) + r'\b', lower_text):
                    loc_hint = loc
                    log(f"📗 Keyword match -> {word} -> {loc_hint}")
                    break
        # regex fallback ("in Paris")
        if not loc_hint:
            regex_hint = extract_location_hint(combined)
            if regex_hint:
                loc_hint = regex_hint
                log(f"📍 Regex match -> {loc_hint}")

        # 3) If still no loc hint, optionally ask AI to guess location (last resort)
        if not loc_hint and AI_LOCATION_FALLBACK_ON and AI_IS_ON and OPENROUTER_KEY:
            guess = ai_guess_location(art)
            if guess:
                loc_hint = guess
                log(f"🧩 AI-provided location hint -> {loc_hint}")

        if not loc_hint:
            log("❌ No location hint; skipping article.")
            continue

        # 4) Geocode resolved hint
        lat, lon = geocode_location(loc_hint)
        if lat is None or lon is None:
            log(f"❌ Geocoding failed for '{loc_hint}'; skipping.")
            continue

        # 5) Build event and include classification metadata
        key = f"news_{int(time.time())}_{i}"
        events[key] = {
            "title": title,
            "description": desc or "",
            "type": src or "General News",
            "url": art.get("url", ""),
            "lat": lat,
            "lon": lon,
            "timestamp": art.get("publishedAt") or datetime.utcnow().isoformat(),
            "topic": topic,
            "importance": int(importance),
        }

    return events

# ---------------------------
# Push events to Firebase (merge + keep 2 days)
# ---------------------------
def push_batch_events(new_events):
    fb_url = f"{FIREBASE_URL}/events.json"
    cutoff = datetime.utcnow() - timedelta(days=2)

    # Fetch existing
    try:
        old = requests.get(fb_url, timeout=10).json() or {}
        log(f"Fetched {len(old)} existing events from Firebase.")
    except Exception as e:
        log(f"⚠️ Could not fetch existing events: {e}")
        old = {}

    # Keep only recent events
    kept = {}
    for key, ev in old.items():
        try:
            ts = ev.get("timestamp")
            if not ts:
                continue
            # account for possible trailing Z
            ts_dt = datetime.fromisoformat(ts.replace("Z", ""))
            if ts_dt > cutoff:
                kept[key] = ev
        except Exception:
            # if timestamp parse fails, drop it
            continue

    log(f"Keeping {len(kept)} old events (newer than 2 days).")

    merged = {**kept, **new_events}
    try:
        r = requests.put(fb_url, data=json.dumps(merged), timeout=15)
        r.raise_for_status()
        log(f"✅ PUSH COMPLETE: {len(merged)} total events stored in Firebase.")
    except Exception as e:
        log(f"❌ PUSH FAILED: {e}")

# ---------------------------
# Main
# ---------------------------
if __name__ == "__main__":
    log("=== Starting Data Injection Job ===")
    events = fetch_and_process()
    if events:
        log(f"Pushing {len(events)} new events to Firebase...")
    else:
        log("No new events to push.")
    push_batch_events(events)
    log("=== Job Complete ===")
