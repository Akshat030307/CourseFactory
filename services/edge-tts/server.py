"""Minimal TTS sidecar. Free, no model download, no torch."""
import tempfile
import edge_tts
from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

VOICES = {
    "en": "en-US-AriaNeural",
    "hi": "hi-IN-SwaraNeural",
    "es": "es-ES-ElviraNeural",
}


class SpeakRequest(BaseModel):
    text: str
    lang: str = "en"


@app.post("/speak")
async def speak(req: SpeakRequest) -> FileResponse:
    voice = VOICES.get(req.lang, VOICES["en"])
    out = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    await edge_tts.Communicate(req.text, voice).save(out.name)
    return FileResponse(out.name, media_type="audio/mpeg")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}
