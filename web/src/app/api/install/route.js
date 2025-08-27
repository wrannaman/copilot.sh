import { NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const deviceKey = url.searchParams.get('device_key') || url.searchParams.get('key') || ''
    if (!deviceKey) {
      return new NextResponse('# Missing device_key in query', { status: 400, headers: { 'Content-Type': 'text/x-sh; charset=utf-8' } })
    }

    const svc = createServiceClient()
    const { data: row, error } = await svc
      .from('device_api_keys')
      .select('id, active')
      .eq('key', deviceKey)
      .maybeSingle()

    if (error || !row || row.active === false) {
      return new NextResponse('# Unauthorized device key', { status: 401, headers: { 'Content-Type': 'text/x-sh; charset=utf-8' } })
    }

    const origin = url.origin
    const script = `#!/usr/bin/env bash
set -euo pipefail

API_BASE="${origin}"
DEVICE_KEY="${deviceKey}"

echo "==> Installing copilot.sh device on Raspberry Pi"
echo "    API: $API_BASE"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y alsa-utils python3 python3-pip

mkdir -p ~/copilot-device
cd ~/copilot-device

cat > .env <<EOF
API=$API_BASE
DEVICE_API_KEY=$DEVICE_KEY
EOF

curl -fsSL "$API_BASE/api/install/copilot" -o copilot.py
chmod +x copilot.py

python3 -m pip install --upgrade pip
python3 -m pip install requests python-dotenv

echo "==> Install complete. To start now, run:"
echo "    python3 copilot.py"
echo "==> To run in background:"
echo "    nohup python3 copilot.py >/var/log/copilot.log 2>&1 &"
`

    return new NextResponse(script, {
      status: 200,
      headers: {
        'Content-Type': 'text/x-sh; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    })
  } catch (err) {
    return new NextResponse(`# Install failed: ${err?.message || 'unknown error'}`, { status: 500, headers: { 'Content-Type': 'text/x-sh; charset=utf-8' } })
  }
}


