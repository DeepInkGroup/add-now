const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = __dirname;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(filename, (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
    response.end(data);
  });
});

const profile = path.join(root, ".browser-check");
const preview = path.join(root, "test-preview.png");
fs.rmSync(profile, { recursive: true, force: true });
const browser = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-default-apps",
  "--remote-debugging-port=9247",
  "--user-data-dir=" + profile,
  "about:blank"
], { windowsHide: true, stdio: "ignore" });

let socket;
let id = 0;
const pending = new Map();
const errors = [];
function rpc(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const callId = ++id;
    const timer = setTimeout(() => {
      pending.delete(callId);
      reject(new Error("CDP timeout: " + method));
    }, 12000);
    pending.set(callId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: callId, method, params, sessionId }));
  });
}
async function evaluate(sessionId, expression) {
  const result = await rpc("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error("Timeout: " + label);
}

(async () => {
  try {
    await new Promise((resolve) => server.listen(4174, "127.0.0.1", resolve));
    let endpoint;
    await until(async () => {
      try {
        endpoint = await (await fetch("http://127.0.0.1:9247/json/version")).json();
        return true;
      } catch {
        return false;
      }
    }, "Chrome launch");
    socket = new WebSocket(endpoint.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const task = pending.get(message.id);
        if (!task) return;
        clearTimeout(task.timer);
        pending.delete(message.id);
        message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        errors.push(message.params.exceptionDetails);
      }
    };

    const target = await rpc("Target.createTarget", { url: "about:blank" });
    const attached = await rpc("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const session = attached.sessionId;
    await rpc("Runtime.enable", {}, session);
    await rpc("Page.enable", {}, session);
    await rpc("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
    await rpc("Page.navigate", { url: "http://127.0.0.1:4174" }, session);
    await until(() => evaluate(session, "document.readyState === 'complete' && !!document.getElementById('creatorModeButton')"), "app ready");

    assert.ok(await evaluate(session, "document.documentElement.scrollWidth <= 390"), "mobile layout fits the viewport");
    await evaluate(session, "document.getElementById('mediaUrl').value='https://www.youtube.com/playlist?list=PL1234567890ABCDE';document.getElementById('mediaUrl').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.match(await evaluate(session, "document.getElementById('linkInsight').textContent"), /YT PLAYLIST.*ADAPTIVE HD/);
    await evaluate(session, "document.getElementById('addForm').requestSubmit()");
    await until(() => evaluate(session, "document.querySelector('#playerStage iframe')?.src.includes('youtube-nocookie.com/embed/videoseries')"), "playlist player");
    assert.equal(await evaluate(session, "document.getElementById('emptyPlayer').hidden"), true);
    assert.equal(await evaluate(session, "document.getElementById('qualityBadge').textContent"), "ADAPTIVE HD");

    await evaluate(session, "document.getElementById('creatorModeButton').click();document.getElementById('creatorQuery').value='Demo Maker';document.getElementById('creatorForm').requestSubmit()");
    await until(() => evaluate(session, "document.getElementById('apiDialog').open"), "API key dialog");
    assert.equal(await evaluate(session, "document.getElementById('addForm').hidden"), true);

    const mockExpression = `
      window.fetch = async (input) => {
        const url = new URL(String(input));
        const thumb = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect width='100%25' height='100%25' fill='%23d9ff4f'/%3E%3C/svg%3E";
        let body;
        if (url.pathname.endsWith("/search")) body = {items:[{id:{channelId:"UCdemo"},snippet:{title:"Demo Maker",customUrl:"@demomaker",thumbnails:{default:{url:thumb}}}}]};
        else if (url.pathname.endsWith("/channels")) body = {items:[{id:"UCdemo",snippet:{title:"Demo Maker",thumbnails:{default:{url:thumb}}},contentDetails:{relatedPlaylists:{uploads:"UUdemo"}},statistics:{subscriberCount:"125000",videoCount:"42"}}]};
        else body = {items:[{snippet:{title:"First Film",publishedAt:"2026-01-10T00:00:00Z",videoOwnerChannelTitle:"Demo Maker",thumbnails:{default:{url:thumb}}},contentDetails:{videoId:"video12345"}}]};
        return new Response(JSON.stringify(body), {status:200,headers:{"Content-Type":"application/json"}});
      };
      document.getElementById("youtubeApiKey").value="test-key-only-not-a-google-credential-12345";
      document.getElementById("saveApiKey").click();
    `;
    await evaluate(session, mockExpression);
    await until(() => evaluate(session, "document.querySelectorAll('.channel-card').length === 1"), "channel search");
    assert.equal(await evaluate(session, "document.querySelector('.channel-card strong').textContent"), "Demo Maker");
    await evaluate(session, "document.querySelector('.channel-card').click()");
    await until(() => evaluate(session, "document.querySelectorAll('.video-card').length === 1"), "creator uploads");
    assert.match(await evaluate(session, "document.getElementById('channelStats').textContent"), /125K subscribers.*42 public videos/);
    await evaluate(session, "document.querySelector('.video-card').click()");
    await until(() => evaluate(session, "document.getElementById('mediaTitle').textContent === 'First Film'"), "creator video playback");

    await evaluate(session, "document.getElementById('linkModeButton').click();document.getElementById('mediaUrl').value='https://media.example.com/movie.mp4';document.getElementById('mediaUrl').dispatchEvent(new Event('input',{bubbles:true}))");
    assert.match(await evaluate(session, "document.getElementById('linkInsight').textContent"), /DIRECT VIDEO.*HIGH COMPAT/);
    await evaluate(session, "document.getElementById('addForm').requestSubmit()");
    await until(() => evaluate(session, "document.querySelector('#playerStage video') !== null"), "direct video player");
    assert.equal(await evaluate(session, "document.getElementById('directTools').hidden"), false);
    await evaluate(session, "document.querySelector('[data-speed=\\\"1.5\\\"]').click()");
    assert.equal(await evaluate(session, "document.querySelector('#playerStage video').playbackRate"), 1.5);
    assert.deepEqual(errors, [], "no browser runtime errors");

    const shot = await rpc("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, session);
    fs.writeFileSync(preview, Buffer.from(shot.data, "base64"));
    console.log("PASS: mobile fit, playlist parsing, quality insight, API-key onboarding, creator/channel uploads, queue playback, direct-media controls.");
    console.log("Preview: " + preview);
  } finally {
    try {
      if (socket && socket.readyState === 1) await rpc("Browser.close");
    } catch {}
    if (socket) socket.close();
    browser.kill();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
