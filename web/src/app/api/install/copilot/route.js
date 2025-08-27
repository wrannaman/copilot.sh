import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  const content = `#!/usr/bin/env python3
import os, sys, time, subprocess, requests
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

API_BASE = os.getenv('API', '').rstrip('/')
DEVICE_API_KEY = os.getenv('DEVICE_API_KEY', '')
TRANSCRIBE_URL = f"{API_BASE}/api/transcribe"

def record_wav_chunk(seconds=5):
    cmd = ['arecord','-q','-f','S16_LE','-r','16000','-c','1','-d',str(seconds),'-t','wav','-']
    p = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.stdout

def send_chunk(audio_bytes):
    headers = {'Authorization': f'Bearer {DEVICE_API_KEY}'} if DEVICE_API_KEY else {}
    files = {'chunk': ('chunk.wav', audio_bytes, 'audio/wav')}
    data = {'mode': 'cloud', 'mimeType': 'audio/wav'}
    r = requests.post(TRANSCRIBE_URL, headers=headers, files=files, data=data, timeout=60)
    try:
        j = r.json()
    except Exception:
        j = {}
    print(r.status_code, j.get('text',''))

def main():
    if not API_BASE or not DEVICE_API_KEY:
        print('Missing API or DEVICE_API_KEY in env', file=sys.stderr)
        sys.exit(1)
    while True:
        try:
            audio = record_wav_chunk(5)
            send_chunk(audio)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print('[error]', e, file=sys.stderr)
            time.sleep(2)

if __name__ == '__main__':
    main()
`
  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-python; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}


