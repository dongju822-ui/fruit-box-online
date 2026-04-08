(() => {
  const App = window.App || (window.App = {});

  const state = {
    audioCtx: null,
    audioUnlocked: false,
    bgmAudio: null,
    lastSelectAt: 0
  };

  const BGM_VOLUME = 0.38;
  const SFX_VOLUME_MULTIPLIER = 2.4;
  const SFX_MAX_VOLUME = 0.14;
  const BGM_SRC = "/assets/bgm/3.mp3";

  function ensureAudio() {
    if (!state.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        state.audioCtx = new AudioContextClass();
      }
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
    audio.volume = BGM_VOLUME;
    audio.crossOrigin = "anonymous";

    state.bgmAudio = audio;
    return audio;
  }

  function startBgm() {
    if (!state.audioUnlocked) return;

    const bgm = createBgmAudio();
    bgm.volume = BGM_VOLUME;

    if (bgm.paused) {
      const playPromise = bgm.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    }
  }

  function pauseBgm() {
    if (!state.bgmAudio) return;
    state.bgmAudio.pause();
  }

  function tone({
    frequency = 440,
    endFrequency = null,
    duration = 0.12,
    volume = 0.03,
    type = "triangle",
    multiplier = 1
  } = {}) {
    const ctx = ensureAudio();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const finalVolume = Math.min(volume * multiplier, SFX_MAX_VOLUME);

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
    tone({ ...options, multiplier: SFX_VOLUME_MULTIPLIER });
  }

  function playUiSound() {
    playSfxTone({ frequency: 520, endFrequency: 760, duration: 0.055, volume: 0.024, type: "triangle" });
  }

  function playSelectSound() {
    const now = performance.now();
    if (now - state.lastSelectAt < 50) return;
    state.lastSelectAt = now;

    playSfxTone({ frequency: 640, endFrequency: 820, duration: 0.042, volume: 0.02, type: "triangle" });
  }

  function playSuccessSound() {
    playSfxTone({ frequency: 700, endFrequency: 980, duration: 0.08, volume: 0.05, type: "triangle" });
    window.setTimeout(() => {
      playSfxTone({ frequency: 920, endFrequency: 1320, duration: 0.11, volume: 0.062, type: "triangle" });
    }, 38);
    window.setTimeout(() => {
      playSfxTone({ frequency: 1180, endFrequency: 1680, duration: 0.095, volume: 0.055, type: "triangle" });
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
      if (state.audioUnlocked) {
        startBgm();
      }
    } else {
      pauseBgm();
    }
  });

  window.addEventListener("pagehide", pauseBgm);

  App.audio = {
    ensureAudio,
    startBgm,
    pauseBgm,
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
