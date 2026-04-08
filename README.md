# launchctlHelper

Local Next.js app for inspecting macOS `launchctl` services and editing the plist files that define them.

## Features

- Scans the standard launchd plist directories:
  - `/System/Library/LaunchDaemons`
  - `/Library/LaunchDaemons`
  - `/System/Library/LaunchAgents`
  - `/Library/LaunchAgents`
  - `~/Library/LaunchAgents`
- Merges plist metadata with live `launchctl` runtime state:
  - running, loaded, unloaded
  - PID and last exit status when available
  - disabled state from `launchctl print-disabled`
  - `launchctl print` detail view
- Distinguishes Apple-managed entries from user-installed/custom entries.
- Lets you:
  - filter by runtime state, family, source, and writability
  - inspect raw plist content
  - edit writable plist files with validation and backup-on-save
  - `load`, `unload`, `enable`, and `disable` services from the UI

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn-style component primitives

## Install

```bash
pnpm install
```

## Run Locally

```bash
pnpm dev
```

The app binds to `127.0.0.1:3000`.

## Production Build

```bash
pnpm build
pnpm start
```

## Notes

- The app is intended for the current Mac only and should not be exposed publicly.
- Runtime visibility is limited to what `launchctl` exposes to the current user/session.
- Files under `/System/Library` are treated as inspectable but effectively read-only.
- Writes validate plist content first and create a timestamped backup alongside the original file.
- Some `/Library` operations can still fail due to macOS permissions; API responses surface stderr so the UI can show the real cause.
