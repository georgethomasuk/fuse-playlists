// Spotify OAuth (PKCE) + API pass-through, running in the privileged service worker.
const LOG = "[fuse-bg]";
console.log(LOG, "service worker started", new Date().toISOString());
const CFG = {
  TOKEN: "https://accounts.spotify.com/api/token",
  AUTH: "https://accounts.spotify.com/authorize",
  API: "https://api.spotify.com/v1",
};
const SCOPES = [
  "user-read-private",
  "user-top-read", "user-read-recently-played", "user-read-currently-playing",
  "user-read-playback-state", "user-modify-playback-state",
  "playlist-read-private", "playlist-modify-private", "playlist-modify-public",
];

const store = (obj) => chrome.storage.local.set(obj);
const load = (keys) => chrome.storage.local.get(keys);

function b64url(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randVerifier() {
  const a = new Uint8Array(64); crypto.getRandomValues(a);
  return Array.from(a, (x) => ("0" + x.toString(16)).slice(-2)).join("").slice(0, 96);
}
async function challenge(v) {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
}
async function getClientId() { return (await load("clientId")).clientId || null; }

async function connect() {
  const clientId = await getClientId();
  if (!clientId) return { __error: "No Client ID set." };
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = randVerifier();
  const code_challenge = await challenge(verifier);
  const params = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirectUri,
    code_challenge_method: "S256", code_challenge, scope: SCOPES.join(" "),
  });
  let redirect;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: `${CFG.AUTH}?${params}`, interactive: true });
  } catch (e) { return { __error: "Authorisation cancelled: " + ((e && e.message) || e) }; }
  const u = new URL(redirect);
  if (u.searchParams.get("error")) return { __error: "Spotify error: " + u.searchParams.get("error") };
  const code = u.searchParams.get("code");
  if (!code) return { __error: "No authorisation code returned." };
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "authorization_code", code,
    redirect_uri: redirectUri, code_verifier: verifier,
  });
  const res = await fetch(CFG.TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await res.json();
  if (!res.ok) return { __error: data.error_description || data.error || "Token exchange failed." };
  await store({
    access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60000,
  });
  return { connected: true };
}

let refreshInFlight = null;
async function refreshToken() {
  const { refresh_token } = await load(["refresh_token"]);
  const clientId = await getClientId();
  if (!refresh_token || !clientId) return null;
  const body = new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token });
  const res = await fetch(CFG.TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) return null;
  const data = await res.json();
  const upd = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 - 60000 };
  if (data.refresh_token) upd.refresh_token = data.refresh_token;
  await store(upd);
  return data.access_token;
}
async function getAccessToken() {
  const { access_token, expires_at } = await load(["access_token", "expires_at"]);
  if (access_token && expires_at && Date.now() < expires_at) return access_token;
  // Single-flight: concurrent calls share one refresh so we don't burn the
  // refresh token several times in parallel (which can invalidate it).
  if (!refreshInFlight) refreshInFlight = refreshToken().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

// Plain pass-through: app gives us a path/method/body, we attach auth and forward.
// Returns { ok, status, data, __path } or { __error } — no URL knowledge lives here.
async function spFetch(path, method = "GET", body, retried = false) {
  const token = await getAccessToken();
  if (!token) return { __error: "Not connected", status: 401, __path: path };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  let res;
  console.log(LOG, "fetch →", method, path);
  try {
    res = await fetch(CFG.API + path, {
      method, cache: "no-store", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
  } catch (e) {
    clearTimeout(to);
    console.warn(LOG, "fetch ✗", path, (e && e.name) || e);
    return { __error: e && e.name === "AbortError" ? "request timed out (no reply from Spotify)" : String((e && e.message) || e), status: 0, __path: path };
  }
  clearTimeout(to);
  console.log(LOG, "fetch ←", method, path, res.status);
  if (res.status === 401 && !retried) { await store({ expires_at: 0 }); return spFetch(path, method, body, true); }
  let data = null;
  if (res.status !== 204) { try { data = await res.json(); } catch (e) {} }
  return { ok: res.ok, status: res.status, data, __path: path };
}

async function handle(msg) {
  switch (msg && msg.action) {
    case "ping": return { pong: true };
    case "spotifyGetConfig": {
      const { clientId, access_token } = await load(["clientId", "access_token"]);
      return { redirectUri: chrome.identity.getRedirectURL(), hasClientId: !!clientId, connected: !!access_token };
    }
    case "spotifySetClientId": await store({ clientId: msg.clientId }); return { ok: true };
    case "spotifyConnect": return connect();
    case "spotifyLogout": await chrome.storage.local.remove(["access_token", "refresh_token", "expires_at"]); return { ok: true };
    case "spotifyFetch": return spFetch(msg.path, msg.method || "GET", msg.body);
    case "fetchImage": return fetchImage(msg.url);
    default: return { __error: "unknown action: " + (msg && msg.action) };
  }
}

// Fetch an image in the (CSP-free) worker and hand it back as a data: URL,
// which the sandboxed artifact is allowed to render.
async function fetchImage(url) {
  if (!url) return { __error: "no url" };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "force-cache" });
    clearTimeout(to);
    if (!res.ok) return { __error: "HTTP " + res.status };
    const type = res.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { dataUrl: `data:${type};base64,${btoa(bin)}` };
  } catch (e) {
    clearTimeout(to);
    return { __error: e && e.name === "AbortError" ? "image timed out" : String((e && e.message) || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const label = (msg && msg.action) + (msg && msg.method ? "·" + msg.method : "");
  const rid = msg && msg.__reqId;
  console.log(LOG, "recv", label, "id=" + rid);
  (async () => {
    try {
      const r = await handle(msg);
      console.log(LOG, "reply", label, "id=" + rid, r && r.__error ? "ERR:" + r.__error : "ok");
      sendResponse(r);
    } catch (e) {
      console.warn(LOG, "threw", label, "id=" + rid, e);
      sendResponse({ __error: String((e && e.message) || e) });
    }
  })();
  return true;
});
