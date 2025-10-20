# Flake Wire

A media streaming application with debrid provider integration.

## 📋 Table of Contents

- [**Security & Configuration**](#security--configuration)
- [**Development Setup**](#development-setup)
- [**Building & Deployment**](#building--deployment)
- [**Electron App**](#electron-app)

## 🔒 Security & Configuration

### Environment Setup

1. Copy `.env.example` to `.env` and configure your API keys:
   ```bash
   cp .env.example .env
   ```

2. Required environment variables:
   - `OMDB_API_KEY`: OMDb API key (fallback if no user key configured)
   - `FANART_API_KEY` or `FANARTTV_API_KEY`: Fanart.tv API key
   - `ALLDEBRID_API_KEY`: AllDebrid API key
   - `JWT_SECRET`: Secret for JWT token signing

## 🚀 Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/flake-wire.git
cd flake-wire

# Install all dependencies
npm run install-all

# Start development servers
npm run dev
```

### Development Commands

- `npm run dev`: Start both backend and frontend in development mode
- `npm run server`: Start only backend server
- `npm run client:dev`: Start only frontend development server
- `npm run electron:dev`: Start Electron app in development mode

## 🏗️ Building & Deployment

### Build for Production

```bash
# Build the client and Electron app
npm run build:all

# Package for specific platforms
npm run electron:build:linux    # Linux AppImage
npm run electron:build:mac        # macOS DMG
npm run electron:build:win         # Windows NSIS installer
```

### Docker Deployment

```bash
# Build and deploy with Docker
npm run docker:build
npm run docker:up
```

## 🖥️ Electron App

### Features

- Multi-platform support (Windows, macOS, Linux)
- Embedded FFmpeg for video transcoding
- Secure API key storage
- OAuth authentication (Trakt, AllDebrid)
- Real-time notifications
- Auto-updater support

### Distribution

The app is configured for automated releases via GitHub Actions:
- **Windows**: NSIS installer (.exe)
- **macOS**: DMG disk image (.dmg)
- **Linux**: AppImage (.AppImage)

## 🔧 Version Management

Version management is handled through GitHub Actions:
- Automatic version bumping via `version-bump.yml` workflow
- Changelog generation for releases
- Git tags for version tracking

### Release Process

1. Code changes trigger automatic build
2. GitHub Actions builds for all platforms
3. Artifacts are uploaded and tagged
4. GitHub release is created automatically
5. Users can download from [Releases](https://github.com/yourusername/flake-wire/releases) page

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## Overview

- Full-stack media experience: Electron desktop or browser
- Debrid support: AllDebrid API key flow built-in; Real‑Debrid scaffolding present
- Secure credentials: AES‑256‑GCM encrypted storage per user/profile
- Smart playback: direct MKV streaming with fast MP4 remux or HLS fallback
- OAuth integrations: Trakt device code; AllDebrid PIN; Real‑Debrid OAuth (scaffold)
- Flexible deploy: local dev, packaged desktop builds, or Docker

![Settings](settings-page-updated.png)

## Architecture

- Frontend: `client` (Vite + React + Tailwind)
- Backend/API: `server` (Express + Axios + Cheerio + Playwright for optional scraping modules)
- Desktop: `electron/main.js` boots the server and loads the UI
- Assets/Packaging: electron-builder config in root `package.json`
- Optional scripts: `streaming_scraper.py` for manual link processing/unlock

## Features

- Search and metadata
  - OMDb + optional fanart.tv for posters/backdrops
  - Enhanced search endpoints with suggestions and stats
- Debrid providers
  - AllDebrid API-key flow with PIN auth helper and link unlocking
  - Real‑Debrid provider class and OAuth plumbing present
- Playback
  - Direct streaming for MP4/WebM/M4V; MKV remux to MP4 for browser
  - Optional forced transcode to HLS (Electron) with `ELECTRON_TRANSCODE`
- Security & storage
  - Per-user encrypted API keys and OAuth tokens
  - Cross‑platform app data directories (Windows/macOS/Linux)
- Desktop niceties
  - External player handoff (mpv/VLC) from Electron
  - App‑bundled ffmpeg via `ffmpeg-static` when available

## Quick Start

Prerequisites
- Node.js 18+ and npm
- mpv or vlc for mkv playback

Install everything
```bash
npm run install-all
apt install mpv -y
```

Create environment
```bash
cp .env.example .env
# Edit .env to add keys (see below)
```

Run in development (API + Vite UI)
```bash
npm run dev
# API: http://localhost:3001   UI: http://localhost:5173
```

Launch Electron (development)
```bash
npm run client:build
npm run electron:dev
```

Build desktop app (all platforms configured)
```bash
# Build web UI, then package Electron
npm run electron:build
# or platform specific: electron:build:linux | :mac | :win
```

## Environment & Keys

Copy `.env.example` and customize as needed:

- `PORT`: API port (default 3001)
- `JWT_SECRET`: token signing for authenticated routes
- Debrid: `ALLDEBRID_API_KEY`, `ALLDEBRID_AGENT` (e.g. `flake-wire`)
- Metadata: `OMDB_API_KEY`, `FANARTTV_API_KEY`, `TMDB_API_KEY` (if used)
- OAuth (optional): `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`

AllDebrid PIN auth via API is supported in the app; on success your API key is stored securely and also made available to the backend.

## Common Scripts

- `npm run dev`: backend with nodemon + Vite UI
- `npm run client:build`: build frontend to `client/dist`
- `npm run electron:dev`: run Electron pointing at the local server
- `npm run electron:build`: package desktop app with electron-builder
- `npm run docker:dev|prod`: compose files for Docker workflows

## Docker

Development
```bash
npm run docker:dev
```

Production
```bash
npm run docker:prod
# logs
npm run docker:logs
```

## API Highlights

- `GET /api/health`: server, debrid providers, features
- `GET /api/search`: torrent/search providers with filters and stats
- `GET /api/video/formats`: supported playback formats
- Config endpoints under `/api/config` for storing/testing keys
- OAuth endpoints under `/auth/oauth/...` for Trakt/Real‑Debrid/AllDebrid

## Optional: Manual Link Processing

The repo includes a standalone helper `streaming_scraper.py` for manually unlocking filehost links with AllDebrid (no browser automation).

Quick use
```bash
python streaming_scraper.py
```

Supports:
- Manual URL entry or reading from a text file
- Link validation, unlock via AllDebrid, and JSON export of results

## Troubleshooting

- No UI in Electron: make sure you built the client (`npm run client:build`) before `electron:dev`.
- AllDebrid not detected: set `ALLDEBRID_API_KEY` or use the in‑app PIN flow; check `/api/health` for provider status.
- MKV won’t play in browser: the server remuxes to MP4; for Electron you can force HLS with `ELECTRON_TRANSCODE=true`.
- Permission errors writing storage: verify your user has access to the app data path printed in logs.

## Contributing

- Open an issue with a clear description and repro steps
- Keep changes focused; add docs where behavior changes
- PRs should build the UI and pass linting locally

## License

MIT

## 📝 License

Educational use only. Use responsibly and comply with applicable laws.

## 🤝 Contributing

Since automated scraping is removed, contributions can focus on:
- Adding more supported hosts
- Improving error handling
- Better user interface
- Enhanced file processing
- Performance optimizations

---

**Note**: This is a clean, manual-only version. All automated scraping functionality has been permanently removed due to technical limitations.
