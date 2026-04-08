(() => {
  const App = window.App || (window.App = {});

  const STORAGE_KEY = "fruitbox-audio-settings";
  const DEFAULT_SETTINGS = Object.freeze({
    bgmVolume: 0.4,
    dragVolume: 0.7,
    clearVolume: 0.8
  });
  const SFX_VOLUME_MULTIPLIER = 3.1;
  const SFX_MAX_VOLUME = 0.2;
  const BGM_SRC = "/assets/bgm/3.mp3";
  const SELECT_SOUND_THROTTLE_MS = 40;

  const state = {
    audioCtx: null,
    audioUnlocked: false,
    bgmAudio: null,
    lastSelectAt: 0,
    settings: loadSettings()
  };

  function clamp01(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
  }

  function createDefaultSettings() {
    return {
      bgmVolume: DEFAULT_SETTINGS.bgmVolume,
      dragVolume: DEFAULT_SETTINGS.dragVolume,
      clearVolume: DEFAULT_SETTINGS.clearVolume
    };
  }

  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return createDefaultSettings();
      }
      const parsed = JSON.parse(raw);
      return {
        bgmVolume: clamp01(parsed?.bgmVolume, DEFAULT_SETTINGS.bgmVolume),
        dragVolume: clamp01(parsed?.dragVolume, DEFAULT_SETTINGS.dragVolume),
        clearVolume: clamp01(parsed?.clearVolume, DEFAULT_SETTINGS.clearVolume)
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

  function ensureAudio() {
    if (!state.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) state.audioCtx = new AudioContextClass();
    }

    if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(() => {});
    }

    state.audioUnlocked = true;
    startBgm();
    return state.audioCtx;
  }

  function createBgmAudio() {
    if (state.bgmAudio) return state.bgmAudio;
    const audio = new Audio(BGM_SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = state.settings.bgmVolume;
    audio.crossOrigin = "anonymous";
    state.bgmAudio = audio;
    return audio;
  }

  function startBgm() {
    if (!state.audioUnlocked) return;
    const bgm = createBgmAudio();
    bgm.volume = state.settings.bgmVolume;
    if (bgm.paused) {
      const p = bgm.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  }

  function pauseBgm() {
    if (state.bgmAudio) state.bgmAudio.pause();
  }

  function setSettingVolume(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    state.settings[key] = clamp01(value, DEFAULT_SETTINGS[key]);

    if (key === "bgmVolume" && state.bgmAudio) {
      state.bgmAudio.volume = state.settings.bgmVolume;
    }

    saveSettings();
  }

  function setBgmVolume(value) {
    setSettingVolume("bgmVolume", value);
  }

  function setDragVolume(value) {
    setSettingVolume("dragVolume", value);
  }

  function setClearVolume(value) {
    setSettingVolume("clearVolume", value);
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
    multiplier = 1,
    gainScale = 1
  } = {}) {
    const ctx = ensureAudio();
    if (!ctx) return;

    const finalVolume = Math.min(volume * multiplier * gainScale, SFX_MAX_VOLUME);
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

  function playSfxTone(options, { volumeKey = null, gainScale = 1 } = {}) {
    const settingScale = volumeKey
      ? clamp01(state.settings[volumeKey], DEFAULT_SETTINGS[volumeKey])
      : 1;

    tone({
      ...options,
      multiplier: SFX_VOLUME_MULTIPLIER,
      gainScale: settingScale * gainScale
    });
  }

  function playUiSound() {
    playSfxTone({ frequency: 520, endFrequency: 760, duration: 0.055, volume: 0.022, type: "triangle" });
  }

  function playSelectSound(options = {}) {
    const { bypassThrottle = false } = options;
    const now = performance.now();
    if (!bypassThrottle && now - state.lastSelectAt < SELECT_SOUND_THROTTLE_MS) return;
    if (!bypassThrottle) {
      state.lastSelectAt = now;
    }

    playSfxTone(
      { frequency: 820, endFrequency: 1080, duration: 0.036, volume: 0.032, type: "triangle" },
      { volumeKey: "dragVolume" }
    );
  }

  function playSuccessSound() {
    playSfxTone(
      { frequency: 700, endFrequency: 980, duration: 0.08, volume: 0.062, type: "triangle" },
      { volumeKey: "clearVolume" }
    );
    window.setTimeout(() => {
      playSfxTone(
        { frequency: 920, endFrequency: 1320, duration: 0.11, volume: 0.074, type: "triangle" },
        { volumeKey: "clearVolume" }
      );
    }, 38);
    window.setTimeout(() => {
      playSfxTone(
        { frequency: 1180, endFrequency: 1680, duration: 0.095, volume: 0.068, type: "triangle" },
        { volumeKey: "clearVolume" }
      );
    }, 96);
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
    playSfxTone({ frequency: 300, endFrequency: 180, duration: 0.20, volume: 0.03, type: "sawtooth" });
  }

  function playOpponentLeftSound() {
    playSfxTone({ frequency: 360, endFrequency: 220, duration: 0.20, volume: 0.028, type: "square" });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.audioUnlocked && state.audioCtx && state.audioCtx.state === "suspended") {
        state.audioCtx.resume().catch(() => {});
      }
      if (state.audioUnlocked) startBgm();
    } else {
      pauseBgm();
    }
  });

  window.addEventListener("pagehide", pauseBgm);

  App.audio = {
    ensureAudio,
    startBgm,
    pauseBgm,
    setBgmVolume,
    setDragVolume,
    setClearVolume,
    getSettings,
    playUiSound,
    playSelectSound,
    playSuccessSound,
    playFailSound,
    playStartSound,
    playSubmitSound,
    playResultSound,
    playOpponentLeftSound
  };
})();
