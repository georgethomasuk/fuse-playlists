# Spotify Companion + Bridge — Spike Handoff

A working prototype that runs a custom Spotify app **inside a Claude artifact** (sandboxed iframe), using **Claude itself as the recommendation engine** and a **Chrome extension as a bridge** to reach Spotify. This document is the handoff for turning the spike into (a) a proper extension and (b) a small marketplace for side-loaded apps of this kind.

---

## 1. What exists today

Two pieces, both in this folder:

- **`spotify_companion_bridged.jsx`** — the app. A single-file React artifact (Spotify-dark UI). Reads your listening history, uses Claude to generate/fuse recommendations, resolves them to real tracks, creates playlists, and controls playback.
- **`spotify-bridge-extension.zip`** — an unpacked MV3 Chrome extension (`manifest.json`, `background.js`, `content.js`). The privileged broker that actually talks to Spotify and fetches images.

Both are feature-complete as a spike and stable.

---

## 2. The core constraint (why the bridge exists)

Claude artifacts run in a **sandboxed iframe with a strict, hardcoded Content-Security-Policy**:

- `connect-src` (fetch/XHR) only allows `api.anthropic.com` (a **keyless, user-billed "Claude-in-Claude" endpoint** available to artifacts) and `cdnjs.cloudflare.com`. **Spotify calls are blocked.**
- `img-src` only allows a small allow-list (e.g. `self`, `data:`, `blob:`, openstreetmap tiles). **Spotify/Facebook image CDNs are blocked.**

We cannot change the artifact CSP. The insight that makes everything work: **`window.postMessage` is not a network request and is not governed by CSP.** So:

```
[Artifact iframe]  --postMessage-->  [content script]  --chrome.runtime-->  [service worker]  --fetch-->  Spotify
   (CSP sandbox)                      (page context)        (no CSP)            (no CSP)
```

The service worker has no CSP and holds Spotify host permissions, so it performs the real fetches and passes results back through the same channel. Images use the same trick: the worker fetches the bytes and returns a `data:` URL (which the artifact CSP *does* allow).

The other key enabler: the **LLM is free**. The artifact calls `api.anthropic.com` directly (no key, billed to the end user), so the app's "intelligence" needs no backend.

---

## 3. Architecture & message protocol

The bridge is a **plain pass-through RPC** (we deliberately refactored away from semantic methods so the app owns every URL — this made traceability and debugging far easier).

**App → bridge actions** (`background.js` `handle()`):
- `ping` — liveness.
- `spotifyGetConfig` — returns `{ redirectUri, hasClientId, connected }`.
- `spotifySetClientId` — stores the user's Spotify app Client ID.
- `spotifyConnect` — runs OAuth PKCE, returns success.
- `spotifyLogout` — clears tokens.
- `spotifyFetch { path, method, body }` — **the pass-through**: attaches auth, fetches `https://api.spotify.com/v1{path}`, returns `{ ok, status, data, __path }`. The app builds every URL (`/me`, `/me/top/tracks?…`, `/search?…`, `/me/playlists`, `/me/player/play`, …).
- `fetchImage { url }` — fetches image bytes in the worker, returns `{ dataUrl }` (base64).

**Transport envelope:** artifact posts `{ __bridge:"request", id, msg }`; content script relays to the worker (tagging `__reqId` for log correlation) and posts back `{ __bridge:"response", id, ...result }`.

**App-side helpers** (`spotify_companion_bridged.jsx`, module scope):
- `bridgeCall(msg, timeout, silent)` — promise wrapper around postMessage; logs to `logStore` unless `silent`.
- `api(path, opts)` — thin pass-through: throws on `!ok`, returns `data`. The app's single source of truth for Spotify URLs.
- `ProxyImg` + `imgCache` — renders bridge-fetched images, cached by URL.
- `logStore` + `LogsView` — the in-app **Logs tab**: every bridge call and Claude call as a real HTTP-style row (method + path + status + ms + id), expandable, with the bridge `id` matching the worker's console logs.

---

## 4. Auth model

