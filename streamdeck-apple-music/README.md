# Apple Music Stream Deck Companion

MVP for assigning Apple Music album URLs from a local macOS SwiftUI app to a specific Stream Deck key.

## Project Structure

```text
streamdeck-apple-music/
├── README.md
├── macos-companion/
│   ├── Package.swift
│   └── Sources/AppleMusicAlbumCompanion/
└── plugin/
    ├── package.json
    ├── rollup.config.mjs
    ├── src/
    └── com.aelchert.apple-music-album.sdPlugin/
```

## What the MVP Does

- Stream Deck plugin action: `Apple Music Album`
- Per-key settings store the assigned album URL and display label
- Property inspector can arm or disarm the currently selected key
- SwiftUI macOS companion app validates Apple Music album URLs and sends assignments using Stream Deck deep-links
- Shared local state file gives the companion app enough context to show:
  - whether the plugin is reachable
  - which key is armed
  - whether the last assignment succeeded or failed

## Assignment Flow

1. Install and link the Stream Deck plugin.
2. Add `Apple Music Album` to a Stream Deck key.
3. Select that action in Stream Deck and click `Arm Current Key` in the property inspector.
4. Open the macOS companion app.
5. Paste an Apple Music album URL and click `Assign to Armed Key`.
6. The companion app sends a passive deep-link to the plugin.
7. The plugin validates the URL, writes per-action settings for the armed key, updates the title, and stores the result in the shared state file.
8. Pressing the key opens the saved album URL.

## Build the Plugin

Requirements:

- Stream Deck 7.0 or newer
- Node.js 20+
- npm or pnpm

Build steps:

```bash
cd /Users/aelchert/Git/launchctlHelper/streamdeck-apple-music/plugin
npm install
npm run build
```

This writes the plugin runtime bundle to:

`/Users/aelchert/Git/launchctlHelper/streamdeck-apple-music/plugin/com.aelchert.apple-music-album.sdPlugin/bin/plugin.js`

## Install the Plugin

Preferred option with the Stream Deck CLI:

```bash
streamdeck link /Users/aelchert/Git/launchctlHelper/streamdeck-apple-music/plugin/com.aelchert.apple-music-album.sdPlugin
```

Manual option:

1. Quit Stream Deck.
2. Copy or symlink `com.aelchert.apple-music-album.sdPlugin` into `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`.
3. Re-open Stream Deck.

## Run the macOS Companion App

Requirements:

- macOS 13+
- Xcode 15+ or the macOS Swift toolchain

Run from Terminal:

```bash
cd /Users/aelchert/Git/launchctlHelper/streamdeck-apple-music/macos-companion
swift run
```

Open in Xcode:

1. Open `/Users/aelchert/Git/launchctlHelper/streamdeck-apple-music/macos-companion/Package.swift`.
2. Run the `AppleMusicAlbumCompanion` target.

## Shared State File

The plugin and macOS app coordinate through:

`~/Library/Application Support/com.aelchert.apple-music-album/state.json`

The file contains:

- current armed key context and token
- last assignment result
- heartbeat timestamp used by the macOS app to detect plugin availability

The Apple Music URL itself is **not** stored in this file. The URL is stored in Stream Deck per-action settings.

## Error Handling Implemented

- Invalid Apple Music album URL in the macOS app
- Plugin unavailable or stale heartbeat
- No key armed for assignment
- Stale armed token after the user changes the selected key
- No URL configured when a Stream Deck key is pressed

## Notes and Current Constraints

- The plugin currently accepts `https://music.apple.com/.../album/...` links only.
- Passive deep-links require Stream Deck 7.0+, so the manifest minimum version is set to 7.0.
- Album names are derived from the Apple Music URL slug. No Apple Music API lookup is used.
- Album art, recent links, tracks, and playlists are intentionally left out of this MVP.

## Suggested Test Plan

1. Build and link the plugin.
2. Run the macOS companion app.
3. Add the action to a key and arm it in the property inspector.
4. Assign a valid Apple Music album URL and confirm the key title updates.
5. Press the key and confirm the album URL opens.
6. Try an invalid URL and confirm the macOS app rejects it.
7. Disarm the key and confirm assignment fails with a clear message.
8. Remove the URL from settings or use a fresh key and confirm pressing it shows alert feedback.
