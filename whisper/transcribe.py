#!/usr/bin/env python3
import sys, json, pathlib
from faster_whisper import WhisperModel, BatchedInferencePipeline

if len(sys.argv) < 2:
    print("Usage: transcribe.py <audio_path> [batch_size]")
    sys.exit(1)

audio = sys.argv[1]
batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else 8  # 3080 10GB: 8 is safe for FP16

model = WhisperModel("large-v3", device="cuda", compute_type="float16")
batched = BatchedInferencePipeline(model=model)

segments, info = batched.transcribe(
    audio,
    batch_size=batch_size,
    beam_size=5,
    vad_filter=True,
    word_timestamps=True,
    condition_on_previous_text=False,  # avoids drift on long files
)

# Collect segments
segments = list(segments)
out = pathlib.Path(audio)
stem = out.with_suffix("")

# TXT
with open(f"{stem}.txt", "w", encoding="utf-8") as f:
    f.write("".join(s.text for s in segments).strip() + "\n")

# SRT
def fmt_ts(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")

with open(f"{stem}.srt", "w", encoding="utf-8") as f:
    for i, s in enumerate(segments, 1):
        f.write(f"{i}\n{fmt_ts(s.start)} --> {fmt_ts(s.end)}\n{s.text.strip()}\n\n")

# VTT
with open(f"{stem}.vtt", "w", encoding="utf-8") as f:
    f.write("WEBVTT\n\n")
    for s in segments:
        f.write(f"{s.start:.3f} --> {s.end:.3f}\n{s.text.strip()}\n\n")

# JSON (with word-level timing)
payload = {
    "language": info.language,
    "language_probability": info.language_probability,
    "segments": [
        {
            "start": s.start, "end": s.end, "text": s.text,
            "words": [{"start": w.start, "end": w.end, "word": w.word} for w in (s.words or [])],
        }
        for s in segments
    ],
}
with open(f"{stem}.json", "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

print(f"done: {stem}.txt / .srt / .vtt / .json")
