"""
OpenAI-compatible Whisper transcription API.
Matches the /v1/audio/transcriptions endpoint spec.
"""

import os
import pathlib
import tempfile

from flask import Flask, request, jsonify
from faster_whisper import WhisperModel

ACTIVITY_FILE = pathlib.Path("/tmp/.last-activity")

app = Flask(__name__)
_model = None


def get_model():
    global _model
    if _model is None:
        model_dir = os.environ.get("WHISPER_MODEL_DIR", "/workspace/whisper-models")
        model_size = os.environ.get("WHISPER_MODEL_SIZE", "large-v3-turbo")
        _model = WhisperModel(
            model_size,
            device="cuda",
            compute_type="float16",
            download_root=model_dir,
        )
    return _model


@app.route("/v1/audio/transcriptions", methods=["POST"])
def transcribe():
    audio_file = request.files.get("file")
    if not audio_file:
        return jsonify({"error": "No audio file provided"}), 400

    language = request.form.get("language")
    response_format = request.form.get("response_format", "json")

    ACTIVITY_FILE.touch(exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
        audio_file.save(tmp.name)
        kwargs = {}
        if language:
            kwargs["language"] = language
        segments, info = get_model().transcribe(tmp.name, **kwargs)
        text = " ".join(s.text for s in segments)

    if response_format == "text":
        return text.strip(), 200, {"Content-Type": "text/plain"}

    return jsonify({
        "text": text.strip(),
        "language": info.language,
        "duration": info.duration,
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})
