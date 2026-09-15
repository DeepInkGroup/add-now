# ADD NOW

ADD NOW is a focused, installable media player for people who already know what they want to watch. Paste a YouTube, Vimeo, Spotify, SoundCloud, or direct audio/video link; the app plays it in a clean interface without adding its own ads, analytics, or recommendation feed.

## Highlights

- Installable PWA with offline app-shell support
- iPhone-safe layout, home-screen metadata, and native share support
- YouTube privacy-enhanced embeds (`youtube-nocookie.com`)
- Vimeo Do Not Track embeds
- Direct MP4, WebM, MP3, M4A, OGG, WAV, FLAC, and HLS URL recognition
- Spotify and SoundCloud embeds
- Local-only queue and preference storage
- Responsive desktop and mobile design
- Keyboard-friendly controls and reduced-motion support

## Run locally

This is a dependency-free static app. Serve the folder with any local web server:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173`.

Service workers and PWA installation require HTTPS in production (localhost is allowed for development).

## Privacy and ad-blocking scope

ADD NOW adds no advertising or tracking of its own and uses privacy-minded embed options where providers expose them. Direct media links play without an advertising layer from this app.

A web app cannot inspect or remove ads injected inside cross-origin YouTube, Vimeo, Spotify, or SoundCloud players. Claiming otherwise would be misleading and could violate provider rules. Provider-controlled ads may still appear. For system-wide blocking, use browser or DNS-level content controls that are legal and appropriate in your region.

## Deployment

All URLs are relative, so the app works from a GitHub Pages project path as well as a custom domain. Publish the repository root as a static site.

## License

MIT
