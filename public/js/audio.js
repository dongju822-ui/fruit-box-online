(() => {
  const App = window.App || (window.App = {});

  const STORAGE_KEY = "fruitbox-audio-settings";
  const DEFAULT_SETTINGS = Object.freeze({
    bgmEnabled: true,
    sfxEnabled: true,
    bgmVolume: 0.4,
    sfxVolume: 0.78
  });
  const SFX_VOLUME_MULTIPLIER = 2.5;
  const SFX_MAX_VOLUME = 0.2;
  const BGM_SRC = "/assets/bgm/3.mp3";
  const SELECT_SOUND_THROTTLE_MS = 40;
  const CLEAR_PREVIEW_THROTTLE_MS = 90;

  const state = {
    audioCtx: null,
    audioUnlocked: false,
    bgmAudio: null,
    unlockHandlersBound: false,
    lastSelectAt: 0,
    lastClearPreviewAt: 0,
    settings: loadSettings()
  };

  function clamp01(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
  }

  function normalizeBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  function createDefaultSettings() {
    return {
      bgmEnabled: DEFAULT_SETTINGS.bgmEnabled,
      sfxEnabled: DEFAULT_SETTINGS.sfxEnabled,
      bgmVolume: DEFAULT_SETTINGS.bgmVolume,
      sfxVolume: DEFAULT_SETTINGS.sfxVolume
    };
  }

  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultSettings();

      const parsed = JSON.parse(raw);
      const legacySfxVolume = clamp01(
        (
          clamp01(parsed?.dragVolume, DEFAULT_SETTINGS.sfxVolume)
          + clamp01(parsed?.clearVolume, DEFAULT_SETTINGS.sfxVolume)
        ) / 2,
        DEFAULT_SETTINGS.sfxVolume
      );

      return {
        bgmEnabled: normalizeBoolean(parsed?.bgmEnabled, true),
        sfxEnabled: normalizeBoolean(parsed?.sfxEnabled, true),
        bgmVolume: clamp01(parsed?.bgmVolume, DEFAULT_SETTINGS.bgmVolume),
        sfxVolume: clamp01(parsed?.sfxVolume, legacySfxVolume)
      };
    } catch (error) {
      return createDefaultSettings();
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch (error) {}
  }

  function createBgmAudio() {
    if (state.bgmAudio) return state.bgmAudio;

    const audio = new Audio(BGM_SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    state.bgmAudio = audio;
    return audio;
  }

  function isPageVisible() {
    return document.visibilityState !== "hidden";
  }

  function bindUnlockHandlers() {
    if (state.unlockHandlersBound) return;
    state.unlockHandlersBound = true;

    const unlock = () => {
      if (!state.audioUnlocked || state.audioCtx?.state === "suspended" || state.bgmAudio?.paused) {
        ensureAudio();
      }
    };

    ["pointerdown", "touchstart", "keydown"].forEach((eventName) => {
      document.addEventListener(eventName, unlock, { passive: true });
    });
  }

  function ensureAudio() {
    bindUnlockHandlers();

    if (!state.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) state.audioCtx = new AudioContextClass();
    }

    if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(() => {});
    }

    state.audioUnlocked = true;
    syncBgmAudio({ attemptPlay: true });
    return state.audioCtx;
  }

  function pauseBgm() {
    if (state.bgmAudio) {
      state.bgmAudio.pause();
    }
  }

  function syncBgmAudio({ attemptPlay = false } = {}) {
    const bgm = createBgmAudio();
    bgm.volume = state.settings.bgmEnabled ? state.settings.bgmVolume : 0;

    if (!state.settings.bgmEnabled || bgm.volume <= 0.0001) {
      bgm.pause();
      return bgm;
    }

    if (!attemptPlay || !state.audioUnlocked || !isPageVisible()) {
      return bgm;
    }

    const playPromise = bgm.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }

    return bgm;
  }

  function startBgm() {
    if (!state.audioUnlocked) return;
    syncBgmAudio({ attemptPlay: true });
  }

  function setSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;

    if (typeof DEFAULT_SETTINGS[key] === "boolean") {
      state.settings[key] = Boolean(value);
    } else {
      state.settings[key] = clamp01(value, DEFAULT_SETTINGS[key]);
    }

    if (key === "bgmEnabled" || key === "bgmVolume") {
      syncBgmAudio({ attemptPlay: true });
    }

    saveSettings();
  }

  function setBgmEnabled(value) {
    setSetting("bgmEnabled", value);
  }

  function setSfxEnabled(value) {
    setSetting("sfxEnabled", value);
  }

  function setBgmVolume(value) {
    setSetting("bgmVolume", value);
  }

  function setSfxVolume(value) {
    setSetting("sfxVolume", value);
  }

  function getSettings() {
    return { ...state.settings };
  }

  function tone({
    frequency = 440,
    endFrequency = null,
    duration = 0.12,
    volume = 0.03,
    type = "triangle",
    multiplier = 1
  } = {}) {
    if (!state.settings.sfxEnabled || state.settings.sfxVolume <= 0.0001) return;

    const ctx = ensureAudio();
    if (!ctx) return;

    const finalVolume = Math.min(volume * multiplier * state.settings.sfxVolume, SFX_MAX_VOLUME);
    if (finalVolume <= 0.0001) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (endFrequency && endFrequency > 0) {
      osc.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, finalVolume), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function playSfxTone(options) {
    tone({
      ...options,
      multiplier: SFX_VOLUME_MULTIPLIER
    });
  }

  function playUiSound() {
    playSfxTone({ frequency: 520, endFrequency: 760, duration: 0.055, volume: 0.022, type: "triangle" });
  }

  function playSelectSound(options = {}) {
    const { bypassThrottle = false } = options;
    const now = performance.now();
    if (!bypassThrottle && now - state.lastSelectAt < SELECT_SOUND_THROTTLE_MS) return;
    if (!bypassThrottle) state.lastSelectAt = now;

    playSfxTone({ frequency: 820, endFrequency: 1080, duration: 0.036, volume: 0.032, type: "triangle" });
  }

  function playSuccessSound() {
    playSfxTone({ frequency: 700, endFrequency: 980, duration: 0.08, volume: 0.062, type: "triangle" });
    window.setTimeout(() => {
      playSfxTone({ frequency: 920, endFrequency: 1320, duration: 0.11, volume: 0.074, type: "triangle" });
    }, 38);
    window.setTimeout(() => {
      playSfxTone({ frequency: 1180, endFrequency: 1680, duration: 0.095, volume: 0.068, type: "triangle" });
    }, 96);
  }

  function playClearPreviewSound(options = {}) {
    const { bypassThrottle = false } = options;
    const now = performance.now();
    if (!bypassThrottle && now - state.lastClearPreviewAt < CLEAR_PREVIEW_THROTTLE_MS) return;
    if (!bypassThrottle) state.lastClearPreviewAt = now;

    playSfxTone({ frequency: 860, endFrequency: 1220, duration: 0.06, volume: 0.05, type: "triangle" });
  }

  function playFailSound() {
    playSfxTone({ frequency: 250, endFrequency: 165, duration: 0.15, volume: 0.03, type: "sawtooth" });
  }

  function playStartSound() {
    playSfxTone({ frequency: 440, endFrequency: 660, duration: 0.08, volume: 0.03, type: "square" });
    window.setTimeout(() => {
      playSfxTone({ frequency: 660, endFrequency: 990, duration: 0.08, volume: 0.03, type: "square" });
    }, 80);
  }

  function playSubmitSound() {
    playSfxTone({ frequency: 520, endFrequency: 860, duration: 0.08, volume: 0.026, type: "triangle" });
  }

  function playResultSound(kind) {
    if (kind === "draw") {
      playSfxTone({ frequency: 520, endFrequency: 520, duration: 0.16, volume: 0.032, type: "triangle" });
      return;
    }

    if (kind === "win") {
      playSfxTone({ frequency: 784, endFrequency: 1175, duration: 0.16, volume: 0.04, type: "triangle" });
      window.setTimeout(() => {
        playSfxTone({ frequency: 1175, endFrequency: 1568, duration: 0.18, volume: 0.04, type: "triangle" });
      }, 90);
      return;
    }

    playSfxTone({ frequency: 300, endFrequency: 180, duration: 0.2, volume: 0.03, type: "sawtooth" });
  }

  function playOpponentLeftSound() {
    playSfxTone({ frequency: 360, endFrequency: 220, duration: 0.2, volume: 0.028, type: "square" });
  }

  bindUnlockHandlers();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.audioUnlocked && state.audioCtx && state.audioCtx.state === "suspended") {
        state.audioCtx.resume().catch(() => {});
      }
      if (state.audioUnlocked) {
        syncBgmAudio({ attemptPlay: true });
      }
    } else {
      pauseBgm();
    }
  });

  window.addEventListener("pageshow", () => {
    if (state.audioUnlocked) {
      syncBgmAudio({ attemptPlay: true });
    }
  });

  window.addEventListener("pagehide", pauseBgm);

  App.audio = {
    ensureAudio,
    startBgm,
    pauseBgm,
    setBgmEnabled,
    setSfxEnabled,
    setBgmVolume,
    setSfxVolume,
    getSettings,
    playUiSound,
    playSelectSound,
    playClearPreviewSound,
    playSuccessSound,
    playFailSound,
    playStartSound,
    playSubmitSound,
    playResultSound,
    playOpponentLeftSound
  };
})();
