"""Stage 8 — Distribution (D2). Telegram bot, long polling (not webhooks —
works from localhost with no tunnel, per CLAUDE.md's demo integrity notes).

    python scripts/telegram_bot.py

Stage 15: registration (`/start <code>`) links this chat's Telegram user to
a real student account via a short-lived one-time code the student
generates from the logged-in web app (POST /telegram/link-code) — not the
old behavior where every `/start`, from anyone, silently re-linked the
SAME single demo student ("last /start wins"). `/due` serves due reviews
from `schedule` (D3); answering calls the gateway's own `POST /attempts` —
same mastery/schedule/remediation logic the SPA quiz uses, not a second
implementation of it. A wrong answer returns the remediation link exactly
like the in-app RemediationCard does, just as text instead of a UI.

Direct Postgres access here is limited to the telegram_id<->student_id
mapping and consuming link codes, neither of which has a gateway endpoint
of its own for this bot-specific use — everything quiz/schedule/attempt-
shaped goes through the gateway's REST API, reusing its already-tested
logic rather than a third reimplementation (the MCP server,
scripts/mcp_server.py, makes the same choice for the same reason).
"""

import logging
import os
from pathlib import Path

import asyncpg
import httpx
from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s: %(message)s")

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATABASE_URL = os.environ["DATABASE_URL"]
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:8000")
PUBLIC_HOST = os.environ.get("PUBLIC_HOST", "http://localhost:5173")
# Stage 13: the gateway now requires auth on every route (VPS deployment —
# see gateway/app/auth_middleware.py). This bot has no login flow of its
# own and shouldn't need one — it's a trusted, same-deployment caller, so
# it authenticates with the static service key instead of a user session.
SERVICE_API_KEY = os.environ.get("SERVICE_API_KEY", "")
GATEWAY_HEADERS = {"Authorization": f"Bearer {SERVICE_API_KEY}"}


def deep_link(lecture_id: str, timestamp_ms: int) -> str:
    return f"{PUBLIC_HOST}/lecture/{lecture_id}?t={timestamp_ms}"


async def _pool(context: ContextTypes.DEFAULT_TYPE) -> asyncpg.Pool:
    return context.application.bot_data["pool"]


async def _student_id_for(context: ContextTypes.DEFAULT_TYPE, telegram_id: str) -> str | None:
    pool = await _pool(context)
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT id FROM students WHERE telegram_id = $1", telegram_id)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    telegram_id = str(update.effective_user.id)

    if not context.args:
        await update.message.reply_text(
            "Log into Course Factory on the web, then use “Link Telegram” to get a one-time "
            "code — send it here as /start <code>."
        )
        return

    code = context.args[0].strip().upper()
    pool = await _pool(context)
    async with pool.acquire() as conn:
        student_id = await conn.fetchval(
            """
            UPDATE telegram_link_codes
            SET consumed_at = now()
            WHERE code = $1 AND consumed_at IS NULL AND expires_at > now()
            RETURNING student_id
            """,
            code,
        )
        if student_id is None:
            state = await conn.fetchrow(
                "SELECT consumed_at, expires_at FROM telegram_link_codes WHERE code = $1", code
            )
            if state is None:
                await update.message.reply_text("That code doesn't look right — double-check it and try again.")
            elif state["consumed_at"] is not None:
                await update.message.reply_text("That code's already been used — get a fresh one from the app.")
            else:
                await update.message.reply_text("That code has expired — get a fresh one from the app.")
            return

        async with conn.transaction():
            # telegram_id is UNIQUE — if this chat previously linked to a
            # different student (or the pre-Stage-15 demo student), free it
            # up before claiming it for the newly-linked account.
            await conn.execute("UPDATE students SET telegram_id = NULL WHERE telegram_id = $1 AND id != $2", telegram_id, student_id)
            await conn.execute("UPDATE students SET telegram_id = $1 WHERE id = $2", telegram_id, student_id)

    await update.message.reply_text(
        "You're linked. Send /due to see what's due for review."
    )


async def due(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    telegram_id = str(update.effective_user.id)
    student_id = await _student_id_for(context, telegram_id)
    if student_id is None:
        await update.message.reply_text("Not registered yet — send /start first.")
        return

    async with httpx.AsyncClient(headers=GATEWAY_HEADERS) as client:
        r = await client.get(f"{GATEWAY_URL}/api/v1/schedule", params={"student_id": student_id}, timeout=15)
        r.raise_for_status()
        due_questions = r.json()

    if not due_questions:
        await update.message.reply_text("Nothing due right now — check back later.")
        return

    q = due_questions[0]
    remaining = len(due_questions) - 1
    text = f"{q['lecture_title']}\n\n{q['prompt']}"
    if remaining:
        text += f"\n\n({remaining} more due after this one — send /due again once you've answered.)"
    keyboard = [[InlineKeyboardButton(o["text"], callback_data=f"answer:{q['question_id']}:{o['id']}")] for o in q["options"]]
    await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


async def on_answer(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    _, question_id, chosen_option_id = query.data.split(":", 2)

    telegram_id = str(update.effective_user.id)
    student_id = await _student_id_for(context, telegram_id)
    if student_id is None:
        await query.edit_message_text("Not registered — send /start first.")
        return

    async with httpx.AsyncClient(headers=GATEWAY_HEADERS) as client:
        r = await client.post(
            f"{GATEWAY_URL}/api/v1/attempts",
            json={"question_id": question_id, "chosen_option_id": chosen_option_id, "student_id": student_id},
            timeout=15,
        )
        r.raise_for_status()
        result = r.json()

    if result["correct"]:
        await query.edit_message_text("Correct.")
        return

    remediation = result.get("remediation")
    if remediation and remediation.get("found"):
        target = remediation["target"]
        link = deep_link(target["lecture_id"], target["timestamp_ms"])
        await query.edit_message_text(f"Not quite.\n\n{remediation['reason']}\n{link}")
    else:
        await query.edit_message_text("Not quite. Send /due to keep going.")


async def _on_startup(app: Application) -> None:
    app.bot_data["pool"] = await asyncpg.create_pool(DATABASE_URL)


async def _on_shutdown(app: Application) -> None:
    await app.bot_data["pool"].close()


def main() -> None:
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).post_init(_on_startup).post_shutdown(_on_shutdown).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("due", due))
    app.add_handler(CallbackQueryHandler(on_answer, pattern=r"^answer:"))
    app.run_polling()


if __name__ == "__main__":
    main()
