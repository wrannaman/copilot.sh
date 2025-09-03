#!/usr/bin/env python3
import os
import sys
import json
import pathlib

# Minimal WhisperX runner with diarization

def main():
    if len(sys.argv) < 2:
        print("Usage: whisperx_transcribe.py <audio_path>", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]

    try:
        import torch  # noqa: F401
        import whisperx  # type: ignore
    except Exception as e:
        print(json.dumps({
            "error": f"Failed to import whisperx/torch: {e}" 
        }), flush=True)
        sys.exit(2)

    # Device and compute type
    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        device = "cpu"

    model_id = os.environ.get("WHISPERX_MODEL_ID", "large-v2")
    batch_size = int(os.environ.get("WHISPERX_BATCH_SIZE", "8"))
    compute_type = "float16" if device == "cuda" else os.environ.get("WHISPERX_COMPUTE_TYPE", "int8")
    hf_token = (
        os.environ.get("HUGGING_FACE_HUB_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
        or os.environ.get("HF_TOKEN")
    )

    try:
        model = whisperx.load_model(model_id, device, compute_type=compute_type)
        audio = whisperx.load_audio(audio_path)

        # 1) ASR
        asr = model.transcribe(audio, batch_size=batch_size)

        # 2) Alignment
        lang = asr.get("language")
        align_model, metadata = whisperx.load_align_model(language_code=lang, device=device)
        aligned = whisperx.align(asr["segments"], align_model, metadata, audio, device, return_char_alignments=False)

        # 3) Diarization
        diarize_segments = None
        diarized = aligned
        if hf_token:
            diarizer = whisperx.diarize.DiarizationPipeline(use_auth_token=hf_token, device=device)
            diarize_segments = diarizer(audio)
            diarized = whisperx.assign_word_speakers(diarize_segments, aligned)

        # Minimal JSON payload similar to WhisperX's structure
        out = {
            "language": lang,
            "segments": diarized.get("segments", []),
            "diarize_segments": diarize_segments if diarize_segments is not None else [],
        }

        # Ensure words exist as list for each segment
        for seg in out["segments"]:
            seg["text"] = seg.get("text", "")
            if "words" not in seg or seg["words"] is None:
                seg["words"] = []

        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "error": f"WhisperX processing failed: {e}" 
        }), flush=True)
        sys.exit(3)

if __name__ == "__main__":
    main()


