(() => {
  "use strict";

  const STORAGE_KEY = "add-now-queue-v1";
  const SHIELD_KEY = "add-now-shield-v1";
  const MOOD_KEY = "add-now-mood-v1";
  const MAX_QUEUE = 24;

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const elements = {
    form: $("#addForm"),
    input: $("#mediaUrl"),
    clearInput: $("#clearButton"),
    message: $("#formMessage"),
    shield: $("#shieldToggle"),
    stage: $("#playerStage"),
    empty: $("#emptyPlayer"),
    meta: $("#playerMeta"),
    mediaTitle: $("#mediaTitle"),
    sourceBadge: $("#sourceBadge"),
    queueList: $("#queueList"),
    queueEmpty: $("#queueEmpty"),
    queueCount: $("#queueCount"),
    clearQueue: $("#clearQueueButton"),
    share: $("#shareButton"),
    install: $("#installButton"),
    mobileInstall: $("#mobileInstallButton"),
    about: $("#aboutDialog"),
    aboutButton: $("#aboutButton"),
    mobileAbout: $("#mobileAboutButton"),
    dialogClose: $("#dialogClose"),
    dialogAction: $("#dialogAction"),
    theme: $("#themeButton")
  };

  let queue = readQueue();
  let activeId = null;
  let installPrompt = null;
  let messageTimer = null;

  function safeStorageGet(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Private browsing can reject storage. */ }
  }

  function readQueue() {
    try {
      const saved = JSON.parse(safeStorageGet(STORAGE_KEY, "[]"));
      return Array.isArray(saved) ? saved.filter(validSavedItem).slice(0, MAX_QUEUE) : [];
    } catch {
      return [];
    }
  }

  function validSavedItem(item) {
    return item && typeof item.id === "string" && typeof item.url === "string" && typeof item.type === "string";
  }

  function saveQueue() {
    safeStorageSet(STORAGE_KEY, JSON.stringify(queue));
  }

  function normalizeUrl(raw) {
    const candidate = raw.trim();
    if (!candidate) throw new Error("Paste a media link to get started.");
    const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const url = new URL(withProtocol);
    if (!/^https?:$/.test(url.protocol)) throw new Error("Only secure web links are supported.");
    return url;
  }

  function youtubeId(url) {
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/);
      return match?.[1] || null;
    }
    return null;
  }

  function vimeoId(url) {
    if (!/(^|\.)vimeo\.com$/i.test(url.hostname)) return null;
    return url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1] || null;
  }

  function mediaName(url, source, key = "") {
    const sourceNames = {
      youtube: "YouTube video",
      vimeo: "Vimeo video",
      spotify: "Spotify media",
      soundcloud: "SoundCloud audio",
      audio: "Audio track",
      video: "Direct video"
    };
    const file = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    if (file && /\.[a-z0-9]{2,5}$/i.test(file)) {
      return file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 80);
    }
    return `${sourceNames[source] || "Media"}${key ? ` · ${key.slice(0, 8)}` : ""}`;
  }

  function parseMedia(raw) {
    const url = normalizeUrl(raw);
    const yt = youtubeId(url);
    if (yt && /^[\w-]{6,}$/.test(yt)) return makeItem("youtube", url, yt);

    const vim = vimeoId(url);
    if (vim) return makeItem("vimeo", url, vim);

    if (url.hostname === "open.spotify.com") {
      const spotifyPath = url.pathname.match(/^\/(track|episode|playlist|album|show)\/([a-zA-Z0-9]+)/);
      if (spotifyPath) return makeItem("spotify", url, `${spotifyPath[1]}/${spotifyPath[2]}`);
    }

    if (/(^|\.)soundcloud\.com$/i.test(url.hostname)) return makeItem("soundcloud", url, url.href);

    const extension = url.pathname.split(".").pop()?.toLowerCase();
    const audioExtensions = new Set(["mp3", "m4a", "aac", "ogg", "oga", "wav", "flac", "opus"]);
    const videoExtensions = new Set(["mp4", "webm", "ogv", "mov", "m4v", "m3u8"]);
    if (audioExtensions.has(extension)) return makeItem("audio", url);
    if (videoExtensions.has(extension)) return makeItem("video", url);

    throw new Error("That link is not recognized. Try YouTube, Vimeo, Spotify, SoundCloud, or a direct media file.");
  }

  function makeItem(type, url, key = "") {
    return {
      id: self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      key,
      url: url.href,
      title: mediaName(url, type, key),
      addedAt: Date.now()
    };
  }

  function sourceLabel(type) {
    return ({ youtube: "YOUTUBE", vimeo: "VIMEO", spotify: "SPOTIFY", soundcloud: "SOUNDCLOUD", audio: "AUDIO", video: "DIRECT VIDEO" })[type] || "MEDIA";
  }

  function showMessage(text, success = false) {
    clearTimeout(messageTimer);
    elements.message.textContent = text;
    elements.message.classList.toggle("success", success);
    if (text) messageTimer = setTimeout(() => { elements.message.textContent = ""; }, 5000);
  }

  function addMedia(raw, options = {}) {
    try {
      const item = parseMedia(raw);
      const duplicate = queue.find((queued) => queued.url === item.url);
      if (duplicate) {
        playItem(duplicate.id);
        showMessage("Already in your queue — playing it now.", true);
        return;
      }
      queue.unshift(item);
      queue = queue.slice(0, MAX_QUEUE);
      saveQueue();
      renderQueue();
      playItem(item.id);
      elements.input.value = "";
      elements.clearInput.hidden = true;
      showMessage(`Added ${sourceLabel(item.type).toLowerCase()} to your queue.`, true);
      if (options.scroll !== false) $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showMessage(error.message || "That link could not be added.");
      elements.input.focus();
    }
  }

  function embedUrl(item) {
    const shield = elements.shield.checked;
    switch (item.type) {
      case "youtube": {
        const host = shield ? "https://www.youtube-nocookie.com" : "https://www.youtube.com";
        return `${host}/embed/${encodeURIComponent(item.key)}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
      }
      case "vimeo": return `https://player.vimeo.com/video/${encodeURIComponent(item.key)}?autoplay=1&dnt=${shield ? 1 : 0}`;
      case "spotify": return `https://open.spotify.com/embed/${item.key}?utm_source=generator&theme=0`;
      case "soundcloud": return `https://w.soundcloud.com/player/?url=${encodeURIComponent(item.url)}&color=%23d9ff4f&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false`;
      default: return item.url;
    }
  }

  function buildPlayer(item) {
    elements.stage.replaceChildren();
    elements.stage.className = "player-stage";

    if (item.type === "video" || item.type === "audio") {
      const media = document.createElement(item.type);
      media.src = item.url;
      media.controls = true;
      media.autoplay = true;
      media.playsInline = true;
      media.preload = "metadata";
      media.setAttribute("controlsList", "nodownload");
      if (item.type === "audio") {
        elements.stage.classList.add("audio-stage");
        const art = document.createElement("div");
        art.className = "audio-art";
        elements.stage.append(art);
      }
      elements.stage.append(media);
      media.addEventListener("error", () => showMessage("The source refused playback or does not allow cross-site loading."), { once: true });
      return;
    }

    const frame = document.createElement("iframe");
    frame.src = embedUrl(item);
    frame.title = item.title;
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.loading = "eager";
    frame.referrerPolicy = elements.shield.checked ? "strict-origin-when-cross-origin" : "origin-when-cross-origin";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups");
    elements.stage.append(frame);
  }

  function playItem(id) {
    const item = queue.find((entry) => entry.id === id);
    if (!item) return;
    activeId = id;
    buildPlayer(item);
    elements.empty.hidden = true;
    elements.stage.hidden = false;
    elements.meta.hidden = false;
    elements.mediaTitle.textContent = item.title;
    elements.sourceBadge.textContent = sourceLabel(item.type);
    renderQueue();
  }

  function renderQueue() {
    elements.queueList.replaceChildren();
    elements.queueEmpty.hidden = queue.length > 0;
    elements.queueCount.textContent = `${queue.length} ${queue.length === 1 ? "item" : "items"}`;

    queue.forEach((item) => {
      const li = document.createElement("li");
      li.className = `queue-item${item.id === activeId ? " active" : ""}`;
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", `Play ${item.title}`);

      const play = document.createElement("span");
      play.className = "queue-play";
      play.textContent = item.id === activeId ? "Ⅱ" : "▶";

      const copy = document.createElement("span");
      copy.className = "queue-copy";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const source = document.createElement("small");
      source.textContent = sourceLabel(item.type);
      copy.append(title, source);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "queue-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${item.title}`);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeItem(item.id);
      });

      li.append(play, copy, remove);
      li.addEventListener("click", () => playItem(item.id));
      li.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); playItem(item.id); }
      });
      elements.queueList.append(li);
    });
  }

  function removeItem(id) {
    const wasActive = activeId === id;
    queue = queue.filter((item) => item.id !== id);
    saveQueue();
    if (wasActive) {
      activeId = null;
      elements.stage.replaceChildren();
      elements.stage.hidden = true;
      elements.meta.hidden = true;
      elements.empty.hidden = false;
      if (queue[0]) playItem(queue[0].id);
    }
    renderQueue();
  }

  function clearQueue() {
    queue = [];
    activeId = null;
    saveQueue();
    elements.stage.replaceChildren();
    elements.stage.hidden = true;
    elements.meta.hidden = true;
    elements.empty.hidden = false;
    renderQueue();
    showMessage("Queue cleared.", true);
  }

  async function installApp() {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      elements.install.hidden = true;
      return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showMessage(isIOS ? "On iPhone: tap Share, then ‘Add to Home Screen’." : "Use your browser menu and choose ‘Install app’.", true);
  }

  async function shareCurrent() {
    const item = queue.find((entry) => entry.id === activeId);
    if (!item) return;
    try {
      if (navigator.share) await navigator.share({ title: item.title, text: "Watch with ADD NOW", url: item.url });
      else {
        await navigator.clipboard.writeText(item.url);
        showMessage("Link copied.", true);
      }
    } catch (error) {
      if (error.name !== "AbortError") showMessage("Could not share this link.");
    }
  }

  elements.form.addEventListener("submit", (event) => { event.preventDefault(); addMedia(elements.input.value); });
  elements.input.addEventListener("input", () => { elements.clearInput.hidden = !elements.input.value; });
  elements.clearInput.addEventListener("click", () => { elements.input.value = ""; elements.clearInput.hidden = true; elements.input.focus(); });
  elements.clearQueue.addEventListener("click", clearQueue);
  elements.share.addEventListener("click", shareCurrent);
  elements.shield.addEventListener("change", () => {
    safeStorageSet(SHIELD_KEY, String(elements.shield.checked));
    if (activeId) playItem(activeId);
    showMessage(elements.shield.checked ? "Privacy-enhanced players enabled." : "Standard player mode enabled.", true);
  });
  elements.theme.addEventListener("click", () => {
    document.body.classList.toggle("soft-mode");
    safeStorageSet(MOOD_KEY, document.body.classList.contains("soft-mode") ? "soft" : "lime");
  });
  document.querySelectorAll("[data-demo]").forEach((button) => button.addEventListener("click", () => addMedia(button.dataset.demo)));

  const openAbout = () => elements.about.showModal();
  const closeAbout = () => elements.about.close();
  elements.aboutButton.addEventListener("click", openAbout);
  elements.mobileAbout.addEventListener("click", openAbout);
  elements.dialogClose.addEventListener("click", closeAbout);
  elements.dialogAction.addEventListener("click", closeAbout);
  elements.about.addEventListener("click", (event) => {
    if (event.target === elements.about) closeAbout();
  });
  elements.install.addEventListener("click", installApp);
  elements.mobileInstall.addEventListener("click", installApp);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    elements.install.hidden = false;
  });
  window.addEventListener("appinstalled", () => { elements.install.hidden = true; showMessage("ADD NOW is installed.", true); });
  window.addEventListener("scroll", () => $(".topbar").classList.toggle("scrolled", window.scrollY > 8), { passive: true });

  elements.shield.checked = safeStorageGet(SHIELD_KEY, "true") !== "false";
  document.body.classList.toggle("soft-mode", safeStorageGet(MOOD_KEY, "lime") === "soft");
  renderQueue();

  const sharedUrl = new URL(location.href).searchParams.get("url") || new URL(location.href).searchParams.get("text");
  if (sharedUrl) addMedia(sharedUrl, { scroll: false });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
})();
