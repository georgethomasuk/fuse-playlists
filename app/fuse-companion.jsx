import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Music, Play, Pause, SkipForward, SkipBack, Volume2, Sparkles, Home, Clock,
  User, Loader2, ExternalLink, Plus, RefreshCw, AlertCircle, Check, LogOut, Search, Copy, Plug,
  Terminal, Trash2, ChevronRight, ChevronDown, ArrowRight, Blend, X
} from "lucide-react";

const C = {
  bg: "#000", panel: "#121212", card: "#181818", cardHover: "#282828",
  green: "#1DB954", greenHover: "#1ed760", text: "#fff", sub: "#B3B3B3", faint: "#727272", line: "#2A2A2A",
};

// ── Log store (records every call so the Logs tab can show them) ──
const logStore = {
  entries: [],
  listeners: new Set(),
  _emit() { this.listeners.forEach((l) => l(this.entries)); },
  add(e) { this.entries = [e, ...this.entries].slice(0, 200); this._emit(); },
  update(id, patch) { this.entries = this.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)); this._emit(); },
  clear() { this.entries = []; this._emit(); },
  subscribe(l) { this.listeners.add(l); return () => this.listeners.delete(l); },
};

function labelFor(msg) {
  if (!msg || !msg.action) return "?";
  if (msg.action === "spotifyFetch") return `${msg.method || "GET"} ${msg.path}`;
  return msg.action;
}

// Wrap any async op so it shows up in the logs as a non-bridge ("direct") call.
async function logged(label, request, fn) {
  const id = Math.random().toString(36).slice(2);
  const started = performance.now();
  logStore.add({ id, t: Date.now(), channel: "direct", label, request, status: "pending" });
  try {
    const result = await fn();
    logStore.update(id, { status: "ok", response: result, ms: Math.round(performance.now() - started) });
    return result;
  } catch (e) {
    logStore.update(id, { status: "error", error: String((e && e.message) || e), ms: Math.round(performance.now() - started) });
    throw e;
  }
}

// ── Bridge client (talks to the extension via postMessage) ───────
function bridgeCall(msg, timeout = 20000, silent = false) {
  const logId = Math.random().toString(36).slice(2);
  const id = Math.random().toString(36).slice(2);
  const started = performance.now();
  if (!silent) logStore.add({ id: logId, reqId: id, t: Date.now(), channel: "bridge", label: labelFor(msg), request: msg, status: "pending" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      if (!silent) logStore.update(logId, { status: "error", error: "bridge timeout (no response from extension)", ms: Math.round(performance.now() - started) });
      reject(new Error("bridge timeout"));
    }, timeout);
    function onMsg(e) {
      const d = e.data;
      if (d && d.__bridge === "response" && d.id === id) {
        clearTimeout(timer); window.removeEventListener("message", onMsg);
        if (!silent) {
          const base = { ms: Math.round(performance.now() - started), path: d.__path };
          if (d.__error) logStore.update(logId, { status: "error", error: d.__error, response: d, ...base });
          else logStore.update(logId, { status: "ok", response: d, ...base });
        }
        resolve(d);
      }
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ __bridge: "request", id, msg }, "*");
  });
}
// The app builds every Spotify URL itself; the bridge just forwards it.
async function api(path, opts = {}) {
  const r = await bridgeCall({ action: "spotifyFetch", path, method: opts.method || "GET", body: opts.body });
  if (r && r.__error) throw new Error(r.__error);
  if (!r.ok) throw new Error(`HTTP ${r.status}` + (r.data && r.data.error && r.data.error.message ? `: ${r.data.error.message}` : ""));
  return r.data;
}

// The artifact CSP blocks external images, so we fetch them through the bridge
// (worker has no CSP) and render the returned data: URL. Cached by source URL.
const imgCache = new Map();      // url -> dataUrl | null
const imgInflight = new Map();   // url -> Promise
function loadProxyImg(url) {
  if (!url) return Promise.resolve(null);
  if (imgCache.has(url)) return Promise.resolve(imgCache.get(url));
  if (imgInflight.has(url)) return imgInflight.get(url);
  const p = bridgeCall({ action: "fetchImage", url }, 15000, true)
    .then((r) => { const d = (r && r.dataUrl) || null; imgCache.set(url, d); imgInflight.delete(url); return d; })
    .catch(() => { imgInflight.delete(url); imgCache.set(url, null); return null; });
  imgInflight.set(url, p);
  return p;
}
function ProxyImg({ src, alt = "", style, fallback }) {
  const [data, setData] = useState(() => imgCache.get(src) || null);
  useEffect(() => {
    let alive = true;
    if (!src) { setData(null); return; }
    if (imgCache.has(src)) { setData(imgCache.get(src)); return; }
    loadProxyImg(src).then((d) => alive && setData(d));
    return () => { alive = false; };
  }, [src]);
  if (data) return <img src={data} alt={alt} style={style} />;
  return <div style={{ ...style, background: C.card, display: "grid", placeItems: "center" }}>{fallback || <Music size={14} color={C.faint} />}</div>;
}

