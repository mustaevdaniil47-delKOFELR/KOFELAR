import os
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.responses import JSONResponse
import requests

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
ACTION_API_KEY = os.environ["ACTION_API_KEY"]  # ключ для защиты твоего эндпоинта
OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"

app = FastAPI()

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    diarize: bool = Form(True),
    x_api_key: str | None = Header(default=None),
):
    # Простая защита эндпоинта
    if not x_api_key or x_api_key != ACTION_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    model = "gpt-4o-transcribe-diarize" if diarize else "gpt-4o-transcribe"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}

    data = {"model": model}
    if language:
        data["language"] = language

    # ВАЖНО:
    # - для diarize нужно response_format="diarized_json", чтобы получить спикеров
    # - для длинных аудио (больше ~30 сек) лучше включить chunking="auto"
    if diarize:
        data["response_format"] = "diarized_json"
        data["chunking"] = "auto"

    files = {"file": (file.filename, audio_bytes, file.content_type or "audio/mpeg")}

    r = requests.post(OPENAI_URL, headers=headers, data=data, files=files, timeout=180)
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {r.status_code} {r.text}")

    payload = r.json()

    # Нормализуем ответ под GPT
    out = {
        "text": payload.get("text", ""),
        "duration": payload.get("duration"),
        "segments": []
    }

    for seg in payload.get("segments", []) or []:
        out["segments"].append({
            "speaker": str(seg.get("speaker", "unknown")),
            "start": float(seg.get("start", 0)),
            "end": float(seg.get("end", 0)),
            "text": seg.get("text", "")
        })

    return JSONResponse(out)