- **OAuth 2.0 PKCE**, run in the extension via `chrome.identity.launchWebAuthFlow`.
- Redirect URI is `chrome.identity.getRedirectURL()` → `https://<extension-id>.chromiumapp.org/`. The app's setup screen shows this so the user can register it in their Spotify dashboard.
- The user supplies their **own Spotify app Client ID** (stored in `chrome.storage.local`). No secret needed (PKCE).
- Token refresh is **single-flight** (a shared in-flight promise) so a burst of concurrent calls can't spend the refresh token several times in parallel.
- **Scopes:** `user-read-private` (needed for `market=from_token`), `user-top-read`, `user-read-recently-played`, `user-read-currently-playing`, `user-read-playback-state`, `user-modify-playback-state`, `playlist-read-private`, `playlist-modify-private`, `playlist-modify-public`.

---

## 5. Spotify API notes (as researched during the spike, ~2026 — re-verify)

- Spotify **deprecated** the recommendations, audio-features, and related-artists endpoints, and tightened Development Mode (owner needs Premium; max ~5 users). **Re-verify current state before building on it.**
- Consequence: we don't use Spotify's recommender. **Claude does the musical reasoning** (themes, blends, adjacency), then we **resolve its suggestions to real tracks via `/search`**. This pattern is the heart of both Discover and Fuse and is robust to the deprecations.
- Playback control requires Premium and an active device.

---

## 6. Feature inventory (the app)

- **Your library (+ Fuse, merged):** top artists / top tracks / recently-played across three time windows (4 weeks / 6 months / all time). Everything is **selectable** as a fuse seed. Plus a **Spotify search box** (debounced, `type=track,artist`) so seeds aren't limited to your own history.
- **Fuse:** pick up to 3 seeds → Claude identifies each seed's identity and finds a thread to blend them → builds a ~16-track playlist that lives *between* them. **Hard rule: never returns the seed tracks or any track by the seed artists** — enforced both in the prompt and by a post-resolution filter. Then save as playlist / play / re-fuse.
- **Discover:** optional mood text → Claude suggests new music → resolved via search → save/play.
- **Logs:** the observability tab described above.
- **Player bar:** polls `/me/player/currently-playing` every 5s; play/pause/next/prev/volume.

---

## 7. Hard-won gotchas (read before touching the extension)

These cost real time; preserve the fixes:

