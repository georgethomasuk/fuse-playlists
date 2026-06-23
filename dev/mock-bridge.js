// ───────────────────────────────────────────────────────────────────────────
// Local dev mock. Imported before <App/> so the boot ping succeeds.
//
// The real app talks to a Chrome extension over window.postMessage and to
// Claude over fetch(api.anthropic.com). Neither exists locally, so here we:
//   1. answer the postMessage "bridge" protocol with canned Spotify data, and
//   2. stub window.fetch for the Claude endpoint with a canned playlist.
//
// This lets you click through the whole UI offline — pick seeds, fuse, and
// watch the result land in the new Fuses tab. Nothing here ships; app/ and
// extension/ are untouched.
// ───────────────────────────────────────────────────────────────────────────

const PALETTE = ["#1DB954", "#E91E63", "#3F51B5", "#FF9800", "#9C27B0", "#00BCD4", "#F44336", "#8BC34A"];

// Offline, dependency-free avatar: a coloured square/circle with an initial,
// returned as a data: URL so ProxyImg renders it directly.
function avatar(seed, round) {
  const bg = PALETTE[Math.abs(hash(seed)) % PALETTE.length];
  const letter = (seed[0] || "?").toUpperCase();
  const r = round ? 100 : 12;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' rx='${r}' fill='${bg}'/><text x='50%' y='54%' font-family='system-ui,sans-serif' font-size='80' font-weight='700' fill='#fff' text-anchor='middle' dominant-baseline='middle'>${letter}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

function artist(name) {
  return { id: "ar_" + hash(name), name, images: [{ url: avatar(name, true) }] };
}
function track(name, artistName) {
  const id = "tr_" + hash(name + artistName);
  return {
    id, name, uri: "spotify:track:" + id,
    artists: [{ name: artistName }],
    album: { images: [{ url: avatar(name, false) }] },
    external_urls: { spotify: "https://open.spotify.com/track/" + id },
  };
}

const TOP_ARTISTS = ["Radiohead", "Aphex Twin", "Floating Points", "Bonobo", "Caribou", "Burial", "Four Tet", "Khruangbin", "Tame Impala", "Jamie xx", "Nils Frahm", "Jon Hopkins"].map(artist);
const TOP_TRACKS = [
  track("Weird Fishes", "Radiohead"), track("Xtal", "Aphex Twin"), track("Silhouettes", "Floating Points"),
  track("Kerala", "Bonobo"), track("Odessa", "Caribou"), track("Archangel", "Burial"),
  track("Two Thousand and Seventeen", "Four Tet"), track("Time (You and I)", "Khruangbin"),
  track("Let It Happen", "Tame Impala"), track("Gosh", "Jamie xx"), track("Says", "Nils Frahm"),
  track("Emerald Rush", "Jon Hopkins"), track("Idioteque", "Radiohead"), track("Windowlicker", "Aphex Twin"),
  track("LesAlpx", "Floating Points"), track("Cirrus", "Bonobo"), track("Can't Do Without You", "Caribou"),
  track("Untrue", "Burial"), track("Baba O'Riley", "Khruangbin"), track("The Less I Know The Better", "Tame Impala"),
];
const RECENT = TOP_TRACKS.slice(0, 15).map((t) => ({ track: t }));

// A canned 16-track fusion + a 12-track discovery list, returned by the Claude stub.
const FUSE_TRACKS = [
  ["Jon Hopkins", "Open Eye Signal"], ["Rival Consoles", "Recovery"], ["Clark", "Winter Linn"],
  ["Telefon Tel Aviv", "Fahrenheit Fair Enough"], ["Boards of Canada", "Roygbiv"], ["Pantha du Prince", "Stick To My Side"],
  ["Lone", "Aurora Northern Quarter"], ["Max Cooper", "Order From Chaos"], ["Apparat", "Goodbye"],
  ["Jacques Greene", "Another Girl"], ["Gold Panda", "Quitter's Raga"], ["Mount Kimbie", "Made To Stray"],
  ["Daphni", "Ye Ye"], ["Bicep", "Glue"], ["Overmono", "So U Kno"], ["Floating Points", "Last Bloom"],
].map(([a, t], i) => ({ artist: a, track: t, reason: ["bridges ambient and dancefloor", "warm analog pulse", "shared melodic ache", "head-nod groove", "textural overlap", "after-hours mood"][i % 6] }));
const DISCOVER_IDEAS = FUSE_TRACKS.slice(0, 12);

// ── postMessage bridge mock ──────────────────────────────────────────────────
function reply(id, payload) { window.postMessage({ __bridge: "response", id, ...payload }, "*"); }

function spotify(path, method) {
  const [base, query] = path.split("?");
  const q = new URLSearchParams(query || "");
  if (base === "/me") return { display_name: "Local Tester", images: [{ url: avatar("Local Tester", true) }] };
  if (base === "/me/top/tracks") return { items: TOP_TRACKS };
  if (base === "/me/top/artists") return { items: TOP_ARTISTS };
  if (base === "/me/player/recently-played") return { items: RECENT };
  if (base === "/me/player/currently-playing") return {}; // nothing playing
  if (base === "/search") {
    const term = q.get("q") || "";
    const type = q.get("type") || "";
    if (type === "track") {
      // fuse / discover resolution — synthesise a hit from "track:X artist:Y"
      const tm = /track:(.+?) artist:(.+)$/.exec(term);
      const name = tm ? tm[1] : term, by = tm ? tm[2] : "Various";
      return { tracks: { items: [track(name, by)] } };
    }
    // home search box: "track,artist"
    const word = term.trim() || "Result";
    return {
      artists: { items: [artist(word + " Band"), artist(word + " Collective")] },
      tracks: { items: [track(word + " (Live)", word + " Band"), track(word + " Reprise", word + " Collective")] },
    };
  }
  if (base === "/me/playlists" && method === "POST") {
    return { id: "pl_mock", external_urls: { spotify: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" } };
  }
  return {}; // playlists/*/tracks, player play/pause/volume, etc. → just OK
}

window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.__bridge !== "request") return;
  const { id, msg } = d;
  switch (msg.action) {
    case "ping": return reply(id, { pong: true });
    case "spotifyGetConfig": return reply(id, { connected: true, hasClientId: true, redirectUri: "http://localhost (mock)" });
    case "spotifySetClientId": return reply(id, { ok: true });
    case "spotifyConnect": return reply(id, { connected: true });
    case "spotifyLogout": return reply(id, { ok: true });
    case "fetchImage": return reply(id, { dataUrl: msg.url }); // url is already a data: URL here
    case "spotifyFetch": {
      const data = spotify(msg.path, msg.method || "GET");
      return reply(id, { ok: true, status: 200, data, __path: msg.path });
    }
    default: return reply(id, { __error: "mock: unknown action " + msg.action });
  }
});

// ── Claude (fetch) stub ──────────────────────────────────────────────────────
const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts) => {
  if (typeof url === "string" && url.includes("api.anthropic.com")) {
    const prompt = JSON.parse(opts?.body || "{}")?.messages?.[0]?.content || "";
    let text;
    if (/fusion/i.test(prompt)) {
      text = JSON.stringify({ name: "Midnight Circuitry", concept: "Where the seeds' restless electronics meet a slow, glowing pulse. Late-night music built from the spaces between your picks.", tracks: FUSE_TRACKS });
    } else {
      text = JSON.stringify(DISCOVER_IDEAS);
    }
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, opts);
};

console.info("%c[dev] mock bridge + Claude stub installed", "color:#1DB954;font-weight:700");