function Spinner({ size = 18 }) { return <Loader2 size={size} className="animate-spin" style={{ color: C.sub }} />; }
function GreenBtn({ children, onClick, disabled, style }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: disabled ? "#1a3d27" : h ? C.greenHover : C.green, color: "#000", border: "none",
        borderRadius: 500, padding: "12px 28px", fontWeight: 700, fontSize: 14, cursor: disabled ? "default" : "pointer",
        transform: h && !disabled ? "scale(1.04)" : "scale(1)", transition: "all .15s", opacity: disabled ? 0.6 : 1, ...style }}>
      {children}
    </button>
  );
}
function TrackRow({ track, index, onPlay, onOpen, reason }) {
  const [h, setH] = useState(false);
  const img = track?.album?.images?.slice(-1)?.[0]?.url;
  const artists = (track?.artists || []).map((a) => a.name).join(", ");
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "grid", gridTemplateColumns: "24px 44px 1fr auto", alignItems: "center", gap: 12,
        padding: "8px 12px", borderRadius: 6, background: h ? C.cardHover : "transparent" }}>
      <div style={{ width: 24, textAlign: "center", color: C.faint, fontSize: 14 }}>
        {h && onPlay ? <Play size={14} style={{ color: C.text, cursor: "pointer" }} onClick={() => onPlay(track)} />
          : (index != null ? index + 1 : <Music size={14} />)}
      </div>
      {img ? <ProxyImg src={img} alt="" style={{ width: 44, height: 44, borderRadius: 4, objectFit: "cover" }} />
        : <div style={{ width: 44, height: 44, borderRadius: 4, background: C.card }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ color: C.text, fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track?.name}</div>
        <div style={{ color: C.sub, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{artists}</div>
        {reason && <div style={{ color: C.green, fontSize: 12, marginTop: 2, fontStyle: "italic" }}>{reason}</div>}
      </div>
      <div style={{ paddingRight: 6 }}>
        {onOpen && track?.external_urls?.spotify && (
          <ExternalLink size={16} style={{ color: h ? C.text : C.faint, cursor: "pointer" }} onClick={() => onOpen(track)} />
        )}
      </div>
    </div>
  );
}

function Selectable({ item, selected, disabled, onToggle, onPlay, rank }) {
  const [h, setH] = useState(false);
  const blocked = disabled && !selected;
  return (
    <div onClick={() => !blocked && onToggle(item)} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8,
        cursor: blocked ? "default" : "pointer", opacity: blocked ? 0.4 : 1,
        background: selected ? "rgba(29,185,84,0.16)" : h && !blocked ? C.cardHover : "transparent",
        border: `1px solid ${selected ? C.green : "transparent"}` }}>
      {rank != null && <div style={{ width: 18, textAlign: "right", color: C.faint, fontSize: 13, flexShrink: 0 }}>{rank}</div>}
      {item.image
        ? <ProxyImg src={item.image} alt="" style={{ width: 40, height: 40, borderRadius: item.type === "artist" ? "50%" : 4, objectFit: "cover" }} />
        : <div style={{ width: 40, height: 40, borderRadius: item.type === "artist" ? "50%" : 4, background: C.card }} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
        <div style={{ fontSize: 12, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.sub}</div>
      </div>
      {onPlay && h && <Play size={16} color={C.text} style={{ flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); onPlay(item); }} />}
      <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
        border: `2px solid ${selected ? C.green : C.faint}`, background: selected ? C.green : "transparent" }}>
        {selected && <Check size={13} color="#000" />}
      </div>
    </div>
  );
}

