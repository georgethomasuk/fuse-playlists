// Relay injected only into Claude pages (see manifest `matches`), incl. the
// sandboxed artifact iframe. Forwards namespaced __bridge requests to the
// privileged background worker, with logging + a retry for reads (covers the
// MV3 cold-start dropped message).
(() => {
  const TAG = "[fuse-cs]";

  // Only these actions may ever be relayed to the worker. An unknown action is
  // dropped here so the page can't reach anything we didn't intend to expose.
  const ACTIONS = {
    ping: { read: true },
    spotifyGetConfig: { read: true },
    spotifySetClientId: { read: false },
    spotifyConnect: { read: false },
    spotifyLogout: { read: false },
    spotifyFetch: { read: null }, // read-ness depends on method, computed below
    fetchImage: { read: true },
  };
  const isRead = (m) => {
    if (!m || !ACTIONS[m.action]) return false;
    if (m.action === "spotifyFetch") return (m.method || "GET") === "GET";
    return !!ACTIONS[m.action].read;
  };
  const labelOf = (m) => (m && m.action === "spotifyFetch") ? ((m.method || "GET") + " " + m.path) : (m && m.action);

  const announce = () => { try { window.postMessage({ __bridge: "ready" }, "*"); } catch (e) {} };
  announce(); setTimeout(announce, 500); setTimeout(announce, 1500);

  function reply(id, payload) { window.postMessage({ __bridge: "response", id, ...payload }, "*"); }

  function forward(msg, id, attempt) {
    const label = labelOf(msg);
    console.log(TAG, "→bg", label, "id=" + id, "try=" + attempt);
    let settled = false;
    const watch = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (attempt < 2 && isRead(msg)) {
        console.warn(TAG, "no reply in 6s — retrying (worker cold-start?)", label, "id=" + id);
        forward(msg, id, attempt + 1);
      } else {
        console.warn(TAG, "no reply in 6s — giving up", label, "id=" + id);
        reply(id, { __error: "no reply from background (after retry)" });
      }
    }, 6000);
    try {
      chrome.runtime.sendMessage({ ...msg, __reqId: id }, (resp) => {
        if (settled) { console.log(TAG, "late reply ignored", label, "id=" + id); return; }
        settled = true; clearTimeout(watch);
        const err = chrome.runtime.lastError;
        if (err) { console.warn(TAG, "←bg lastError", err.message, label, "id=" + id); reply(id, { __error: err.message }); }
        else { console.log(TAG, "←bg ok", label, "id=" + id); reply(id, resp || { __error: "empty response" }); }
      });
    } catch (ex) {
      if (settled) return;
      settled = true; clearTimeout(watch);
      console.warn(TAG, "send threw", ex);
      reply(id, { __error: String((ex && ex.message) || ex) });
    }
  }

  window.addEventListener("message", (event) => {
    // Defence in depth: only accept messages posted from THIS frame (the app
    // running in the same artifact iframe), not from the parent page or any
    // other frame. The content script itself only runs on Claude origins.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__bridge !== "request") return;
    // Drop anything that isn't a known, allow-listed action.
    if (!data.msg || !ACTIONS[data.msg.action]) {
      console.warn(TAG, "dropped unknown action", data.msg && data.msg.action);
      return;
    }
    forward(data.msg, data.id, 1);
  });
})();
