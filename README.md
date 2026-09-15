# Feedly Generator

Browser-based cybersecurity briefing (Next.js). Same Feedly News Letter export as the Windows EXE: Word 97-2003 `.doc` plus PDF.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:4000

On a phone, use the same Wi‑Fi and this PC’s LAN address, for example `http://192.168.1.11:4000`.

## Export

**Export Report** fills the locked Feedly template with Microsoft Word on this PC, then saves:

- `Feedly News Letter YYYY-MM-DD.doc`
- `Feedly News Letter YYYY-MM-DD.pdf`

Word must be installed on Windows for the exact EXE layout. If Word is unavailable, the app falls back to a matching `.docx` / PDF layout.

## Notes

- Refresh pulls RSS plus HKCERT / GovCERT.HK / Cybersechub (today only)
- Cache lives in `data/cache.json` (not committed)