function trim(obj, max = 2000) {
  try { const s = JSON.stringify(obj, null, 2); return s.length > max ? s.slice(0, max) + "\n… (truncated)" : s; }
  catch { return String(obj); }
}
function LogRow({ entry }) {
  const [open, setOpen] = useState(false);
  const tone = entry.status === "ok" ? C.green : entry.status === "error" ? "#f15e6c" : "#f0c14b";
  const time = new Date(entry.t).toLocaleTimeString([], { hour12: false }) + "." + String(entry.t % 1000).padStart(3, "0");
  const summary = trim(entry.request, 80).replace(/\s+/g, " ");
  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <div onClick={() => setOpen((o) => !o)}
        style={{ display: "grid", gridTemplateColumns: "16px 8px 1fr auto auto", alignItems: "center", gap: 10, padding: "9px 6px", cursor: "pointer", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>
        {open ? <ChevronDown size={14} color={C.faint} /> : <ChevronRight size={14} color={C.faint} />}
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone, display: "inline-block" }} />
        <span style={{ color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ color: entry.channel === "bridge" ? "#7ec8ff" : "#c9a6ff" }}>{entry.channel === "bridge" ? "bridge" : "direct"}</span>
          {"  "}{entry.label}
        </span>
        <span style={{ color: C.faint }}>{entry.ms != null ? entry.ms + "ms" : "…"}{entry.status === "ok" && entry.response && entry.response.status != null ? " · " + entry.response.status : ""}</span>
        <span style={{ color: C.faint }}>{time}</span>
      </div>
      {open && (
        <div style={{ padding: "0 6px 12px 36px", fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: C.sub }}>
          {entry.reqId && <div style={{ color: C.faint, marginBottom: 6 }}>id <span style={{ color: "#cfcfcf" }}>{entry.reqId}</span></div>}
          <div style={{ color: C.faint, margin: "2px 0 2px" }}>request</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: 8, color: "#cfcfcf" }}>{trim(entry.request)}</pre>
          {entry.status === "error" ? (
            <>
              <div style={{ color: C.faint, margin: "8px 0 2px" }}>error</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#2a1416", border: "1px solid #5a2429", borderRadius: 6, padding: 8, color: "#f5a6ac" }}>{entry.error}</pre>
            </>
          ) : entry.status === "ok" ? (
            <>
              <div style={{ color: C.faint, margin: "8px 0 2px" }}>response</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: 8, color: "#9fe1cb" }}>{trim(entry.response)}</pre>
            </>
          ) : <div style={{ color: "#f0c14b", marginTop: 6 }}>pending…</div>}
        </div>
      )}
    </div>
  );
}
function LogsView({ logs, onClear }) {
  const ok = logs.filter((l) => l.status === "ok").length;
  const err = logs.filter((l) => l.status === "error").length;
  const pending = logs.filter((l) => l.status === "pending").length;
  const Stat = ({ dot, n, label }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.sub }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "inline-block" }} /> {n} {label}
    </span>
  );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Terminal size={24} color={C.green} /><h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Logs</h1>
      </div>
      <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, margin: "0 0 16px" }}>Every call to the extension and to Claude, newest first. Click a row to see the request and response.</p>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 14, flexWrap: "wrap" }}>
        <Stat dot={C.green} n={ok} label="ok" />
        <Stat dot="#f15e6c" n={err} label="errors" />
        {pending > 0 && <Stat dot="#f0c14b" n={pending} label="pending" />}
        <div style={{ flex: 1 }} />
        <button onClick={onClear} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.faint}`, color: C.sub, borderRadius: 500, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>
          <Trash2 size={14} /> Clear
        </button>
      </div>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
        {logs.length === 0
          ? <div style={{ padding: 28, textAlign: "center", color: C.faint, fontSize: 14 }}>No calls yet. Switch to Your library or Discover and they'll show up here.</div>
          : logs.map((e) => <LogRow key={e.id} entry={e} />)}
      </div>
    </>
  );
}

export default function App() {
  const [phase, setPhase] = useState("boot"); // boot | noBridge | setup | ready
  const [cfg, setCfg] = useState(null);       // {redirectUri, hasClientId, connected}
  const [clientId, setClientId] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [view, setView] = useState("home");
  const [profile, setProfile] = useState(null);
  const [topTracks, setTopTracks] = useState([]);
  const [topArtists, setTopArtists] = useState([]);
  const [recent, setRecent] = useState([]);
  const [range, setRange] = useState("medium_term");
  const [loadingData, setLoadingData] = useState(false);

  const [mood, setMood] = useState("");
  const [recs, setRecs] = useState([]);
  const [recBusy, setRecBusy] = useState(false);
  const [recStatus, setRecStatus] = useState("");
  const [playlistLink, setPlaylistLink] = useState(null);
  const [creating, setCreating] = useState(false);

  const [seeds, setSeeds] = useState([]);          // up to 3 {key,type,name,sub,uri,image}
  const [fuseBusy, setFuseBusy] = useState(false);
  const [fuseStatus, setFuseStatus] = useState("");
  const [fuses, setFuses] = useState([]);          // history: [{ id, name, concept, recs, seeds, link }]
  const [activeFuseId, setActiveFuseId] = useState(null);
  const [fuseCreating, setFuseCreating] = useState(false);

  const [searchQ, setSearchQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchTracks, setSearchTracks] = useState([]);
  const [searchArtists, setSearchArtists] = useState([]);

  const [nowPlaying, setNowPlaying] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(60);
  const [deviceMsg, setDeviceMsg] = useState("");
  const pollRef = useRef(null);

  const [logs, setLogs] = useState(logStore.entries);
  useEffect(() => logStore.subscribe(setLogs), []);

  // Boot: detect bridge, read config
  useEffect(() => {
    (async () => {
      try {
        const ping = await bridgeCall({ action: "ping" }, 3500);
        if (!ping || !ping.pong) { setPhase("noBridge"); return; }
      } catch { setPhase("noBridge"); return; }
      try {
        const c = await bridgeCall({ action: "spotifyGetConfig" });
        setCfg(c);
        setPhase(c.connected ? "ready" : "setup");
      } catch (e) { setAuthErr(String(e.message || e)); setPhase("setup"); }
    })();
  }, []);

  const connect = async () => {
    setConnecting(true); setAuthErr("");
    try {
      if (clientId.trim()) await bridgeCall({ action: "spotifySetClientId", clientId: clientId.trim() });
      const r = await bridgeCall({ action: "spotifyConnect" }, 120000);
      if (r.__error) { setAuthErr(r.__error); setConnecting(false); return; }
      setPhase("ready");
    } catch (e) { setAuthErr(String(e.message || e)); }
    setConnecting(false);
  };
  const logout = async () => {
    try { await bridgeCall({ action: "spotifyLogout" }); } catch {}
    setProfile(null); setTopTracks([]); setTopArtists([]); setRecent([]); setRecs([]); setNowPlaying(null);
    const c = await bridgeCall({ action: "spotifyGetConfig" }); setCfg(c); setPhase("setup");
  };

  const loadData = useCallback(async () => {
    if (phase !== "ready") return;
    setLoadingData(true);
    try {
      const [me, tt, ta, rp] = await Promise.all([
        api("/me"),
        api(`/me/top/tracks?time_range=${range}&limit=20`),
        api(`/me/top/artists?time_range=${range}&limit=12`),
        api("/me/player/recently-played?limit=20"),
      ]);
      setProfile(me);
      setTopTracks(tt.items || []);
      setTopArtists(ta.items || []);
      setRecent((rp.items || []).map((x) => x.track));
    } catch (e) { setRecStatus(e.message || "Couldn't load your history."); }
    setLoadingData(false);
  }, [phase, range]);
  useEffect(() => { loadData(); }, [loadData]);

  const generate = async () => {
    setRecBusy(true); setRecs([]); setPlaylistLink(null); setRecStatus("Asking Claude for ideas…");
    try {
      const artists = topArtists.slice(0, 10).map((a) => a.name);
      const tracks = topTracks.slice(0, 12).map((t) => `${t.name} — ${(t.artists || []).map((a) => a.name).join(", ")}`);
      const recents = recent.slice(0, 10).map((t) => `${t.name} — ${(t.artists || []).map((a) => a.name).join(", ")}`);
      const prompt =
        `You are a music curator. Suggest 12 specific songs the listener probably hasn't heard but would enjoy — lean into discovery. Avoid songs already listed.\n\n` +
        `Top artists: ${artists.join(", ")}\nTop tracks: ${tracks.join(" | ")}\nRecently played: ${recents.join(" | ")}\n` +
        (mood ? `Mood/steer: ${mood}\n` : "") +
        `\nReturn ONLY a JSON array, no prose or fences. Each item: {"artist": string, "track": string, "reason": string (max 8 words)}.`;
      const aiData = await logged(
        "claude · recommendations",
        { model: "claude-sonnet-4-6", promptChars: prompt.length },
        async () => {
          const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
          });
          if (!aiRes.ok) throw new Error("Claude API HTTP " + aiRes.status);
          const json = await aiRes.json();
          return { contentBlocks: (json.content || []).length, _raw: json };
        }
      ).then((r) => r._raw);
      const text = (aiData.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
      let ideas = [];
      try { ideas = JSON.parse(clean); } catch { const m = clean.match(/\[[\s\S]*\]/); if (m) ideas = JSON.parse(m[0]); }
      if (!Array.isArray(ideas) || !ideas.length) throw new Error("Claude's reply couldn't be parsed.");
      const resolved = [];
      for (let i = 0; i < ideas.length; i++) {
        setRecStatus(`Finding tracks on Spotify… ${i + 1}/${ideas.length}`);
        try {
          const r = await api(`/search?q=${encodeURIComponent("track:" + ideas[i].track + " artist:" + ideas[i].artist)}&type=track&limit=1&market=from_token`);
          const hit = r?.tracks?.items?.[0];
          if (hit) resolved.push({ ...hit, reason: ideas[i].reason });
        } catch {}
        await new Promise((res) => setTimeout(res, 120));
      }
      if (!resolved.length) throw new Error("None of the ideas matched on Spotify — try again.");
      setRecs(resolved); setRecStatus(`${resolved.length} tracks ready.`);
    } catch (e) { setRecStatus(e.message || "Something went wrong."); }
    setRecBusy(false);
  };

  const createPlaylist = async () => {
    if (!recs.length) return;
    setCreating(true); setRecStatus("Creating playlist…");
    try {
      const name = (mood ? `Discover · ${mood}` : `Discover · ${new Date().toLocaleDateString()}`).slice(0, 90);
      const pl = await api("/me/playlists", { method: "POST", body: { name, description: "Generated with Claude via the bridge", public: false } });
      const uris = recs.map((t) => t.uri);
      try { await api(`/playlists/${pl.id}/tracks`, { method: "POST", body: { uris } }); }
      catch { await api(`/playlists/${pl.id}/items`, { method: "POST", body: { uris } }); }
      setPlaylistLink(pl.external_urls?.spotify); setRecStatus("Playlist saved to your library.");
    } catch (e) { setRecStatus(e.message || "Couldn't create the playlist."); }
    setCreating(false);
  };

  const refreshPlayback = useCallback(async () => {
    if (phase !== "ready") return;
    try {
      const p = await api("/me/player/currently-playing");
      if (p && p.item) { setNowPlaying(p.item); setIsPlaying(!!p.is_playing); setDeviceMsg(""); }
      else { setNowPlaying(null); setIsPlaying(false); }
    } catch {}
  }, [phase]);
  useEffect(() => {
    if (phase !== "ready") return;
    refreshPlayback();
    pollRef.current = setInterval(refreshPlayback, 5000);
    return () => clearInterval(pollRef.current);
  }, [phase, refreshPlayback]);

  const cmd = async (path, opts) => {
    try { await api(path, opts); setDeviceMsg(""); setTimeout(refreshPlayback, 350); }
    catch (e) {
      const m = e.message || "";
      if (m.includes("404") || /no active|NO_ACTIVE/i.test(m)) setDeviceMsg("No active device. Open Spotify on a device and press play once.");
      else if (m.includes("403")) setDeviceMsg("Playback control needs Spotify Premium.");
      else setDeviceMsg(m);
    }
  };
  const togglePlay = () => cmd(isPlaying ? "/me/player/pause" : "/me/player/play", { method: "PUT" });
  const playTrack = (t) => cmd("/me/player/play", { method: "PUT", body: { uris: [t.uri] } });
  const playAll = () => recs.length && cmd("/me/player/play", { method: "PUT", body: { uris: recs.map((t) => t.uri) } });
  const setVol = (v) => { setVolume(v); cmd(`/me/player/volume?volume_percent=${v}`, { method: "PUT" }); };
  const openExternal = (t) => window.open(t.external_urls?.spotify, "_blank");

  // ── Fuse ──
  const artistSeed = (a) => ({ key: "a:" + a.id, type: "artist", id: a.id, name: a.name, sub: "Artist", image: (a.images || []).slice(-1)[0]?.url, artistNames: [a.name] });
  const trackSeed = (t) => ({ key: "t:" + t.id, type: "track", id: t.id, name: t.name, sub: (t.artists || []).map((x) => x.name).join(", "), uri: t.uri, image: (t.album?.images || []).slice(-1)[0]?.url, artistNames: (t.artists || []).map((x) => x.name) });
  const seedSelected = (key) => seeds.some((s) => s.key === key);
  const toggleSeed = (item) => setSeeds((cur) => {
    if (cur.some((s) => s.key === item.key)) return cur.filter((s) => s.key !== item.key);
    if (cur.length >= 3) return cur;
    return [...cur, item];
  });

  const fuse = async () => {
    if (seeds.length < 2) return;
    setFuseBusy(true);
    setFuseStatus("Reading the identity of your picks…");
    try {
      const seedDesc = seeds.map((s) => s.type === "track" ? `"${s.name}" by ${s.sub}` : `${s.name} (artist)`).join("   +   ");
      const avoidArtists = [...new Set(seeds.flatMap((s) => s.artistNames || []))];
      const prompt =
        `You are a music curator building a "fusion" playlist. The listener chose these ${seeds.length} seeds to blend:\n${seedDesc}\n\n` +
        `1) Identify the core identity, themes and sonic character of each seed.\n` +
        `2) Find a genuinely interesting way to fuse them — a thread, mood, era or tension that ties them into something new, rather than just alternating between them.\n` +
        `3) Build a 16-track playlist that embodies that fusion: tracks that live in the overlap of these worlds.\n\n` +
        `HARD RULE — the result must go BEYOND the originals:\n` +
        `• Do NOT include any of the seed tracks themselves.\n` +
        `• Do NOT include ANY track by these artists: ${avoidArtists.join(", ")}.\n` +
        `• Every pick must be a different artist — music discovered in the space between the seeds, never the seeds themselves.\n\n` +
        `Return ONLY JSON, no prose or code fences: {"name": string (catchy playlist name, max 6 words), "concept": string (2 sentences describing the fusion), "tracks": [{"artist": string, "track": string, "reason": string (max 8 words)}]}`;
      const aiData = await logged("claude · fuse", { seeds: seedDesc, promptChars: prompt.length }, async () => {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1200, messages: [{ role: "user", content: prompt }] }),
        });
        if (!res.ok) throw new Error("Claude API HTTP " + res.status);
        const j = await res.json();
        return { contentBlocks: (j.content || []).length, _raw: j };
      }).then((r) => r._raw);
      const text = (aiData.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
      let parsed = null;
      try { parsed = JSON.parse(clean); } catch { const m = clean.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
      if (!parsed || !Array.isArray(parsed.tracks) || !parsed.tracks.length) throw new Error("Claude's reply couldn't be parsed.");
      const exclArtists = new Set();
      const exclTrackIds = new Set();
      seeds.forEach((s) => { (s.artistNames || []).forEach((n) => exclArtists.add(n.toLowerCase())); if (s.type === "track" && s.id) exclTrackIds.add(s.id); });
      const resolved = [];
      let skipped = 0;
      for (let i = 0; i < parsed.tracks.length; i++) {
        setFuseStatus(`Finding tracks on Spotify… ${i + 1}/${parsed.tracks.length}`);
        try {
          const r = await api(`/search?q=${encodeURIComponent("track:" + parsed.tracks[i].track + " artist:" + parsed.tracks[i].artist)}&type=track&limit=1&market=from_token`);
          const hit = r?.tracks?.items?.[0];
          if (hit) {
            const byOriginalArtist = (hit.artists || []).some((a) => exclArtists.has((a.name || "").toLowerCase()));
            const isOriginalTrack = exclTrackIds.has(hit.id);
            const dup = resolved.some((x) => x.id === hit.id);
            if (byOriginalArtist || isOriginalTrack) skipped++;
            else if (!dup) resolved.push({ ...hit, reason: parsed.tracks[i].reason });
          }
        } catch {}
        await new Promise((res) => setTimeout(res, 120));
      }
      if (!resolved.length) throw new Error("Everything resolved back to your originals — try re-fusing.");
      const newFuse = { id: "f" + Date.now(), name: parsed.name || "Fusion", concept: parsed.concept || "", recs: resolved, seeds: [...seeds], link: null };
      setFuses((cur) => [newFuse, ...cur]);
      setActiveFuseId(newFuse.id);
      setView("fuse");
      setFuseStatus(`${resolved.length} tracks ready${skipped ? ` · skipped ${skipped} that circled back to your picks` : ""}.`);
    } catch (e) { setFuseStatus(e.message || "Something went wrong."); }
    setFuseBusy(false);
  };

  const activeFuse = fuses.find((f) => f.id === activeFuseId) || null;

  const createFusePlaylist = async () => {
    if (!activeFuse?.recs.length) return;
    setFuseCreating(true); setFuseStatus("Creating playlist…");
    try {
      const name = (activeFuse.name || "Fusion").slice(0, 90);
      const desc = `${activeFuse.concept || ""} — fused with Claude from: ${activeFuse.seeds.map((s) => s.name).join(", ")}`.slice(0, 290);
      const pl = await api("/me/playlists", { method: "POST", body: { name, description: desc, public: false } });
      const uris = activeFuse.recs.map((t) => t.uri);
      try { await api(`/playlists/${pl.id}/tracks`, { method: "POST", body: { uris } }); }
      catch { await api(`/playlists/${pl.id}/items`, { method: "POST", body: { uris } }); }
      setFuses((cur) => cur.map((f) => f.id === activeFuse.id ? { ...f, link: pl.external_urls?.spotify } : f));
      setFuseStatus("Playlist saved to your library.");
    } catch (e) { setFuseStatus(e.message || "Couldn't create the playlist."); }
    setFuseCreating(false);
  };

  const playFuse = () => activeFuse?.recs.length && cmd("/me/player/play", { method: "PUT", body: { uris: activeFuse.recs.map((t) => t.uri) } });

  const runSearch = useCallback(async (q) => {
    try {
      const r = await api(`/search?q=${encodeURIComponent(q)}&type=track,artist&limit=8&market=from_token`);
      setSearchArtists(r?.artists?.items || []);
      setSearchTracks(r?.tracks?.items || []);
    } catch { setSearchArtists([]); setSearchTracks([]); }
    setSearchBusy(false);
  }, []);
  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) { setSearchArtists([]); setSearchTracks([]); setSearchBusy(false); return; }
    setSearchBusy(true);
    const t = setTimeout(() => runSearch(q), 450);
    return () => clearTimeout(t);
  }, [searchQ, runSearch]);

  // ── Boot / no-bridge / setup screens ──
  if (phase === "boot") return (
    <div style={{ background: C.bg, minHeight: 480, display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", color: C.sub }}><Spinner /> Connecting to the bridge…</div>
    </div>
  );
  if (phase === "noBridge") return (
    <div style={{ background: C.bg, minHeight: 480, color: C.text, fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <Plug size={40} color={C.green} style={{ marginBottom: 12 }} />
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px" }}>Extension not detected</h1>
        <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5 }}>Install the <strong style={{ color: C.text }}>Fuse</strong> extension (see the README), then reload this tab. The bridge only injects on page load, so a fresh reload after installing is required.</p>
        <GreenBtn onClick={() => window.location.reload()} style={{ marginTop: 16 }}>Reload</GreenBtn>
      </div>
    </div>
  );
  if (phase === "setup") {
    const Step = ({ n, title, children }) => (
      <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
        <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: C.card, border: `1px solid ${C.line}`, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: C.green }}>{n}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{title}</div>
          {children}
        </div>
      </div>
    );
    return (
    <div style={{ background: C.bg, minHeight: 480, color: C.text, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 580, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.green, display: "grid", placeItems: "center" }}><Blend size={22} color="#000" /></div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Connect Spotify</h1>
        </div>
        <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, margin: "0 0 4px" }}>One-time setup, ~2 minutes. Spotify needs you to register your own free app — no payment, no review. The extension handles the actual login for you.</p>

        <Step n={1} title="Create a free Spotify app">
          <p style={{ color: C.sub, fontSize: 13.5, lineHeight: 1.5, margin: "0 0 8px" }}>
            Open the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={{ color: C.green }}>Spotify Developer Dashboard</a>, click <strong style={{ color: C.text }}>Create app</strong>. Give it any name, and tick <strong style={{ color: C.text }}>Web API</strong> under "Which API/SDKs are you planning to use?".
          </p>
        </Step>

        <Step n={2} title="Add this redirect URI to the app">
          <p style={{ color: C.sub, fontSize: 13.5, lineHeight: 1.5, margin: "0 0 8px" }}>Paste it into the app's <strong style={{ color: C.text }}>Redirect URIs</strong> field, exactly. (It's the same for everyone using this extension.)</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, background: C.card, padding: "10px 12px", borderRadius: 6, fontSize: 12.5, wordBreak: "break-all" }}>{cfg?.redirectUri}</code>
            <button onClick={() => { navigator.clipboard?.writeText(cfg?.redirectUri || ""); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
              style={{ background: "transparent", border: `1px solid ${C.faint}`, color: C.text, borderRadius: 6, padding: "9px 12px", cursor: "pointer", display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <Copy size={14} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </Step>

        <Step n={3} title="Paste your Client ID and connect">
          <p style={{ color: C.sub, fontSize: 13.5, lineHeight: 1.5, margin: "0 0 8px" }}>After saving the app, copy its <strong style={{ color: C.text }}>Client ID</strong> from the app's Settings page and paste it here.{cfg?.hasClientId ? " (One's already saved — leave blank to reuse it.)" : ""}</p>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={cfg?.hasClientId ? "•••••• (already stored)" : "e.g. 4a1b9c…"}
            style={{ width: "100%", boxSizing: "border-box", background: C.card, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "12px 14px", fontSize: 13, fontFamily: "ui-monospace, monospace" }} />
          {authErr && <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#f15e6c", fontSize: 14, marginTop: 12 }}><AlertCircle size={16} /> {authErr}</div>}
          <div style={{ marginTop: 14 }}>
            <GreenBtn onClick={connect} disabled={connecting || (!clientId.trim() && !cfg?.hasClientId)}>{connecting ? "Opening Spotify…" : "Connect with Spotify"}</GreenBtn>
          </div>
        </Step>
      </div>
    </div>
    );
  }

  // ── Main app ──
  const RangeTabs = () => (
    <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
      {[["short_term", "4 weeks"], ["medium_term", "6 months"], ["long_term", "All time"]].map(([k, label]) => (
        <button key={k} onClick={() => setRange(k)}
          style={{ background: range === k ? C.text : "transparent", color: range === k ? "#000" : C.sub, border: `1px solid ${range === k ? C.text : C.line}`, borderRadius: 500, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label}</button>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 640, background: C.bg, color: C.text, fontFamily: "system-ui, sans-serif", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 220, background: C.panel, padding: "20px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 18px" }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.green, display: "grid", placeItems: "center" }}><Blend size={17} color="#000" /></div>
            <span style={{ fontWeight: 800, fontSize: 15 }}>Fuse</span>
          </div>
          {[["home", "Your library", Home], ["fuse", "Fuses", Blend], ["discover", "Discover", Sparkles], ["logs", "Logs", Terminal]].map(([k, label, Icon]) => {
            const badge = k === "logs" ? logs.filter((l) => l.status === "error").length : k === "fuse" ? fuses.length : 0;
            const badgeBg = k === "logs" ? "#f15e6c" : C.green;
            return (
              <button key={k} onClick={() => setView(k)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 12px", borderRadius: 6, background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: view === k ? C.text : C.sub, textAlign: "left" }}>
                <Icon size={20} /> {label}
                {badge > 0 && <span style={{ marginLeft: "auto", background: badgeBg, color: "#000", fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "1px 7px" }}>{badge}</span>}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, margin: "0 8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {profile?.images?.[0]?.url ? <ProxyImg src={profile.images[0].url} alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
                : <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.card, display: "grid", placeItems: "center" }}><User size={15} color={C.sub} /></div>}
              <span style={{ fontSize: 13, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile?.display_name || "You"}</span>
            </div>
            <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", color: C.faint, fontSize: 12, cursor: "pointer", marginTop: 10, padding: "4px 0" }}>
              <LogOut size={14} /> Disconnect
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, background: `linear-gradient(180deg,#1f1f1f 0%, ${C.bg} 240px)`, overflowY: "auto" }}>
          <div style={{ padding: "28px 28px 40px" }}>
            {view === "home" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 6px" }}>
                  <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Your library</h1>
                </div>
                <p style={{ color: C.sub, fontSize: 14, margin: "0 0 16px" }}>Browse what you've played most across each window, and tap up to 3 artists or tracks to <strong style={{ color: C.text }}>fuse</strong> them into something new.</p>

                {/* Fuse tray */}
                <div style={{ background: C.panel, border: `1px solid ${seeds.length ? C.green : C.line}`, borderRadius: 12, padding: 14, marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Blend size={18} color={C.green} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Fuse</span>
                    <span style={{ color: C.faint, fontSize: 13 }}>{seeds.length}/3 selected</span>
                    <div style={{ flex: 1 }} />
                    {seeds.length > 0 && <button onClick={() => setSeeds([])} style={{ background: "transparent", border: "none", color: C.sub, fontSize: 13, cursor: "pointer" }}>Clear</button>}
                    <GreenBtn onClick={fuse} disabled={seeds.length < 2 || fuseBusy} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 20px" }}><Blend size={15} /> {fuseBusy ? "Fusing…" : "Fuse these"}</GreenBtn>
                  </div>
                  {seeds.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      {seeds.map((s) => (
                        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, background: C.card, border: `1px solid ${C.green}`, borderRadius: 500, padding: "5px 10px 5px 5px" }}>
                          {s.image ? <ProxyImg src={s.image} alt="" style={{ width: 24, height: 24, borderRadius: s.type === "artist" ? "50%" : 4, objectFit: "cover" }} /> : null}
                          <span style={{ fontSize: 12.5, fontWeight: 600, maxWidth: 150, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                          <X size={14} style={{ cursor: "pointer", color: C.sub }} onClick={() => toggleSeed(s)} />
                        </div>
                      ))}
                    </div>
                  )}
                  {seeds.length === 0 && <div style={{ color: C.faint, fontSize: 12.5, marginTop: 8 }}>Pick at least 2 from below. Fuse always returns different artists — the music between your choices.</div>}
                  {fuseStatus && <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.sub, fontSize: 13, marginTop: 12 }}>{fuseBusy && <Spinner size={14} />}{fuseStatus}</div>}
                </div>

                {/* Search any of Spotify */}
                <div style={{ position: "relative", marginBottom: 14 }}>
                  <Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.faint }} />
                  <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search Spotify for any artist or track to fuse…"
                    style={{ width: "100%", background: C.card, border: `1px solid ${C.line}`, color: C.text, borderRadius: 500, padding: "12px 40px 12px 38px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                  {searchBusy ? <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)" }}><Spinner size={15} /></span>
                    : searchQ ? <X size={16} onClick={() => setSearchQ("")} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: C.faint, cursor: "pointer" }} /> : null}
                </div>
                {searchQ.trim().length >= 2 && (
                  <div style={{ marginBottom: 22 }}>
                    {searchArtists.length > 0 && (
                      <>
                        <h3 style={{ fontSize: 13, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 6px" }}>Artists</h3>
                        {searchArtists.slice(0, 4).map((a) => { const it = artistSeed(a); return <Selectable key={"sa" + it.key} item={it} selected={seedSelected(it.key)} disabled={seeds.length >= 3} onToggle={toggleSeed} />; })}
                      </>
                    )}
                    {searchTracks.length > 0 && (
                      <>
                        <h3 style={{ fontSize: 13, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: 0.4, margin: "12px 0 6px" }}>Tracks</h3>
                        {searchTracks.slice(0, 8).map((t) => { const it = trackSeed(t); return <Selectable key={"st" + it.key} item={it} selected={seedSelected(it.key)} disabled={seeds.length >= 3} onToggle={toggleSeed} onPlay={() => playTrack(t)} />; })}
                      </>
                    )}
                    {!searchBusy && !searchArtists.length && !searchTracks.length && <div style={{ color: C.faint, fontSize: 14, padding: "8px 2px" }}>No matches for "{searchQ.trim()}".</div>}
                  </div>
                )}

                <RangeTabs />
                {loadingData ? <div style={{ display: "flex", gap: 10, alignItems: "center", color: C.sub }}><Spinner /> Loading your history…</div> : (
                  <>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 10px" }}>Top artists</h2>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px,1fr))", gap: 14, marginBottom: 28 }}>
                      {topArtists.map((a) => {
                        const it = artistSeed(a); const sel = seedSelected(it.key); const blocked = seeds.length >= 3 && !sel;
                        return (
                          <div key={a.id} onClick={() => !blocked && toggleSeed(it)} title={blocked ? "Clear a pick first" : "Tap to fuse"}
                            style={{ position: "relative", background: C.card, padding: 14, borderRadius: 8, cursor: blocked ? "default" : "pointer",
                              border: `1px solid ${sel ? C.green : "transparent"}`, opacity: blocked ? 0.45 : 1 }}>
                            {a.images?.[0]?.url ? <ProxyImg src={a.images[0].url} alt="" style={{ width: "100%", aspectRatio: "1", borderRadius: "50%", objectFit: "cover" }} />
                              : <div style={{ width: "100%", aspectRatio: "1", borderRadius: "50%", background: C.panel }} />}
                            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                            <div style={{ fontSize: 12, color: C.sub }}>Artist</div>
                            {sel && <div style={{ position: "absolute", top: 10, right: 10, width: 24, height: 24, borderRadius: "50%", background: C.green, display: "grid", placeItems: "center", boxShadow: "0 2px 6px rgba(0,0,0,.4)" }}><Check size={14} color="#000" /></div>}
                          </div>
                        );
                      })}
                    </div>

                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 8px" }}>Top tracks</h2>
                    <div style={{ marginBottom: 28 }}>
                      {topTracks.map((t, i) => { const it = trackSeed(t); return <Selectable key={t.id + i} item={it} rank={i + 1} selected={seedSelected(it.key)} disabled={seeds.length >= 3} onToggle={toggleSeed} onPlay={() => playTrack(t)} />; })}
                    </div>

                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 8px", display: "flex", alignItems: "center", gap: 8 }}><Clock size={18} /> Recently played</h2>
                    <div>
                      {(() => {
                        const seen = new Set(); const list = [];
                        recent.forEach((t) => { if (t && t.id && !seen.has(t.id)) { seen.add(t.id); list.push(t); } });
                        return list.slice(0, 15).map((t) => { const it = trackSeed(t); return <Selectable key={"r" + it.key} item={it} selected={seedSelected(it.key)} disabled={seeds.length >= 3} onToggle={toggleSeed} onPlay={() => playTrack(t)} />; });
                      })()}
                    </div>
                  </>
                )}
              </>
            )}
            {view === "fuse" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}><Blend size={24} color={C.green} /><h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Fuses</h1></div>
                <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, maxWidth: 560, margin: "0 0 18px" }}>The playlists you've fused this session. Pick seeds on <strong style={{ color: C.text }}>Your library</strong> and hit Fuse to make a new one.</p>
                {fuses.length === 0 ? (
                  <div style={{ marginTop: 40, textAlign: "center", color: C.faint }}><Blend size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} /><p style={{ fontSize: 15 }}>No fuses yet — pick 2–3 artists or tracks from Your library and hit Fuse.</p></div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
                      {fuses.map((f) => {
                        const sel = f.id === activeFuseId;
                        return (
                          <button key={f.id} onClick={() => setActiveFuseId(f.id)}
                            style={{ textAlign: "left", background: C.card, border: `1px solid ${sel ? C.green : C.line}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", color: C.text, minWidth: 180, maxWidth: 260 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                            <div style={{ fontSize: 12, color: C.sub, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.recs.length} tracks · {f.seeds.map((s) => s.name).join(", ")}</div>
                          </button>
                        );
                      })}
                    </div>
                    {activeFuse && (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
                          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}><Blend size={18} color={C.green} />{activeFuse.name}</div>
                          <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.55 }}>{activeFuse.concept}</div>
                        </div>
                        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                          <GreenBtn onClick={createFusePlaylist} disabled={fuseCreating} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 22px" }}><Plus size={16} /> {fuseCreating ? "Saving…" : "Save as playlist"}</GreenBtn>
                          <button onClick={playFuse} style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: `1px solid ${C.faint}`, color: C.text, borderRadius: 500, padding: "10px 22px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}><Play size={15} /> Play on my device</button>
                          <button onClick={fuse} disabled={fuseBusy || seeds.length < 2} style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", color: C.sub, fontSize: 14, cursor: "pointer" }}><RefreshCw size={15} /> {fuseBusy ? "Fusing…" : "Re-fuse"}</button>
                        </div>
                        {activeFuse.link && <a href={activeFuse.link} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.green, fontSize: 14, marginBottom: 12 }}>Open playlist in Spotify <ExternalLink size={14} /></a>}
                        <div>{activeFuse.recs.map((t, i) => <TrackRow key={"fuse" + i} track={t} index={i} onPlay={playTrack} onOpen={openExternal} reason={t.reason} />)}</div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {view === "discover" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}><Sparkles size={24} color={C.green} /><h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Discover</h1></div>
                <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, maxWidth: 560, margin: "0 0 18px" }}>Claude reads your history and suggests new music, resolved to real Spotify tracks you can play or save.</p>
                <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
                  <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Optional: a mood — e.g. 'rainy Sunday jazz'" onKeyDown={(e) => e.key === "Enter" && !recBusy && generate()}
                    style={{ flex: 1, minWidth: 240, background: C.card, border: `1px solid ${C.line}`, color: C.text, borderRadius: 500, padding: "12px 18px", fontSize: 14, outline: "none" }} />
                  <GreenBtn onClick={generate} disabled={recBusy || loadingData}>{recBusy ? "Working…" : "Generate"}</GreenBtn>
                </div>
                {recStatus && <div style={{ display: "flex", alignItems: "center", gap: 8, color: recs.length ? C.green : C.sub, fontSize: 13, marginBottom: 16 }}>{recBusy && <Spinner size={14} />}{!recBusy && recs.length > 0 && <Check size={15} />}{recStatus}</div>}
                {recs.length > 0 && (
                  <>
                    <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                      <GreenBtn onClick={createPlaylist} disabled={creating} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 22px" }}><Plus size={16} /> {creating ? "Saving…" : "Save as playlist"}</GreenBtn>
                      <button onClick={playAll} style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: `1px solid ${C.faint}`, color: C.text, borderRadius: 500, padding: "10px 22px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}><Play size={15} /> Play on my device</button>
                      <button onClick={generate} style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", color: C.sub, fontSize: 14, cursor: "pointer" }}><RefreshCw size={15} /> Regenerate</button>
                    </div>
                    {playlistLink && <a href={playlistLink} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.green, fontSize: 14, marginBottom: 14 }}>Open playlist in Spotify <ExternalLink size={14} /></a>}
                    <div style={{ marginTop: 6 }}>{recs.map((t, i) => <TrackRow key={"rec" + i} track={t} index={i} onPlay={playTrack} onOpen={openExternal} reason={t.reason} />)}</div>
                  </>
                )}
                {!recs.length && !recBusy && (
                  <div style={{ marginTop: 40, textAlign: "center", color: C.faint }}><Search size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} /><p style={{ fontSize: 15 }}>Hit Generate to explore something new.</p></div>
                )}
              </>
            )}
            {view === "logs" && <LogsView logs={logs} onClear={() => logStore.clear()} />}
          </div>
        </div>
      </div>

      <div style={{ height: 84, background: C.panel, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", padding: "0 18px", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: 260, minWidth: 0 }}>
          {nowPlaying?.album?.images?.slice(-1)?.[0]?.url ? <ProxyImg src={nowPlaying.album.images.slice(-1)[0].url} alt="" style={{ width: 52, height: 52, borderRadius: 4 }} />
            : <div style={{ width: 52, height: 52, borderRadius: 4, background: C.card, display: "grid", placeItems: "center" }}><Music size={20} color={C.faint} /></div>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nowPlaying?.name || "Nothing playing"}</div>
            <div style={{ fontSize: 12, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nowPlaying ? (nowPlaying.artists || []).map((a) => a.name).join(", ") : "Start playback on a Spotify device"}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <SkipBack size={20} style={{ color: C.sub, cursor: "pointer" }} onClick={() => cmd("/me/player/previous", { method: "POST" })} />
            <div onClick={togglePlay} style={{ width: 38, height: 38, borderRadius: "50%", background: C.text, display: "grid", placeItems: "center", cursor: "pointer" }}>
              {isPlaying ? <Pause size={18} color="#000" /> : <Play size={18} color="#000" style={{ marginLeft: 2 }} />}
            </div>
            <SkipForward size={20} style={{ color: C.sub, cursor: "pointer" }} onClick={() => cmd("/me/player/next", { method: "POST" })} />
          </div>
          {deviceMsg && <div style={{ fontSize: 11, color: "#f0c14b", textAlign: "center", maxWidth: 460, lineHeight: 1.3 }}>{deviceMsg}</div>}
        </div>
        <div style={{ width: 200, display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
          <Volume2 size={18} color={C.sub} />
          <input type="range" min="0" max="100" value={volume} onChange={(e) => setVol(Number(e.target.value))} style={{ width: 110, accentColor: C.green }} />
        </div>
      </div>
    </div>
  );
}
