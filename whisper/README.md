# WhisperX (GPU, diarization)

This directory contains the WhisperX runner used by the worker.

## Requirements (GPU)

- NVIDIA GPU with compatible CUDA & cuDNN
- Python 3.11 (recommended)
- Hugging Face token with access to diarization models
  - Accept licenses in your browser once: `pyannote/segmentation` and `pyannote/Speaker-Diarization-3.1`

## Create a clean Python env and install deps

```bash
conda create -n whisperx311 python=3.11 -y
conda activate whisperx311
pip install -U -r whisper/requirements.txt
# Install PyTorch with CUDA via conda for best compatibility:
# conda install pytorch pytorch-cuda=12.1 -c pytorch -c nvidia

export HUGGING_FACE_HUB_TOKEN="<your_hf_token>"
```

## Manual test

```bash
python whisper/whisperx_transcribe.py /path/to/audio.wav
```

The script prints JSON to stdout with segments (and speakers if token provided).

## Wire the worker to this env

Option 1 (env var):
```bash
export WHISPERX_PYTHON="/home/you/anaconda3/envs/whisperx311/bin/python"
node worker/index.js
```

Option 2 (hardcode): edit `worker/lib/audio.js` and set the Python path where indicated.

## Outputs

- Storage bucket `copilot.sh`:
  - `transcripts/<org>/<session>.whisperx.json`
  - `transcripts/<org>/<session>.whisperx.txt`
- DB `sessions` row: `whisperx_json_path`, `whisperx_text_path`, `whisperx_status`, `whisperx_started_at`, `whisperx_error`

## Troubleshooting

- If you see cuDNN errors (e.g., `libcudnn_ops_infer.so.8`), install matching cuDNN for your CUDA.
- NumPy/SciPy ABI issues? Use the clean Python 3.11 env above.
- Token missing → diarization will fail. Ensure `HUGGING_FACE_HUB_TOKEN` is set.