1. **HTTP 304 caching.** Repeated identical GETs (`/me`, top, recent) got conditional-cached; the worker received `304` with no usable body, and the revalidation could stall. **Fix: `cache: "no-store"` on every Spotify fetch.** (Search never hit this because each query URL is unique — that asymmetry was the diagnostic tell.)
2. **MV3 service-worker cold-start drops the first message.** A 4-wide concurrent library load would lose whichever call woke a sleeping worker (always profile, first). **Fix: content-script retries idempotent (GET / read) calls once after 6s; never retries writes.** Consider a keep-alive instead.
3. **Concurrent refresh.** Parallel calls each tried to refresh → refresh-token rotation invalidated the losers. **Fix: single-flight refresh.**
4. **Silent hangs.** Fetches had no timeout. **Fix: 12s AbortController on API calls, 10s on images** → a stall becomes a visible error, not a 20s freeze.
5. **`market=from_token` needs `user-read-private`** or search 403s with "Insufficient client scope." Adding a scope requires disconnect/reconnect (refresh won't grant new scopes).
6. **Images:** `FileReader` is **not available in MV3 service workers** — convert blobs via `arrayBuffer()` + chunked `btoa`. Route image calls through a **silent** bridge path so they don't flood the Logs tab (~50 per library load).
7. **Pass-through, not semantic methods.** Keeping URL construction in the app (not the extension) is what made the Logs tab readable and bugs findable. Keep it that way.

---

## 8. How to run the spike

1. Unzip the extension. `chrome://extensions` → Developer mode → Load unpacked.
2. Open the artifact in Claude (or paste the `.jsx`). It detects the bridge.
3. Copy the redirect URI it shows → create a Spotify app at developer.spotify.com → add that redirect URI → copy the Client ID back into the app → Connect → approve scopes.
4. On any extension change: reload the extension card **and** reload the Claude tab (reloading the extension orphans the content script). Scope changes also need Disconnect → reconnect.
5. Debugging: extension console at `chrome://extensions` → "service worker" (`[sb-bg]`); page console → artifact frame (`[sb-cs]`); and the in-app **Logs** tab. The bridge `id` correlates all three.

---

## 9. Roadmap A — turn the extension into something proper

The current extension is Spotify-specific and trusts any frame. To productionise:

- **Generalise the broker.** Replace the Spotify-specific handlers with a generic, **per-provider connection model**: OAuth PKCE config, token store, and a scoped `fetch` proxy keyed by provider. Spotify becomes the first provider, not the whole extension.
- **Security (most important).**
  - **Origin-checking:** the content script currently injects into `*://*/*` / all frames and relays from any sender. Lock relaying to trusted artifact origins (e.g. `www.claudeusercontent.com`) and verify `event.origin`. Today *any* page could drive the bridge.
  - **Capability scoping:** don't expose a raw `fetch` to arbitrary URLs. Each app declares the API hosts/scopes it needs; the worker only proxies to allow-listed hosts for that app; never echo tokens back to the page.
  - **Least privilege:** move image/API hosts to `optional_host_permissions` and request them at runtime per app via `chrome.permissions.request`.
  - **Per-app token isolation:** namespace credential storage so one app can't read another's tokens.
  - Validate the PKCE `state`/nonce; never log tokens.
- **Robustness:** versioned, typed message protocol (schema-validate every message); a structured error taxonomy; optional service-worker keep-alive to remove the cold-start dance.
- **Engineering:** TypeScript + a bundler (Vite/esbuild) instead of three hand-edited files; CI; signed builds; a real version/update story (CWS listing or self-hosted CRX with `update_url`).
- Keep the in-app Logs concept — formalise it as a debug panel and an opt-in event stream from the extension.

## 10. Roadmap B — the side-loaded app marketplace

The model is clean: **one host extension** (the broker) + **a catalog of apps** (each app is a self-contained artifact/bundle plus a manifest of what it needs).

- **App manifest** (per app): `id`, `name`, `version`, `author`, `entry` (artifact URL or bundle hash), `connectors` (e.g. `spotify` with required scopes), `apiHosts` allow-list, and a **signature**.
- **Registry:** a static site + `index.json` catalog. "Install" = load the app's artifact and have the extension grant the declared capabilities **after an explicit user consent prompt** ("This app wants to read your Spotify library and control playback"). Grants are revocable and listed in the extension UI.
- **Trust model:** signing + review; per-app permission prompts; per-app credential isolation; a kill-switch/revocation list.
- **Runtime targets:** apps can run inside Claude artifacts (bridge essential — CSP) *or* in a minimal standalone "runner" page that hosts the app iframe and talks to the same extension (bridge still useful as the shared connection broker).
- **Prior art to align with:** this is essentially a local **capability broker** — very close in spirit to **MCP** and the **ChatGPT Apps SDK** (MCP-based) that surfaced during research. Worth deciding early whether connectors should *be* MCP servers (portability, reuse) rather than a bespoke protocol.

## 11. Suggested target repo structure

```
/extension            MV3 broker (TS): manifest, worker, content, providers/
/packages/bridge      shared message-protocol types + client (used by apps)
/apps/spotify-companion   the .jsx lifted into a Vite React app
/registry             catalog site + index.json + signing tooling
```

Migration steps: (1) lift the 3 extension files into a TS MV3 project; (2) lift the `.jsx` into a Vite app, factor the bridge client into `/packages/bridge`; (3) define the app-manifest + signing; (4) stand up the registry.

## 12. Open decisions to make first

- **Product framing:** "apps that live *inside* Claude artifacts" (bridge is mandatory — CSP) vs "standalone side-loaded web apps" (bridge optional, but still valuable as a credential broker). This drives almost everything.
- **LLM billing:** inside an artifact the `api.anthropic.com` call is keyless/user-billed. Outside, you need a real key or a proxy. Decide how non-artifact apps get inference.
- **Connector protocol:** bespoke RPC vs MCP-compatible connectors.
- **Distribution:** Chrome Web Store (review friction, but trust + auto-update) vs self-hosted CRX (control, but sideloading UX).

## 13. Key code locations (quick reference)

- **Extension auth/refresh:** `background.js` → `connect()`, `refreshToken()`, `getAccessToken()` (single-flight).
- **Pass-through:** `background.js` → `spFetch()` (abort, no-store, 401-retry, `__path`).
- **Image proxy:** `background.js` → `fetchImage()` (arrayBuffer → chunked btoa).
- **Cold-start retry / origin point to harden:** `content.js`.
- **Bridge client / pass-through helper:** `.jsx` → `bridgeCall()`, `api()`.
- **Fuse logic (prompt + exclusion filter):** `.jsx` → `fuse()`.
- **Observability:** `.jsx` → `logStore`, `LogsView`.
