$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$tools = Join-Path $root "tools"
$exe = Join-Path $tools "cloudflared.exe"
New-Item -ItemType Directory -Force -Path $tools | Out-Null

if (-not (Test-Path $exe)) {
  Write-Host "Downloading cloudflared..."
  $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
}

Write-Host "Exposing http://127.0.0.1:4000 for Vercel Word PDF conversion."
Write-Host "Keep this window open. The website PDF matches localhost only while this tunnel and npm run dev are running."
& $exe @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4000")
