# Built-in sample instruments (CC0)

These packs power the **Sample instruments** group in the instrument picker. Each
instrument is a small set of MP3 (`.mp3`) zones plus a `manifest.json`. The app
lazy-loads a pack only when a user first selects that instrument, then caches it in
Cache Storage so it works offline while the browser retains that cache. The pack files
ship with the deployment, but are excluded from the PWA shell precache; they do not
increase the first offline install. Settings can cache the complete 2.9 MB library in
one deliberate step.

## The audio files

The checked-in MP3 audio is reproducible with:

```bash
node scripts/build-sample-packs.mjs            # all instruments
node scripts/build-sample-packs.mjs marimba    # a subset
```

The script downloads the source samples, picks a few zones per instrument (so packs
stay tiny), corrects the octave labelling, and transcodes to the files listed in each
`manifest.json`. Requirements: Node 20.19+, `curl`, and `ffmpeg` with `libmp3lame`.
It records source paths, source Git blob IDs, and output SHA-256 hashes in rebuilt
manifests.

## Source & licence

All samples derive from the **Versilian Community Sample Library (VCSL)** —
<https://github.com/sgossner/VCSL> — released under **CC0 1.0 (public domain)**.
No attribution is required; it is noted here as a courtesy. Because the audio is CC0,
it is fully compatible with this project's MIT licence. Rebuilds are pinned to VCSL
revision `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`, rather than the moving `master`
branch.

## Format

Mono **MP3** (`.mp3`), ~88–96 kbps, silence-trimmed and length-capped. MP3 is used
because `decodeAudioData` supports it on **every** target browser — including
open-source **Chromium on Linux** (which omits the AAC codec) and **iOS Safari**.
(Ogg/Opus fail to decode in Safari; AAC fails in codec-free Chromium.)
