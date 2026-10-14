(() => {
  const MAX_MS = (99 * 3600 + 59 * 60 + 59) * 1000;
  const DEFAULT_DURATION = "5m";
  const DEFAULT_PRESETS = "1m,3m,5m,10m,25m";

  const params = new URLSearchParams(location.search);
  const STORAGE_KEY = `embedded-timer:${location.pathname}${location.search}`;

  const timerEl = document.getElementById("timer");
  const labelEl = document.getElementById("label");
  const displayEl = document.getElementById("display");
  const progressEl = document.getElementById("progress");
  const presetsEl = document.getElementById("presets");
  const toggleBtn = document.getElementById("toggle");
  const resetBtn = document.getElementById("reset");
  const adjustBtns = [...document.querySelectorAll(".adjust")];

  const soundEnabled = params.get("sound") !== "0";

  // "25" (分)、"1:30"、"1:00:00"、"1h30m"、"90s" を受け付ける
  function parseDuration(text) {
    const s = String(text).trim().toLowerCase();
    if (!s) return null;
    let ms = null;
    if (/^\d+(\.\d+)?$/.test(s)) {
      ms = parseFloat(s) * 60 * 1000;
    } else if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
      const parts = s.split(":").map(Number);
      if (parts.slice(1).some((n) => n >= 60)) return null;
      const [h, m, sec] = parts.length === 3 ? parts : [0, ...parts];
      ms = ((h * 60 + m) * 60 + sec) * 1000;
    } else if (/^(\d+(\.\d+)?\s*[hms]\s*)+$/.test(s)) {
      const unit = { h: 3600, m: 60, s: 1 };
      ms = 0;
      for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/g)) {
        ms += parseFloat(n) * unit[u] * 1000;
      }
    }
    if (ms === null || ms <= 0) return null;
    return Math.min(Math.round(ms / 1000) * 1000, MAX_MS);
  }

  function format(ms) {
    const total = Math.ceil(Math.max(ms, 0) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function formatPresetLabel(ms) {
    const total = ms / 1000;
    if (total % 3600 === 0) return `${total / 3600}時間`;
    if (total % 60 === 0) return `${total / 60}分`;
    if (total < 60) return `${total}秒`;
    return format(ms);
  }

  const theme = params.get("theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }

  const label = params.get("label");
  if (label) {
    labelEl.textContent = label;
    labelEl.hidden = false;
    document.title = label;
  }
  const baseTitle = document.title;

  const state = {
    status: "idle", // idle | running | paused | done
    durationMs: parseDuration(params.get("t") ?? DEFAULT_DURATION) ?? parseDuration(DEFAULT_DURATION),
    remainingMs: 0,
    endAt: 0,
  };
  state.remainingMs = state.durationMs;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 保存できない環境 (ストレージがブロックされた iframe など) では、再読み込みで状態が戻らないだけ
    }
  }

  function restore() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return;
    }
    if (!saved || !["idle", "running", "paused", "done"].includes(saved.status)) return;
    if (![saved.durationMs, saved.remainingMs, saved.endAt].every(Number.isFinite)) return;
    if (saved.durationMs <= 0) return;
    Object.assign(state, {
      status: saved.status,
      durationMs: saved.durationMs,
      remainingMs: saved.remainingMs,
      endAt: saved.endAt,
    });
    // 閉じている間に時間が過ぎていた場合は、音を鳴らさずに終了状態で表示する
    if (state.status === "running" && state.endAt <= Date.now()) {
      state.status = "done";
      state.remainingMs = 0;
    }
  }

  function currentRemaining() {
    return state.status === "running" ? state.endAt - Date.now() : state.remainingMs;
  }

  function render() {
    const remaining = currentRemaining();
    timerEl.dataset.state = state.status;
    if (document.activeElement !== displayEl) {
      displayEl.value = format(remaining);
    }
    displayEl.readOnly = state.status === "running" || state.status === "paused";
    progressEl.style.transform = `scaleX(${Math.min(Math.max(remaining, 0) / state.durationMs, 1)})`;
    for (const btn of adjustBtns) {
      btn.disabled = adjustedMs(Number(btn.dataset.deltaMin) * 60 * 1000) === null;
    }
    toggleBtn.textContent = {
      idle: "開始",
      running: "一時停止",
      paused: "再開",
      done: "もう一度",
    }[state.status];
    document.title =
      state.status === "running" || state.status === "paused"
        ? `${format(remaining)} - ${baseTitle}`
        : state.status === "done"
          ? `終了 - ${baseTitle}`
          : baseTitle;
  }

  let audioCtx = null;

  // ブラウザは操作のきっかけ無しに音を鳴らせないため、開始ボタンの押下時に準備しておく
  function prepareAudio() {
    if (!soundEnabled) return;
    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      audioCtx = null;
    }
  }

  function playAlarm() {
    if (!audioCtx) return;
    const start = audioCtx.currentTime + 0.05;
    for (let i = 0; i < 9; i++) {
      const t = start + Math.floor(i / 3) * 1.0 + (i % 3) * 0.18;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }

  function start() {
    prepareAudio();
    if (state.status === "done") state.remainingMs = state.durationMs;
    state.endAt = Date.now() + state.remainingMs;
    state.status = "running";
    save();
    render();
  }

  function pause() {
    state.remainingMs = Math.max(state.endAt - Date.now(), 0);
    state.status = "paused";
    save();
    render();
  }

  function reset() {
    state.status = "idle";
    state.remainingMs = state.durationMs;
    state.endAt = 0;
    save();
    render();
  }

  function finish() {
    state.status = "done";
    state.remainingMs = 0;
    save();
    render();
    playAlarm();
  }

  function setDuration(ms) {
    state.durationMs = ms;
    reset();
  }

  // 0 以下や上限を超える操作はボタンを無効にして防ぐ
  function adjustedMs(deltaMs) {
    const next = currentRemaining() + deltaMs;
    return next >= 1000 && next <= MAX_MS ? next : null;
  }

  function adjust(deltaMs) {
    const next = adjustedMs(deltaMs);
    if (next === null) return;
    if (state.status === "idle" || state.status === "done") {
      setDuration(next);
      return;
    }
    if (state.status === "running") state.endAt += deltaMs;
    else state.remainingMs = next;
    state.durationMs = Math.min(Math.max(state.durationMs + deltaMs, next), MAX_MS);
    save();
    render();
  }

  function toggle() {
    if (state.status === "running") pause();
    else start();
  }

  function tick() {
    if (state.status === "running" && state.endAt <= Date.now()) {
      finish();
    } else if (state.status === "running") {
      render();
    }
  }

  const presets = (params.get("presets") ?? DEFAULT_PRESETS)
    .split(",")
    .map(parseDuration)
    .filter((ms) => ms !== null);
  for (const ms of presets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset";
    btn.textContent = formatPresetLabel(ms);
    btn.addEventListener("click", () => setDuration(ms));
    presetsEl.appendChild(btn);
  }
  presetsEl.hidden = presets.length === 0;

  let valueOnFocus = "";

  function commitEdit() {
    if (displayEl.readOnly || displayEl.value === valueOnFocus) {
      displayEl.value = format(currentRemaining());
      return;
    }
    const ms = parseDuration(displayEl.value);
    if (ms === null) {
      displayEl.classList.remove("invalid");
      void displayEl.offsetWidth;
      displayEl.classList.add("invalid");
    } else if (ms !== state.durationMs || state.status !== "idle") {
      setDuration(ms);
    }
    displayEl.value = format(currentRemaining());
  }

  displayEl.addEventListener("focus", () => {
    valueOnFocus = displayEl.value;
    if (!displayEl.readOnly) displayEl.select();
  });
  displayEl.addEventListener("blur", commitEdit);
  displayEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      displayEl.blur();
    } else if (e.key === "Escape") {
      displayEl.value = format(currentRemaining());
      displayEl.blur();
    }
  });
  displayEl.addEventListener("animationend", () => displayEl.classList.remove("invalid"));

  toggleBtn.addEventListener("click", toggle);
  resetBtn.addEventListener("click", reset);
  for (const btn of adjustBtns) {
    btn.addEventListener("click", () => adjust(Number(btn.dataset.deltaMin) * 60 * 1000));
  }

  function toDurationParam(ms) {
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join("");
  }

  function buildEmbedUrl() {
    const query = new URLSearchParams(params);
    query.set("t", toDurationParam(state.durationMs));
    return `${location.origin}${location.pathname}?${query.toString().replaceAll("%2C", ",")}`;
  }

  // Notion などの iframe 内では Clipboard API が許可されていないことがあるため、execCommand でも試す
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.readOnly = true;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      textarea.remove();
      return copied;
    }
  }

  const toastEl = document.getElementById("toast");
  const toastMessageEl = document.getElementById("toast-message");
  const toastUrlEl = document.getElementById("toast-url");
  const copyLinkBtn = document.getElementById("copy-link");
  let toastTimer = 0;

  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
  }

  function showToast(message, url) {
    clearTimeout(toastTimer);
    toastMessageEl.textContent = message;
    toastUrlEl.hidden = !url;
    toastEl.hidden = false;
    if (url) {
      toastUrlEl.value = url;
      toastUrlEl.focus();
      toastUrlEl.select();
    } else {
      toastTimer = setTimeout(hideToast, 2000);
    }
  }

  copyLinkBtn.addEventListener("click", async () => {
    const url = buildEmbedUrl();
    if (await copyText(url)) {
      showToast("リンクをコピーしました");
    } else {
      showToast("コピーできませんでした。下のリンクを選択してコピーしてください", url);
    }
  });
  toastUrlEl.addEventListener("blur", hideToast);

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLButtonElement) return;
    if (e.target instanceof HTMLInputElement && !(e.target === displayEl && displayEl.readOnly)) return;
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "r" || e.key === "R") {
      reset();
    }
  });

  // 同じ URL を別タブや同じページ内の別ブロックで開いている場合に表示を揃える
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    restore();
    render();
  });

  restore();
  render();
  setInterval(tick, 200);
  document.addEventListener("visibilitychange", tick);
})();
