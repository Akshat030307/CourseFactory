"""Stage 9 — Depth (X2). Run once a lecture's segments are ingested:

    python scripts/generate_translations.py --lecture-id l01

DeepL Free for the showcase language (Hindi — the only language edge-tts's
sidecar has a dedicated neural voice configured for besides English and
Spanish), Groq for the rest (Spanish here). Registers `captions` (VTT) and
`audio` (narrated MP3) tracks for each language.

**Cost tradeoff, stated plainly rather than pretended away (CLAUDE.md):**
DeepL Free is 500K characters/month. A single 10-minute fixture transcript
is only a few thousand characters, so the fixture set is nowhere close to
that limit — but a real 3-hour lecture (~150K characters) would burn
roughly a third of the *entire monthly* free quota on ONE language for ONE
lecture. This does not scale past a demo; a real product would need DeepL
Pro or route more languages through Groq.

`GROQ_MODEL_FAST` was `llama-3.1-8b-instant` — the model CLAUDE.md's cost
notes originally named for this ("Groq 8B... for the rest"). That model
404s now (see CLAUDE.md's Verified section, found in D1) and was already
repointed to `openai/gpt-oss-20b`; this script uses that same corrected
value rather than reintroducing the dead one.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import httpx
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# Windows' console defaults to cp1252, which can't encode Hindi/Devanagari
# (or plenty else) — found the hard way when a plain print() of translated
# text crashed the script after the real API work had already happened,
# losing it before the file write. Every other script here has stuck to
# ASCII-safe output; this one can't, since printing a translation preview
# is the whole point.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
MEDIA_ROOT = Path(__file__).resolve().parents[1] / "media"
DEEPL_API_KEY = os.environ.get("DEEPL_API_KEY", "").strip()
DEEPL_URL = "https://api-free.deepl.com/v2/translate"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL_FAST = os.environ.get("GROQ_MODEL_FAST", "openai/gpt-oss-20b")
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL_SMALL = os.environ.get("OPENAI_MODEL_SMALL", "gpt-5-nano")
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
EDGE_TTS_URL = os.environ.get("EDGE_TTS_URL", "http://localhost:5002")

# lang code -> (DeepL target code or None if Groq-only, edge-tts lang key)
SHOWCASE_LANG = ("hi", "HI")  # DeepL
GROQ_LANGS = [("es", "Spanish")]

BATCH_SIZE = 40  # segments per Groq translation call — short lecture transcripts fit in 1-2 batches


def translate_deepl(texts: list[str], target: str) -> list[str]:
    # DeepL caps requests at 50 texts each — a 10-min fixture transcript
    # (~150-170 segments) blows past that in one call, batch or truncate.
    out: list[str] = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        # httpx's `data=` doesn't accept a list-of-tuples for repeated form
        # keys the way its own type hints suggest (confirmed directly —
        # raises TypeError deep in h11's body encoder) — DeepL needs
        # multiple `text` fields in one request, so build the
        # x-www-form-urlencoded body by hand instead.
        body = urlencode({"text": batch, "target_lang": target}, doseq=True)
        r = httpx.post(
            DEEPL_URL,
            headers={
                "Authorization": f"DeepL-Auth-Key {DEEPL_API_KEY}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            content=body,
            timeout=30,
        )
        r.raise_for_status()
        out.extend(t["text"] for t in r.json()["translations"])
    return out


def translate_groq(texts: list[str], lang_name: str) -> list[str]:
    """`openai/gpt-oss-20b` is a reasoning model with an 8000 TPM cap on
    this account's free tier — two real failure modes found running this
    for real, not in isolation:
    1. `reasoning_effort: "low"` (the fix every other reasoning-model call
       in this project needed) backfires here — it made the model rush and
       silently return 3 of 15 translations with finish_reason="stop" (not
       "length" — it genuinely believed it was done). Every other script's
       fix for reasoning models was "spend less time reasoning"; this one
       needed the opposite. Leaving reasoning_effort unset lets it spend
       ~840 tokens actually thinking through a 15-item batch and return all
       15. Confirmed at the real batch size (40 items) too: 40/40 correct.
    2. Explicitly stating the expected count in the prompt ("must contain
       exactly N translations") measurably helped as a guardrail even
       once reasoning_effort was fixed.
    `by_i.get(j, batch[j])` below is a second line of defense on top of
    both fixes, not a substitute for them — falls back to the original text
    for any index the model still drops, rather than crashing.
    """
    out: list[str] = []
    for batch_num, i in enumerate(range(0, len(texts), BATCH_SIZE)):
        if batch_num > 0:
            # The 8000 TPM cap is a *rolling* window across every request in
            # the last minute, not per-request — found by hitting 413 on the
            # 3rd/4th batch of a real 153-segment lecture even though each
            # individual batch was well under 8000 on its own. Pacing batches
            # out is cheaper than a real retry-and-wait loop here.
            time.sleep(15)
        batch = texts[i : i + BATCH_SIZE]
        payload = json.dumps([{"i": j, "text": t} for j, t in enumerate(batch)])
        system = (
            f'Translate each "text" field to {lang_name}. Return strict JSON: '
            '{"translations": [{"i": 0, "text": "..."}]} — same count and order as the input, i matching. '
            f"There are {len(batch)} items in the input; your output MUST contain exactly {len(batch)} translations."
        )
        by_i: dict[int, str] | None = None
        for attempt in range(2):
            try:
                r = httpx.post(
                    GROQ_CHAT_URL,
                    headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                    json={
                        "model": GROQ_MODEL_FAST,
                        "response_format": {"type": "json_object"},
                        # Groq's rate limiter checks the *requested* cap, not
                        # actual usage — confirmed from the 413 body itself
                        # ("Limit 8000, Requested 8970" when this was 8000 +
                        # ~970 prompt tokens, despite the model only using
                        # ~2800 completion tokens once it succeeded). Sized to
                        # realistic usage (a 40-item batch used ~2800) plus
                        # headroom, not a padded ceiling.
                        "max_completion_tokens": 3500,
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": payload}],
                    },
                    timeout=90,
                )
                r.raise_for_status()
                result = json.loads(r.json()["choices"][0]["message"]["content"])
                by_i = {t["i"]: t["text"] for t in result["translations"]}
                break
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (413, 429) and attempt == 0:
                    time.sleep(20)
                    continue
                if e.response.status_code in (413, 429) and OPENAI_API_KEY:
                    # CLAUDE.md's fallback rule: degrading to a cheap OpenAI
                    # call beats erroring in front of a judge. This account's
                    # free-tier TPM (8000) is tight enough that a real
                    # 150+-segment lecture routinely exhausts it even with
                    # 15s pacing between batches — found running this for
                    # real, not a hypothetical to guard against.
                    print(f"  Groq rate-limited twice for this batch — falling back to {OPENAI_MODEL_SMALL}")
                    by_i = _translate_batch_openai(batch, lang_name)
                    break
                raise

        missing = [j for j in range(len(batch)) if by_i is None or j not in by_i]
        if missing:
            print(f"  warning: {len(missing)}/{len(batch)} items in this batch fell back to untranslated text")
        out.extend((by_i or {}).get(j, batch[j]) for j in range(len(batch)))
    return out


def _translate_batch_openai(batch: list[str], lang_name: str) -> dict[int, str]:
    payload = json.dumps([{"i": j, "text": t} for j, t in enumerate(batch)])
    system = (
        f'Translate each "text" field to {lang_name}. Return strict JSON: '
        '{"translations": [{"i": 0, "text": "..."}]} — same count and order as the input, i matching. '
        f"There are {len(batch)} items in the input; your output MUST contain exactly {len(batch)} translations."
    )
    r = httpx.post(
        OPENAI_CHAT_URL,
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        json={
            "model": OPENAI_MODEL_SMALL,
            "response_format": {"type": "json_object"},
            "reasoning_effort": "low",
            "max_completion_tokens": 4000,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": payload}],
        },
        timeout=90,
    )
    r.raise_for_status()
    result = json.loads(r.json()["choices"][0]["message"]["content"])
    return {t["i"]: t["text"] for t in result["translations"]}


def to_vtt(segments: list[dict], texts: list[str]) -> str:
    lines = ["WEBVTT", ""]
    for seg, text in zip(segments, texts):
        lines.append(vtt_ts(seg["start_ms"]) + " --> " + vtt_ts(seg["end_ms"]))
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def vtt_ts(ms: int) -> str:
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def register_track(cur, lecture_id: str, kind: str, lang: str, path: Path) -> None:
    url = f"/media/{lecture_id}/{path.name}"
    cur.execute(
        """
        INSERT INTO tracks (lecture_id, kind, lang, path) VALUES (%s, %s, %s, %s)
        ON CONFLICT (lecture_id, kind, lang) DO UPDATE SET path = EXCLUDED.path
        """,
        (lecture_id, kind, lang, url),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lecture-id", required=True)
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT start_ms, end_ms, text FROM segments WHERE lecture_id = %s ORDER BY start_ms", (args.lecture_id,))
        segments = cur.fetchall()
        if not segments:
            raise SystemExit(f"no segments for {args.lecture_id} — run scripts/ingest.py first")

        out_dir = MEDIA_ROOT / args.lecture_id
        out_dir.mkdir(parents=True, exist_ok=True)

        jobs = [(SHOWCASE_LANG[0], "deepl")] + [(code, "groq") for code, _ in GROQ_LANGS]
        for lang, provider in jobs:
            texts = [s["text"] for s in segments]
            if provider == "deepl":
                translated = translate_deepl(texts, SHOWCASE_LANG[1])
            else:
                lang_name = next(name for code, name in GROQ_LANGS if code == lang)
                translated = translate_groq(texts, lang_name)
            print(f"{lang} ({provider}): {translated[0][:60]}")

            vtt_path = out_dir / f"{lang}.vtt"
            vtt_path.write_text(to_vtt(segments, translated), encoding="utf-8")
            register_track(cur, args.lecture_id, "captions", lang, vtt_path)

            full_text = " ".join(translated)
            audio_r = httpx.post(f"{EDGE_TTS_URL}/speak", json={"text": full_text, "lang": lang}, timeout=120)
            audio_r.raise_for_status()
            audio_path = out_dir / f"{lang}.mp3"
            audio_path.write_bytes(audio_r.content)
            register_track(cur, args.lecture_id, "audio", lang, audio_path)
            print(f"  wrote {vtt_path.name}, {audio_path.name} ({audio_path.stat().st_size} bytes)")

    conn.commit()
    print(f"registered translation tracks for {args.lecture_id}")
    conn.close()


if __name__ == "__main__":
    main()
