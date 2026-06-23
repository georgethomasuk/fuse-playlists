# Fuse

A small music app that runs **inside a Claude artifact** and uses **Claude itself** as the
recommendation engine, reaching Spotify through a tiny Chrome extension (the "bridge").

- **Discover** — Claude reads your listening history and suggests new music.
- **Fuse** — pick up to 3 artists/tracks and Claude builds a playlist that lives *between* them
  (never the seeds themselves).
- Save as a playlist or control playback, all from inside the artifact.

This is a spike with a bit of polish on top — enough to share with friends. For the deeper
"why it works this way" and the productionisation roadmap, see [HANDOFF.md](./HANDOFF.md).

## Why an extension at all?

Claude artifacts run in a sandboxed iframe with a hardcoded Content-Security-Policy that blocks
all network calls except `api.anthropic.com`. Spotify calls are blocked. `window.postMessage`
isn't a network request, so the app posts messages to a content script, which relays them to the
extension's service worker (no CSP), which makes the real Spotify calls. Full detail in
[HANDOFF.md §2](./HANDOFF.md).

## Repo layout

```
extension/            The Chrome extension (the bridge) — load this unpacked
  manifest.json       MV3 manifest; pinned signing key → stable extension ID
  background.js       Service worker: OAuth (PKCE), token refresh, Spotify pass-through, image proxy
  content.js          Relay injected only into Claude pages; origin/action-guarded
app/
  fuse-companion.jsx  The single-file React app — paste into a Claude artifact
scripts/
  pack.sh             Produce a signed .crx from the pinned key
HANDOFF.md            Spike context, gotchas, and the roadmap
SETUP.md              Friend-facing setup guide (share this with people)
```

## Quick start (you, the developer)

1. **Load the extension:** `chrome://extensions` → enable Developer mode → **Load unpacked** →
   select the `extension/` folder. It only runs on Claude pages.
2. **Open the app:** paste `app/fuse-companion.jsx` into a Claude artifact (or however you host it).
   It detects the bridge automatically.
3. **Connect Spotify:** follow the on-screen 3-step flow (create a free Spotify app, register the
   redirect URI it shows, paste your Client ID). This is the same flow described in [SETUP.md](./SETUP.md).

To hand the whole thing to a friend, point them at **[SETUP.md](./SETUP.md)**.

## What changed from the original spike

- **Less scary extension.** The content script used to inject into **every website** (`*://*/*`,
  all frames) — that's what made Chrome warn *"Read and change all your data on all websites."*
  It's now scoped to Claude origins only (`*.claudeusercontent.com`, `claude.ai`), and the relay
  rejects messages that aren't from its own frame or aren't a known action. The Facebook-CDN host
  permissions (which looked alarming on a "Spotify" extension) are dropped; the only cost is that a
  few users' Spotify avatars fall back to a placeholder icon.
- **Stable extension ID.** A pinned signing `key` in the manifest means every install has the same
  ID — so the OAuth redirect URI (`https://laodgikbbddkkcnblkbcmidmippdfiin.chromiumapp.org/`) is
  the same for everyone, and the setup guide can just state it.
- **Friendlier onboarding.** The in-app setup screen is now a numbered, 3-step flow with a direct
  link to the Spotify dashboard.
- **Organised + version-controlled.** Three hand-edited files and a stray `.jsx` became a git repo
  with `extension/`, `app/`, and docs.

## Releases (GitHub)

A release is cut by **pushing a version tag**; GitHub Actions
([`.github/workflows/release.yml`](./.github/workflows/release.yml)) packages everything and
publishes a Release with these assets:

| Asset | What it is |
| --- | --- |
| `fuse-extension-v0.4.0.zip` | The extension, ready to unzip and **Load unpacked**. |
| `fuse-companion.jsx` | The artifact to paste into a Claude artifact. |
| `fuse-extension-v0.4.0.crx` | Signed `.crx` — **only if** the signing key secret is configured (see below). |

To cut a release:

```bash
# 1. Bump the version in extension/manifest.json (and package.json) to match the tag.
# 2. Tag and push:
git tag v0.4.0
git push origin v0.4.0
```

The workflow warns if the tag doesn't match `extension/manifest.json`'s version. You can also run
it manually from the **Actions** tab (supply a tag).

**To also publish the signed `.crx`:** add the private key as a repo secret named
`EXTENSION_SIGNING_KEY` (Settings → Secrets and variables → Actions → New repository secret, paste
the full contents of `extension-signing-key.pem`). Without it, the `.zip` + `.jsx` are still
published — the `.crx` step is simply skipped.

Locally, `./scripts/pack.sh` (or `npm run build:crx`) produces the same signed `.crx` into `dist/`.

## The signing key

`extension-signing-key.pem` is the private key that pins the extension ID. It is **gitignored** —
never commit it. The *public* half is embedded in `manifest.json` as `key`, which is what actually
fixes the ID, so loading the unpacked `extension/` folder gives the right ID without the private
key. The private key is only needed to repack a signed `.crx` (`./scripts/pack.sh`). If it's lost,
regenerate it — but the extension ID and redirect URI will change, and everyone must re-register.

## Heads-up / things to verify

- **Artifact origin.** The content script is scoped to `*.claudeusercontent.com`. If Claude ever
  serves artifacts from a different host, the bridge won't be detected — update `matches` in
  `extension/manifest.json` (find the real origin via DevTools → the artifact frame).
- **Spotify Dev Mode.** Each person uses their own Spotify app (Development Mode). Re-verify
  Spotify's current API/dev-mode terms before relying on this — see [HANDOFF.md §5](./HANDOFF.md).
