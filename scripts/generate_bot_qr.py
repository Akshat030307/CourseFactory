"""Stage 8 — Distribution (D2). Generates the QR code judges scan to reach
the Telegram bot for the demo (CLAUDE.md's demo beat 4).

    python scripts/generate_bot_qr.py

Looks up the bot's own username via getMe rather than hardcoding it, so
this stays correct if the bot is ever recreated under a different name.
"""

import os
from pathlib import Path

import httpx
import qrcode
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
# media/public/, not media/ directly — Stage 13's auth gate protects real
# course content under /media/*, but this QR code is embedded on the
# public landing page (no login wall) and needs to stay visible to
# anonymous visitors. gateway/app/auth_middleware.py carves out exactly
# this one subpath as the exception.
OUT_PATH = Path(__file__).resolve().parents[1] / "media" / "public" / "telegram_bot_qr.png"


def main() -> None:
    r = httpx.get(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getMe", timeout=15)
    r.raise_for_status()
    username = r.json()["result"]["username"]
    url = f"https://t.me/{username}"

    img = qrcode.make(url)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT_PATH)
    print(f"{url}\nsaved to {OUT_PATH}")


if __name__ == "__main__":
    main()
