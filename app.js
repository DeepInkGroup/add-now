(() => {
  "use strict";

  const STORAGE_KEY = "add-now-queue-v1";
  const SHIELD_KEY = "add-now-shield-v1";
  const MOOD_KEY = "add-now-mood-v1";
  const API_KEY_STORAGE = "add-now-youtube-key-v1";
  const MAX_QUEUE = 24;
  const API_ROOT = "https://www.googleapis.com/youtube/v3";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const elements = {
    form: $("#addForm"),
    input: $("#mediaUrl"),
    clearInput: $("#clearButton"),
    message: $("#formMessage"),
    shield: $("#shieldToggle"),
    linkInsight: $("#linkInsight"),
    linkMode: $("#linkModeButton"),
    creatorMode: $("#creatorModeButton"),
    creatorForm: $("#creatorForm"),
    creatorQuery: $("#creatorQuery"),
    creatorResults: $("#creatorResults"),
    creatorStatus: $("#creatorStatus"),
    channelGrid: $("#channelGrid"),
    selectedChannel: $("#selectedChannel"),
    channelAvatar: $("#channelAvatar"),
    channelTitle: $("#channelTitle"),
    channelStats: $("#channelStats"),
    channelLink: $("#channelLink"),
    videoResults: $("#videoResults"),
    loadMore: $("#loadMoreButton"),
    closeCreatorResults: $("#closeCreatorResults"),
    mobileDiscover: $("#mobileDiscover"),
    stage: $("#playerStage"),
    empty: $("#emptyPlayer"),
    meta: $("#playerMeta"),
    mediaTitle: $("#mediaTitle"),
    sourceBadge: $("#sourceBadge"),
    qualityBadge: $("#qualityBadge"),
    directTools: $("#directTools"),
    pip: $("#pipButton"),
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
    theme: $("#themeButton"),
    apiSettings: $("#apiSettingsButton"),
    apiDialog: $("#apiDialog"),
    apiDialogClose: $("#apiDialogClose"),
    apiKey: $("#youtubeApiKey"),
    saveApiKey: $("#saveApiKey"),
    removeApiKey: $("#removeApiKey")
  };

  let queue = readQueue();
  let activeId = null;
  let activeMediaElement = null;
  let installPrompt = null;
  let messageTimer = null;
  let pendingCreatorQuery = "";
  let creatorState = { uploadsPlaylist: "", nextPageToken: "", loading: false };

  function safeStorageGet(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Storage can be unavailable in private mode. */ }
  }

  function safeStorageRemove(key) {
    try { localStorage.removeItem(key); } catch { /* Nothing else to do. */ }
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
    const candidate = String(raw || "").trim();
    if (!candidate) throw new Error("Paste a media link to get started.");
    const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : "https://" + candidate;
    const url = new URL(withProtocol);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("Use an HTTPS media link for safer playback.");
    }
    return url;
  }

  function youtubeId(url) {
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/);
      return match ? match[1] : null;
    }
    return null;
  }

  function youtubePlaylistId(url) {
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
    if (url.pathname !== "/playlist") return null;
    const list = url.searchParams.get("list");
    return list && /^[\w-]{10,}$/.test(list) ? list : null;
  }

  function vimeoId(url) {
    if (!/(^|\.)vimeo\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/\/(?:video\/)?(\d+)/);
    return match ? match[1] : null;
  }

  function mediaName(url, source, key) {
    const sourceNames = {
      youtube: "YouTube video",
      youtube_playlist: "YouTube playlist",
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
    return (sourceNames[source] || "Media") + (key ? " · " + key.slice(0, 8) : "");
  }

  function makeItem(type, url, key, details) {
    const parsedUrl = url instanceof URL ? url : normalizeUrl(url);
    const extra = details || {};
    return {
      id: self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2),
      type,
      key: key || "",
      url: parsedUrl.href,
      title: extra.title || mediaName(parsedUrl, type, key || ""),
      thumbnail: extra.thumbnail || "",
      creator: extra.creator || "",
      quality: extra.quality || "",
      addedAt: Date.now()
    };
  }

  function parseMedia(raw) {
    const url = normalizeUrl(raw);
    const playlist = youtubePlaylistId(url);
    if (playlist) return makeItem("youtube_playlist", url, playlist);

    const yt = youtubeId(url);
    if (yt && /^[\w-]{6,}$/.test(yt)) return makeItem("youtube", url, yt);

    const vim = vimeoId(url);
    if (vim) return makeItem("vimeo", url, vim);

    if (url.hostname === "open.spotify.com") {
      const spotifyPath = url.pathname.match(/^\/(track|episode|playlist|album|show)\/([a-zA-Z0-9]+)/);
      if (spotifyPath) return makeItem("spotify", url, spotifyPath[1] + "/" + spotifyPath[2]);
    }

    if (/(^|\.)soundcloud\.com$/i.test(url.hostname)) return makeItem("soundcloud", url, url.href);

    const extension = (url.pathname.split(".").pop() || "").toLowerCase();
    const audioExtensions = new Set(["mp3", "m4a", "aac", "ogg", "oga", "wav", "flac", "opus"]);
    const videoExtensions = new Set(["mp4", "webm", "ogv", "mov", "m4v", "m3u8"]);
    if (audioExtensions.has(extension)) return makeItem("audio", url);
    if (videoExtensions.has(extension)) return makeItem("video", url);

    throw new Error("Try YouTube, a YouTube playlist, Vimeo, Spotify, SoundCloud, or a direct media file.");
  }

  function sourceLabel(type) {
    return ({
      youtube: "YOUTUBE",
      youtube_playlist: "YT PLAYLIST",
      vimeo: "VIMEO",
      spotify: "SPOTIFY",
      soundcloud: "SOUNDCLOUD",
      audio: "AUDIO",
      video: "DIRECT VIDEO"
    })[type] || "MEDIA";
  }

  function qualityLabel(item) {
    if (item.quality) return item.quality;
    if (item.type === "youtube" || item.type === "youtube_playlist") return "ADAPTIVE HD";
    if (item.type === "vimeo") return "ADAPTIVE";
    if (item.type === "spotify") return "STREAM AUDIO";
    if (item.type === "soundcloud") return "STREAM AUDIO";
    const extension = new URL(item.url).pathname.split(".").pop().toUpperCase();
    if (extension === "M3U8") return "ADAPTIVE HLS";
    if (extension === "MP4" || extension === "M4V") return "HIGH COMPAT.";
    if (extension === "WEBM") return "MODERN VIDEO";
    return extension || "SOURCE QUALITY";
  }

  function showMessage(text, success) {
    clearTimeout(messageTimer);
    elements.message.textContent = text;
    elements.message.classList.toggle("success", Boolean(success));
    if (text) messageTimer = setTimeout(() => { elements.message.textContent = ""; }, 5000);
  }

  function updateLinkInsight() {
    if (!elements.input.value.trim()) {
      elements.linkInsight.hidden = true;
      return;
    }
    try {
      const item = parseMedia(elements.input.value);
      elements.linkInsight.textContent = sourceLabel(item.type) + " · " + qualityLabel(item) + " · HTTPS";
      elements.linkInsight.hidden = false;
    } catch {
      elements.linkInsight.hidden = true;
    }
  }

  function addItem(item, options) {
    const settings = options || {};
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
    elements.linkInsight.hidden = true;
    showMessage("Added " + sourceLabel(item.type).toLowerCase() + " to your queue.", true);
    if (settings.scroll !== false) $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addMedia(raw, options) {
    try {
      addItem(parseMedia(raw), options);
    } catch (error) {
      showMessage(error.message || "That link could not be added.");
      elements.input.focus();
    }
  }

  function embedUrl(item) {
    const shield = elements.shield.checked;
    if (item.type === "youtube" || item.type === "youtube_playlist") {
      const host = shield ? "https://www.youtube-nocookie.com" : "https://www.youtube.com";
      const path = item.type === "youtube_playlist" ? "/embed/videoseries?list=" + encodeURIComponent(item.key) : "/embed/" + encodeURIComponent(item.key) + "?";
      const joiner = item.type === "youtube_playlist" ? "&" : "";
      return host + path + joiner + "autoplay=1&playsinline=1&rel=0&modestbranding=1";
    }
    if (item.type === "vimeo") return "https://player.vimeo.com/video/" + encodeURIComponent(item.key) + "?autoplay=1&dnt=" + (shield ? 1 : 0);
    if (item.type === "spotify") return "https://open.spotify.com/embed/" + item.key + "?utm_source=generator&theme=0";
    if (item.type === "soundcloud") {
      return "https://w.soundcloud.com/player/?url=" + encodeURIComponent(item.url) + "&color=%23d9ff4f&auto_play=true&hide_related=true&show_comments=false&show_reposts=false";
    }
    return item.url;
  }

  function measuredVideoQuality(video) {
    const height = video.videoHeight;
    if (!height) return "";
    if (height >= 2160) return height + "P · 4K";
    if (height >= 1440) return height + "P · QHD";
    if (height >= 1080) return height + "P · FULL HD";
    if (height >= 720) return height + "P · HD";
    return height + "P · SD";
  }

  function buildPlayer(item) {
    elements.stage.replaceChildren();
    elements.stage.className = "player-stage";
    elements.directTools.hidden = item.type !== "video" && item.type !== "audio";
    elements.pip.hidden = item.type !== "video" || !document.pictureInPictureEnabled;
    activeMediaElement = null;

    if (item.type === "video" || item.type === "audio") {
      const media = document.createElement(item.type);
      activeMediaElement = media;
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
      media.addEventListener("loadedmetadata", () => {
        if (item.type === "video") {
          const measured = measuredVideoQuality(media);
          if (measured) {
            item.quality = measured;
            elements.qualityBadge.textContent = measured;
            saveQueue();
            renderQueue();
          }
        }
      }, { once: true });
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
    elements.qualityBadge.textContent = qualityLabel(item);
    renderQueue();
  }

  function renderQueue() {
    elements.queueList.replaceChildren();
    elements.queueEmpty.hidden = queue.length > 0;
    elements.queueCount.textContent = queue.length + " " + (queue.length === 1 ? "item" : "items");

    queue.forEach((item) => {
      const li = document.createElement("li");
      li.className = "queue-item" + (item.id === activeId ? " active" : "");
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", "Play " + item.title);

      const play = document.createElement("span");
      play.className = "queue-play";
      play.textContent = item.id === activeId ? "Ⅱ" : "▶";

      const copy = document.createElement("span");
      copy.className = "queue-copy";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const source = document.createElement("small");
      source.textContent = sourceLabel(item.type) + " · " + qualityLabel(item);
      copy.append(title, source);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "queue-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + item.title);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeItem(item.id);
      });

      li.append(play, copy, remove);
      li.addEventListener("click", () => playItem(item.id));
      li.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          playItem(item.id);
        }
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
      activeMediaElement = null;
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
    activeMediaElement = null;
    saveQueue();
    elements.stage.replaceChildren();
    elements.stage.hidden = true;
    elements.meta.hidden = true;
    elements.empty.hidden = false;
    renderQueue();
    showMessage("Queue cleared.", true);
  }

  function setInputMode(mode, focus) {
    const creator = mode === "creator";
    elements.form.hidden = creator;
    elements.creatorForm.hidden = !creator;
    elements.linkMode.classList.toggle("active", !creator);
    elements.creatorMode.classList.toggle("active", creator);
    elements.linkMode.setAttribute("aria-selected", String(!creator));
    elements.creatorMode.setAttribute("aria-selected", String(creator));
    elements.linkInsight.hidden = creator || !elements.input.value;
    if (focus !== false) (creator ? elements.creatorQuery : elements.input).focus();
  }

  function apiKey() {
    return safeStorageGet(API_KEY_STORAGE, "").trim();
  }

  function openApiDialog() {
    elements.apiKey.value = apiKey();
    elements.apiDialog.showModal();
    setTimeout(() => elements.apiKey.focus(), 50);
  }

  async function youtubeApi(path, params) {
    const key = apiKey();
    if (!key) throw new Error("Add a YouTube Data API key to use creator search.");
    const query = new URLSearchParams(params);
    query.set("key", key);
    const response = await fetch(API_ROOT + "/" + path + "?" + query.toString(), {
      headers: { Accept: "application/json" },
      referrerPolicy: "strict-origin-when-cross-origin"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = data && data.error && data.error.errors && data.error.errors[0] ? data.error.errors[0].reason : "";
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") throw new Error("This API key has reached its YouTube search quota.");
      if (reason === "keyInvalid" || response.status === 400) throw new Error("That API key is not valid for YouTube Data API v3.");
      if (response.status === 403) throw new Error("YouTube rejected this key. Check its API and referrer restrictions.");
      throw new Error((data && data.error && data.error.message) || "YouTube search is unavailable right now.");
    }
    return data;
  }

  function setCreatorStatus(text, state) {
    elements.creatorStatus.textContent = text;
    elements.creatorStatus.className = "creator-status" + (state ? " " + state : "");
  }

  function imageFromSnippet(snippet) {
    const thumbs = snippet && snippet.thumbnails;
    return thumbs && (thumbs.high || thumbs.medium || thumbs.default) ? (thumbs.high || thumbs.medium || thumbs.default).url : "";
  }

  async function searchCreators(query) {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      showMessage("Type a creator name or @handle.");
      elements.creatorQuery.focus();
      return;
    }
    if (!apiKey()) {
      pendingCreatorQuery = cleanQuery;
      openApiDialog();
      return;
    }

    elements.creatorResults.hidden = false;
    elements.selectedChannel.hidden = true;
    elements.channelGrid.hidden = false;
    elements.channelGrid.replaceChildren();
    setCreatorStatus("Searching YouTube for channels…", "loading");
    elements.creatorResults.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const data = await youtubeApi("search", {
        part: "snippet",
        type: "channel",
        maxResults: "6",
        q: cleanQuery
      });
      const channels = data.items || [];
      if (!channels.length) {
        setCreatorStatus("No channels matched that name. Try a handle or a more exact spelling.", "error");
        return;
      }
      setCreatorStatus("Pick a channel to browse its latest public uploads.");
      channels.forEach(renderChannelCard);
    } catch (error) {
      setCreatorStatus(error.message, "error");
    }
  }

  function renderChannelCard(channel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "channel-card";
    const image = document.createElement("img");
    image.src = imageFromSnippet(channel.snippet);
    image.alt = "";
    image.loading = "lazy";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = channel.snippet.title;
    const detail = document.createElement("small");
    detail.textContent = channel.snippet.customUrl || "YouTube channel";
    copy.append(title, detail);
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    button.append(image, copy, arrow);
    button.addEventListener("click", () => loadCreator(channel.id.channelId));
    elements.channelGrid.append(button);
  }

  function compactNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(number) : "—";
  }

  async function loadCreator(channelId) {
    setCreatorStatus("Loading channel details and uploads…", "loading");
    try {
      const data = await youtubeApi("channels", {
        part: "snippet,contentDetails,statistics",
        id: channelId
      });
      const channel = data.items && data.items[0];
      const uploads = channel && channel.contentDetails && channel.contentDetails.relatedPlaylists && channel.contentDetails.relatedPlaylists.uploads;
      if (!channel || !uploads) throw new Error("This channel does not expose a public uploads list.");

      creatorState = { uploadsPlaylist: uploads, nextPageToken: "", loading: false };
      elements.channelGrid.hidden = true;
      elements.selectedChannel.hidden = false;
      elements.videoResults.replaceChildren();
      elements.channelAvatar.src = imageFromSnippet(channel.snippet);
      elements.channelAvatar.alt = channel.snippet.title;
      elements.channelTitle.textContent = channel.snippet.title;
      elements.channelStats.textContent = compactNumber(channel.statistics.subscriberCount) + " subscribers · " + compactNumber(channel.statistics.videoCount) + " public videos";
      elements.channelLink.href = "https://www.youtube.com/channel/" + encodeURIComponent(channel.id);
      setCreatorStatus("Latest uploads from " + channel.snippet.title + ".");
      await loadUploads(false);
    } catch (error) {
      setCreatorStatus(error.message, "error");
    }
  }

  async function loadUploads(append) {
    if (creatorState.loading || !creatorState.uploadsPlaylist) return;
    creatorState.loading = true;
    elements.loadMore.disabled = true;
    elements.loadMore.textContent = "Loading…";
    try {
      const params = {
        part: "snippet,contentDetails",
        playlistId: creatorState.uploadsPlaylist,
        maxResults: "12"
      };
      if (append && creatorState.nextPageToken) params.pageToken = creatorState.nextPageToken;
      const data = await youtubeApi("playlistItems", params);
      (data.items || []).forEach(renderVideoCard);
      creatorState.nextPageToken = data.nextPageToken || "";
      elements.loadMore.hidden = !creatorState.nextPageToken;
    } catch (error) {
      setCreatorStatus(error.message, "error");
    } finally {
      creatorState.loading = false;
      elements.loadMore.disabled = false;
      elements.loadMore.textContent = "Load more videos";
    }
  }

  function renderVideoCard(video) {
    const snippet = video.snippet || {};
    const videoId = video.contentDetails && video.contentDetails.videoId;
    if (!videoId || !snippet.title || snippet.title === "Private video" || snippet.title === "Deleted video") return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "video-card";
    const thumb = document.createElement("span");
    thumb.className = "video-thumb";
    const image = document.createElement("img");
    image.src = imageFromSnippet(snippet);
    image.alt = "";
    image.loading = "lazy";
    const play = document.createElement("span");
    play.className = "video-play";
    play.textContent = "▶";
    thumb.append(image, play);
    const title = document.createElement("strong");
    title.textContent = snippet.title;
    const date = document.createElement("small");
    const published = snippet.publishedAt ? new Date(snippet.publishedAt) : null;
    date.textContent = published && !Number.isNaN(published.getTime()) ? published.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Public upload";
    button.append(thumb, title, date);
    button.addEventListener("click", () => {
      const url = new URL("https://www.youtube.com/watch?v=" + encodeURIComponent(videoId));
      const item = makeItem("youtube", url, videoId, {
        title: snippet.title,
        thumbnail: imageFromSnippet(snippet),
        creator: snippet.videoOwnerChannelTitle || snippet.channelTitle
      });
      addItem(item);
    });
    elements.videoResults.append(button);
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

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    addMedia(elements.input.value);
  });
  elements.input.addEventListener("input", () => {
    elements.clearInput.hidden = !elements.input.value;
    updateLinkInsight();
  });
  elements.clearInput.addEventListener("click", () => {
    elements.input.value = "";
    elements.clearInput.hidden = true;
    elements.linkInsight.hidden = true;
    elements.input.focus();
  });
  elements.linkMode.addEventListener("click", () => setInputMode("link"));
  elements.creatorMode.addEventListener("click", () => setInputMode("creator"));
  elements.creatorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchCreators(elements.creatorQuery.value);
  });
  elements.mobileDiscover.addEventListener("click", (event) => {
    if (elements.creatorResults.hidden) {
      event.preventDefault();
      setInputMode("creator", false);
      $("#heroTitle").scrollIntoView({ behavior: "smooth" });
      setTimeout(() => elements.creatorQuery.focus(), 500);
    }
  });
  elements.closeCreatorResults.addEventListener("click", () => {
    elements.creatorResults.hidden = true;
    setInputMode("creator");
  });
  elements.loadMore.addEventListener("click", () => loadUploads(true));
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
  elements.directTools.querySelectorAll("[data-speed]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!activeMediaElement) return;
      const speed = Number(button.dataset.speed);
      activeMediaElement.playbackRate = speed;
      elements.directTools.querySelectorAll("[data-speed]").forEach((choice) => choice.classList.toggle("active", choice === button));
      showMessage("Playback speed set to " + speed + "×.", true);
    });
  });
  elements.pip.addEventListener("click", async () => {
    if (!activeMediaElement || activeMediaElement.tagName !== "VIDEO") return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await activeMediaElement.requestPictureInPicture();
    } catch {
      showMessage("Picture in picture is not available for this source.");
    }
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

  elements.apiSettings.addEventListener("click", openApiDialog);
  elements.apiDialogClose.addEventListener("click", () => elements.apiDialog.close());
  elements.apiDialog.addEventListener("click", (event) => {
    if (event.target === elements.apiDialog) elements.apiDialog.close();
  });
  elements.saveApiKey.addEventListener("click", () => {
    const key = elements.apiKey.value.trim();
    if (key.length < 20) {
      elements.apiKey.setCustomValidity("Enter a valid YouTube Data API key.");
      elements.apiKey.reportValidity();
      return;
    }
    elements.apiKey.setCustomValidity("");
    safeStorageSet(API_KEY_STORAGE, key);
    elements.apiDialog.close();
    showMessage("YouTube creator search is connected on this device.", true);
    if (pendingCreatorQuery) {
      const query = pendingCreatorQuery;
      pendingCreatorQuery = "";
      searchCreators(query);
    }
  });
  elements.removeApiKey.addEventListener("click", () => {
    safeStorageRemove(API_KEY_STORAGE);
    elements.apiKey.value = "";
    elements.apiDialog.close();
    showMessage("YouTube API key removed from this device.", true);
  });

  elements.install.addEventListener("click", installApp);
  elements.mobileInstall.addEventListener("click", installApp);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    elements.install.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    elements.install.hidden = true;
    showMessage("ADD NOW is installed.", true);
  });
  window.addEventListener("scroll", () => $(".topbar").classList.toggle("scrolled", window.scrollY > 8), { passive: true });

  elements.shield.checked = safeStorageGet(SHIELD_KEY, "true") !== "false";
  document.body.classList.toggle("soft-mode", safeStorageGet(MOOD_KEY, "lime") === "soft");
  renderQueue();

  const sharedParams = new URL(location.href).searchParams;
  const sharedUrl = sharedParams.get("url") || sharedParams.get("text");
  if (sharedUrl) addMedia(sharedUrl, { scroll: false });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
})();
