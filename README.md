# ADD NOW

ADD NOW is a focused, installable media player for deliberate watching. Paste a media link or search for a YouTube creator, browse their latest public uploads, and build a clean local queue without adding an app-owned recommendation feed.

## Highlights

- Installable PWA with offline app-shell support
- iPhone-safe layout, home-screen metadata, and native share support
- YouTube privacy-enhanced embeds (`youtube-nocookie.com`)
- YouTube creator-name and `@handle` search using the official Data API
- Paginated browsing of a selected creator's public uploads
- YouTube playlist-link recognition and playback
- Vimeo Do Not Track embeds
- Direct MP4, WebM, MP3, M4A, OGG, WAV, FLAC, and HLS URL recognition
- Live link-format/compatibility insight and measured direct-video resolution
- Direct-media speed controls and picture-in-picture support
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

## Enable creator search

Creator discovery uses the official YouTube Data API v3 rather than scraping YouTube. Create an API key in [Google Cloud Console](https://console.cloud.google.com/), enable **YouTube Data API v3**, then select **Find a creator → Search settings** in the app and save the key.

The key is stored only in that browser's local storage and sent only to Google's YouTube API. Restrict it in Google Cloud to:

- YouTube Data API v3
- HTTP referrers for your deployed domain, such as `https://deepinkgroup.github.io/add-now/*`

Channel discovery uses `search.list`; after a channel is selected, ADD NOW retrieves its uploads playlist and pages through it with `playlistItems.list`.

## Privacy and ad-blocking scope

ADD NOW adds no advertising or tracking of its own and uses privacy-minded embed options where providers expose them. Direct media links play without an advertising layer from this app.

A web app cannot inspect or remove ads injected inside cross-origin YouTube, Vimeo, Spotify, or SoundCloud players. Claiming otherwise would be misleading and could violate provider rules. Provider-controlled ads may still appear. For system-wide blocking, use browser or DNS-level content controls that are legal and appropriate in your region.

## Deployment

All URLs are relative, so the app works from a GitHub Pages project path as well as a custom domain. Publish the repository root as a static site.

## License

MIT
