#!/usr/bin/env python3
import os
import sys
import time
import subprocess
import requests

try:
    from dotenv import load_dotenv  # optional
    load_dotenv()
except Exception:
    pass


def getenv(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return value if value is not None else default


API_BASE = getenv("API", "http://localhost:3000").rstrip("/")
DEVICE_API_KEY = getenv("DEVICE_API_KEY", "")

TRANSCRIBE_URL = f"{API_BASE}/api/transcribe"


def record_wav_chunk(seconds: int = 5) -> bytes:
    """Record audio using ALSA arecord into WAV 16kHz mono and return bytes."""
    # arecord params: 16-bit little endian, 16kHz, mono, duration N seconds, WAV to stdout
    cmd = [
        "arecord",
        "-q",
        "-f",
        "S16_LE",
        "-r",
        "16000",
        "-c",
        "1",
        "-d",
        str(seconds),
        "-t",
        "wav",
        "-",
    ]
    try:
        proc = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return proc.stdout
    except FileNotFoundError:
        print("arecord not found. Install ALSA utilities: sudo apt-get install alsa-utils", file=sys.stderr)
        raise
    except subprocess.CalledProcessError as e:
        print(f"arecord failed: {e.stderr.decode(errors='ignore')}", file=sys.stderr)
        raise


def send_chunk(audio_bytes: bytes) -> None:
    headers = {}
    if DEVICE_API_KEY:
        headers["Authorization"] = f"Bearer {DEVICE_API_KEY}"

    files = {
        "chunk": ("chunk.wav", audio_bytes, "audio/wav"),
    }
    data = {
        "mode": "cloud",
        "mimeType": "audio/wav",
    }

    try:
        resp = requests.post(TRANSCRIBE_URL, headers=headers, files=files, data=data, timeout=60)
        if resp.status_code == 200:
            j = {}
            try:
                j = resp.json()
            except Exception:
                pass
            text = j.get("text") if isinstance(j, dict) else None
            if text:
                print(f"[ok] {len(audio_bytes)} bytes → '{text[:120]}'")
            else:
                print(f"[ok] {len(audio_bytes)} bytes (no text)")
        else:
            print(f"[error] {resp.status_code} {resp.text[:200]}", file=sys.stderr)
    except Exception as e:
        print(f"[error] upload failed: {e}", file=sys.stderr)


def main():
    if not DEVICE_API_KEY:
        print("Warning: DEVICE_API_KEY not set. Server must allow anonymous or reject.", file=sys.stderr)

    print(f"copilot.py starting. Posting to {TRANSCRIBE_URL}")
    while True:
        try:
            audio = record_wav_chunk(seconds=5)
            send_chunk(audio)
        except KeyboardInterrupt:
            print("Exiting...")
            break
        except Exception as e:
            print(f"[loop error] {e}", file=sys.stderr)
            time.sleep(2)


if __name__ == "__main__":
    main()
