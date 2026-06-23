# Setting up Fuse

Fuse is a little music app that runs inside Claude and uses Claude to build playlists from your
Spotify history. Setup is a one-time thing and takes about 5 minutes. You'll do two things:
**install the extension**, then **connect your Spotify**.

You'll need Chrome (or a Chromium browser like Edge/Brave) and a Spotify account. Playback control
(play/pause from inside the app) needs Spotify Premium, but discovering and saving playlists works
on free accounts.

---

## Part 1 — Install the extension

The extension is what lets the app talk to Spotify. It **only runs on Claude pages** — it can't see
any of your other browsing.

1. Download/clone this project so you have the `extension/` folder on your computer.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the **`extension/`** folder.
5. You should see **"Fuse — Spotify bridge for Claude"** appear. That's it.

> **Why "Developer mode"?** This isn't on the Chrome Web Store (yet), so it's loaded directly.
> Chrome shows a developer-mode notice — that's expected for any unpacked extension, not a warning
> about this one specifically.

---

## Part 2 — Connect your Spotify

Spotify requires each person to register their own free "app" — this is just how Spotify hands out
API access. No payment, no review, no waiting.

1. Open the Fuse app in Claude. It'll show a **3-step Connect Spotify** screen — follow it there,
   or use the steps below.

2. **Create a Spotify app.** Go to the
   [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and click **Create app**.
   - **App name:** anything (e.g. "My Fuse").
   - **Redirect URI:** paste this exactly —
     ```
     https://laodgikbbddkkcnblkbcmidmippdfiin.chromiumapp.org/
     ```
     (The Fuse setup screen shows this too, with a copy button. It's the same for everyone.)
   - Under **"Which API/SDKs are you planning to use?"**, tick **Web API**.
   - Agree to the terms and click **Save**.

3. **Copy your Client ID.** Open the app you just made → **Settings** → copy the **Client ID**
   (it's safe to share; there's no secret to worry about).

4. **Paste it into Fuse** and click **Connect with Spotify**. A Spotify login/approve window opens —
   approve it, and you're in.

---

## Using it

- **Your library** — browse your top artists/tracks and recently played. Tap up to **3** of them,
  then hit **Fuse** to get a playlist that lives in the space between them.
- **Discover** — optionally type a mood, hit **Generate**, and Claude suggests new music.
- **Save as playlist** drops it straight into your Spotify. **Play on my device** starts it on
  whatever device Spotify is open on (Premium only).

---

## Troubleshooting

- **"Extension not detected"** — make sure the extension is loaded (Part 1) and then **reload the
  Claude tab**. The bridge only attaches when the page first loads.
- **"INVALID_CLIENT" / redirect mismatch** — the redirect URI in your Spotify app must match the one
  above *exactly* (including the trailing slash).
- **Search says "Insufficient client scope" / 403** — click **Disconnect** in the app, then connect
  again (some permissions are only granted on a fresh login).
- **"No active device"** when playing — open Spotify on your phone or computer and press play once,
  then try again.
- **You changed the extension** — reload it on `chrome://extensions` **and** reload the Claude tab.

Stuck? Ping George.
