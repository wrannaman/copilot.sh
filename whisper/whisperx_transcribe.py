#!/usr/bin/env python3
import os
import sys
import json
import pathlib
import logging

# Minimal WhisperX runner with diarization

def main():
    logging.basicConfig(level=logging.INFO, format='[whisperx] %(message)s')
    if len(sys.argv) < 2:
        print("Usage: whisperx_transcribe.py <audio_path> [out_json_path]", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    out_json_path = sys.argv[2] if len(sys.argv) >= 3 else None

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
        logging.info(f"device={device} torch={getattr(torch, '__version__', 'unknown')}")
    except Exception:
        device = "cpu"

    # Cache dirs to avoid re-downloading models each run
    cache_root = os.environ.get("WHISPERX_CACHE_DIR", os.path.expanduser("~/.cache/whisperx"))
    os.makedirs(cache_root, exist_ok=True)
    os.environ.setdefault("HF_HOME", os.path.join(cache_root, "hf"))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(cache_root, "hf"))
    os.environ.setdefault("TRANSFORMERS_CACHE", os.path.join(cache_root, "transformers"))
    os.environ.setdefault("TORCH_HOME", os.path.join(cache_root, "torch"))
    os.environ.setdefault("XDG_CACHE_HOME", cache_root)

    model_id = os.environ.get("WHISPERX_MODEL_ID", "large-v3")
    batch_size = int(os.environ.get("WHISPERX_BATCH_SIZE", "8"))
    beam_size = int(os.environ.get("WHISPERX_BEAM_SIZE", "5"))
    compute_type = "float16" if device == "cuda" else os.environ.get("WHISPERX_COMPUTE_TYPE", "int8")
    hf_token = (
        os.environ.get("HUGGING_FACE_HUB_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
        or os.environ.get("HF_TOKEN")
    )

    try:
        logging.info(f"cache_root={cache_root}")
        logging.info(f"load_model id={model_id} compute_type={compute_type} batch_size={batch_size} beam_size={beam_size}")
        model = whisperx.load_model(model_id, device, compute_type=compute_type, download_root=cache_root)
        audio = whisperx.load_audio(audio_path)

        # 1) ASR (use higher beam size for accuracy)
        try:
            asr = model.transcribe(audio, batch_size=batch_size, beam_size=beam_size)
        except TypeError:
            logging.info("beam_size not supported by backend; using default")
            asr = model.transcribe(audio, batch_size=batch_size)

        # 2) Alignment
        lang = asr.get("language")
        # Alignment uses HF caches set above; some versions also accept model_dir
        try:
            align_model, metadata = whisperx.load_align_model(language_code=lang, device=device, model_dir=cache_root)
        except TypeError:
            align_model, metadata = whisperx.load_align_model(language_code=lang, device=device)
        aligned = whisperx.align(asr["segments"], align_model, metadata, audio, device, return_char_alignments=False)

        # 3) Diarization
        diarize_segments = None
        diarized = aligned
        if hf_token:
            diarizer = whisperx.diarize.DiarizationPipeline(use_auth_token=hf_token, device=device)
            diarize_segments = diarizer(audio)
            diarized = whisperx.assign_word_speakers(diarize_segments, aligned)

        # Minimal JSON payload (segments contain speaker info; diarize_segments may be a DataFrame → omit)
        out = {
            "language": lang,
            "segments": diarized.get("segments", []),
        }

        # Ensure words exist as list for each segment
        for seg in out["segments"]:
            seg["text"] = seg.get("text", "")
            if "words" not in seg or seg["words"] is None:
                seg["words"] = []

        if out_json_path:
            try:
                os.makedirs(os.path.dirname(out_json_path), exist_ok=True)
            except Exception:
                pass
            with open(out_json_path, 'w', encoding='utf-8') as f:
                json.dump(out, f, ensure_ascii=False, indent=2)
            logging.info(f"wrote json: {out_json_path}")
            # Also print the path for convenience
            print(json.dumps({"path": out_json_path}))
        else:
            print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        logging.exception("whisperx failure")
        print(json.dumps({
            "error": f"WhisperX processing failed: {e}" 
        }), flush=True)
        sys.exit(3)

if __name__ == "__main__":
    main()


