(() => {
  const App = window.App || (window.App = {});
  const socket = io();
  const state = App.state || (App.state = {});
  const NICKNAME_STORAGE_KEY = "fruitbox-player-name";
  const ROOM_CODE_STORAGE_KEY = "fruitbox-room-code";

  state.socket = socket;

  function loadStoredValue(key, maxLength = 32) {
    try {
      return String(window.localStorage.getItem(key) || "").trim().slice(0, maxLength);
    } catch (error) {
      return "";
    }
  }

  function saveStoredValue(key, value, maxLength = 32) {
    try {
      window.localStorage.setItem(key, String(value || "").trim().slice(0, maxLength));
    } catch (error) {}
  }

  async function copyText(text) {
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {}
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    let succeeded = false;
    try {
      succeeded = document.execCommand("copy");
    } catch (error) {
      succeeded = false;
    }

    textarea.remove();
    return succeeded;
  }

  function initLobby() {
    const dom = {
      startOverlay: document.getElementById("startOverlay"),
      roomOverlay: document.getElementById("roomOverlay"),
      singleMenuBtn: document.getElementById("singleMenuBtn"),
      onlineMenuBtn: document.getElementById("onlineMenuBtn"),
      singlePanel: document.getElementById("singlePanel"),
      onlinePanel: document.getElementById("onlinePanel"),
      nameInput: document.getElementById("nameInput"),
      roomCodeInput: document.getElementById("roomCodeInput"),
      createRoomBtn: document.getElementById("createRoomBtn"),
      joinRoomBtn: document.getElementById("joinRoomBtn"),
      readyBtn: document.getElementById("readyBtn"),
      leaveToLobbyBtn: document.getElementById("leaveToLobbyBtn"),
      homeBtn: document.getElementById("homeBtn"),
      restartBtn: document.getElementById("restartBtn"),
      restartBtnTop: document.getElementById("restartBtnTop"),
      restartBtnModal: document.getElementById("restartBtnModal"),
      rematchBtn: document.getElementById("rematchBtn"),
      resultHomeBtn: document.getElementById("resultHomeBtn"),
      openSettingsBtn: document.getElementById("openSettingsBtn"),
      gameSettingsBtn: document.getElementById("gameSettingsBtn"),
      closeSettingsBtn: document.getElementById("closeSettingsBtn"),
      settingsOverlay: document.getElementById("settingsOverlay"),
      bgmToggleBtn: document.getElementById("bgmToggleBtn"),
      sfxToggleBtn: document.getElementById("sfxToggleBtn"),
      bgmVolumeSlider: document.getElementById("bgmVolumeSlider"),
      sfxVolumeSlider: document.getElementById("sfxVolumeSlider"),
      bgmVolumeValue: document.getElementById("bgmVolumeValue"),
      sfxVolumeValue: document.getElementById("sfxVolumeValue"),
      singleClassicBtn: document.getElementById("singleClassicBtn"),
      singleTimeAttackBtn: document.getElementById("singleTimeAttackBtn"),
      singleDailyBtn: document.getElementById("singleDailyBtn"),
      dailyModeMeta: document.getElementById("dailyModeMeta"),
      bestScoreValue: document.getElementById("bestScoreValue"),
      bestComboValue: document.getElementById("bestComboValue"),
      bestClearValue: document.getElementById("bestClearValue"),
      perfectClearValue: document.getElementById("perfectClearValue"),
      dailyStatusPill: document.getElementById("dailyStatusPill"),
      dailyPlayedBadge: document.getElementById("dailyPlayedBadge"),
      singleRecordsPreview: document.getElementById("singleRecordsPreview"),
      lobbyError: document.getElementById("lobbyError"),
      copyRoomCodeBtn: document.getElementById("copyRoomCodeBtn"),
      roomCodeBox: document.getElementById("roomCodeBox"),
      copyRoomCodeFeedback: document.getElementById("copyRoomCodeFeedback")
    };

    let copyFeedbackTimer = null;

    function setActivePanel(panel) {
      const singleActive = panel === "single";
      dom.singlePanel.classList.toggle("hidden", !singleActive);
      dom.onlinePanel.classList.toggle("hidden", singleActive);
      dom.singleMenuBtn.classList.toggle("active", singleActive);
      dom.onlineMenuBtn.classList.toggle("active", !singleActive);
      if (dom.lobbyError) dom.lobbyError.textContent = "";
    }

    function syncSettingsUi() {
      const settings = App.audio.getSettings();
      const bgmPercent = Math.round(settings.bgmVolume * 100);
      const sfxPercent = Math.round(settings.sfxVolume * 100);

      dom.bgmToggleBtn.textContent = settings.bgmEnabled ? "ON" : "OFF";
      dom.bgmToggleBtn.setAttribute("aria-pressed", String(settings.bgmEnabled));
      dom.bgmToggleBtn.classList.toggle("is-off", !settings.bgmEnabled);

      dom.sfxToggleBtn.textContent = settings.sfxEnabled ? "ON" : "OFF";
      dom.sfxToggleBtn.setAttribute("aria-pressed", String(settings.sfxEnabled));
      dom.sfxToggleBtn.classList.toggle("is-off", !settings.sfxEnabled);

      dom.bgmVolumeSlider.value = String(bgmPercent);
      dom.sfxVolumeSlider.value = String(sfxPercent);
      dom.bgmVolumeValue.textContent = `${bgmPercent}%`;
      dom.sfxVolumeValue.textContent = `${sfxPercent}%`;
    }

    function openSettings() {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      syncSettingsUi();
      dom.settingsOverlay.classList.remove("hidden");
    }

    function closeSettings() {
      dom.settingsOverlay.classList.add("hidden");
    }

    function getPlayerName() {
      return String(dom.nameInput.value || "").trim().slice(0, 12);
    }

    function getRoomCode() {
      return String(dom.roomCodeInput.value || "").trim().toUpperCase().slice(0, 5);
    }

    function syncInputsFromStorage() {
      const storedName = loadStoredValue(NICKNAME_STORAGE_KEY, 12);
      const storedRoomCode = loadStoredValue(ROOM_CODE_STORAGE_KEY, 5).toUpperCase();
      if (storedName) dom.nameInput.value = storedName;
      if (storedRoomCode) dom.roomCodeInput.value = storedRoomCode;
    }

    function renderMenuData() {
      const menuData = App.game.getMenuData();
      const { records, dailyChallenge, hasPlayedDaily } = menuData;

      dom.bestScoreValue.textContent = String(records.bestScore);
      dom.bestComboValue.textContent = `x${records.bestCombo}`;
      dom.bestClearValue.textContent = `${records.bestClearRate}%`;
      dom.perfectClearValue.textContent = `${records.perfectClearCount}회`;
      dom.dailyModeMeta.textContent = `${dailyChallenge.label} · 오늘 모두 같은 보드`;
      dom.dailyStatusPill.textContent = hasPlayedDaily
        ? `${dailyChallenge.label} · 플레이함`
        : `${dailyChallenge.label} · 데일리 시드`;
      dom.dailyPlayedBadge.textContent = hasPlayedDaily ? "오늘 플레이함" : "오늘 미플레이";
      dom.singleRecordsPreview.textContent = `최고 점수 ${records.bestScore} · 최고 콤보 x${records.bestCombo} · 데일리 ${dailyChallenge.label}`;
    }

    async function fetchDailyChallenge() {
      try {
        const response = await fetch("/api/daily-seed", { cache: "no-store" });
        if (!response.ok) return;
        const daily = await response.json();
        App.game.setDailyChallenge(daily);
      } catch (error) {}
    }

    function returnToStartOverlay() {
      App.game.resetToStartOverlay();
      setActivePanel("single");
      renderMenuData();
      closeSettings();
    }

    function showLobbyError(message) {
      if (dom.lobbyError) dom.lobbyError.textContent = message || "";
      App.game.showLobbyError(message || "");
    }

    function triggerCreateRoom() {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      const name = getPlayerName();
      saveStoredValue(NICKNAME_STORAGE_KEY, name, 12);

      socket.emit("room:create", { name }, (response) => {
        if (!response?.ok) {
          showLobbyError(response?.message);
          return;
        }

        saveStoredValue(ROOM_CODE_STORAGE_KEY, response.room.code, 5);
        App.game.enterOnlineLobby();
        App.game.setPlayerIdentity({
          socketId: response.you.socketId,
          name: response.you.name,
          roomCode: response.room.code
        });
        App.game.renderRoom(response.room);
        dom.startOverlay.classList.add("hidden");
        dom.roomOverlay.classList.remove("hidden");
        showLobbyError("");
      });
    }

    function triggerJoinRoom() {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      const name = getPlayerName();
      const code = getRoomCode();
      saveStoredValue(NICKNAME_STORAGE_KEY, name, 12);
      saveStoredValue(ROOM_CODE_STORAGE_KEY, code, 5);

      socket.emit("room:join", { code, name }, (response) => {
        if (!response?.ok) {
          showLobbyError(response?.message);
          return;
        }

        saveStoredValue(ROOM_CODE_STORAGE_KEY, response.room.code, 5);
        App.game.enterOnlineLobby();
        App.game.setPlayerIdentity({
          socketId: response.you.socketId,
          name: response.you.name,
          roomCode: response.room.code
        });
        App.game.renderRoom(response.room);
        dom.startOverlay.classList.add("hidden");
        dom.roomOverlay.classList.remove("hidden");
        showLobbyError("");
      });
    }

    function startSingle(modeId) {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      const name = getPlayerName();
      saveStoredValue(NICKNAME_STORAGE_KEY, name, 12);

      const menuData = App.game.getMenuData();
      if (modeId === "daily") {
        App.game.startSingleGame({
          playerName: name,
          modeId: "daily",
          label: "오늘의 퍼즐",
          seed: menuData.dailyChallenge.seed,
          dailyKey: menuData.dailyChallenge.dateKey
        });
        return;
      }

      App.game.startSingleGame({
        playerName: name,
        modeId
      });
    }

    async function handleCopyRoomCode() {
      const succeeded = await copyText(String(dom.roomCodeBox.textContent || "").trim());
      if (copyFeedbackTimer) {
        window.clearTimeout(copyFeedbackTimer);
      }
      dom.copyRoomCodeFeedback.textContent = succeeded ? "복사됨" : "복사 실패";
      copyFeedbackTimer = window.setTimeout(() => {
        dom.copyRoomCodeFeedback.textContent = "";
      }, 1200);
    }

    syncInputsFromStorage();
    renderMenuData();
    setActivePanel("single");
    syncSettingsUi();
    fetchDailyChallenge().finally(renderMenuData);

    dom.singleMenuBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      setActivePanel("single");
    });

    dom.onlineMenuBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      setActivePanel("online");
    });

    dom.nameInput.addEventListener("input", () => {
      dom.nameInput.value = dom.nameInput.value.trim().slice(0, 12);
      saveStoredValue(NICKNAME_STORAGE_KEY, dom.nameInput.value, 12);
    });

    dom.roomCodeInput.addEventListener("input", () => {
      dom.roomCodeInput.value = dom.roomCodeInput.value.toUpperCase().slice(0, 5);
      saveStoredValue(ROOM_CODE_STORAGE_KEY, dom.roomCodeInput.value, 5);
    });

    dom.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!dom.onlinePanel.classList.contains("hidden")) {
          triggerCreateRoom();
        } else {
          startSingle("classic");
        }
      }
    });

    dom.roomCodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        triggerJoinRoom();
      }
    });

    dom.createRoomBtn.addEventListener("click", triggerCreateRoom);
    dom.joinRoomBtn.addEventListener("click", triggerJoinRoom);
    dom.singleClassicBtn.addEventListener("click", () => startSingle("classic"));
    dom.singleTimeAttackBtn.addEventListener("click", () => startSingle("timeattack"));
    dom.singleDailyBtn.addEventListener("click", () => startSingle("daily"));
    dom.copyRoomCodeBtn.addEventListener("click", handleCopyRoomCode);

    [dom.openSettingsBtn, dom.gameSettingsBtn].forEach((button) => {
      button.addEventListener("click", openSettings);
    });

    dom.closeSettingsBtn.addEventListener("click", () => {
      App.audio.playUiSound();
      closeSettings();
    });

    dom.settingsOverlay.addEventListener("click", (event) => {
      if (event.target === dom.settingsOverlay) {
        closeSettings();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !dom.settingsOverlay.classList.contains("hidden")) {
        closeSettings();
      }
    });

    [dom.bgmVolumeSlider, dom.sfxVolumeSlider].forEach((slider) => {
      const primeAudio = () => {
        App.audio.ensureAudio();
      };
      slider.addEventListener("pointerdown", primeAudio, { passive: true });
      slider.addEventListener("touchstart", primeAudio, { passive: true });
      slider.addEventListener("focus", primeAudio);
    });

    dom.bgmToggleBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      const next = !App.audio.getSettings().bgmEnabled;
      App.audio.setBgmEnabled(next);
      syncSettingsUi();
    });

    dom.sfxToggleBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      const next = !App.audio.getSettings().sfxEnabled;
      App.audio.setSfxEnabled(next);
      syncSettingsUi();
    });

    const handleBgmVolume = () => {
      App.audio.ensureAudio();
      App.audio.setBgmVolume(Number(dom.bgmVolumeSlider.value) / 100);
      syncSettingsUi();
    };

    const handleSfxVolume = () => {
      App.audio.ensureAudio();
      App.audio.setSfxVolume(Number(dom.sfxVolumeSlider.value) / 100);
      syncSettingsUi();
    };

    dom.bgmVolumeSlider.addEventListener("input", handleBgmVolume);
    dom.bgmVolumeSlider.addEventListener("change", handleBgmVolume);

    dom.sfxVolumeSlider.addEventListener("input", () => {
      handleSfxVolume();
      App.audio.playSelectSound();
    });
    dom.sfxVolumeSlider.addEventListener("change", () => {
      handleSfxVolume();
      App.audio.playClearPreviewSound({ bypassThrottle: true });
    });

    dom.readyBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      socket.emit("room:toggleReady", {}, () => {});
    });

    dom.leaveToLobbyBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      socket.emit("room:leave", {}, () => {
        returnToStartOverlay();
      });
    });

    dom.homeBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      if (App.game.isSingleMode()) {
        returnToStartOverlay();
        return;
      }

      socket.emit("room:leave", {}, () => {
        returnToStartOverlay();
      });
    });

    dom.restartBtn.addEventListener("click", App.game.handleRestartIntent);
    dom.restartBtnTop.addEventListener("click", App.game.handleRestartIntent);

    dom.restartBtnModal.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      App.game.restartSingleGame();
    });

    dom.rematchBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      socket.emit("room:toggleReady", {}, () => {});
    });

    dom.resultHomeBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      if (App.game.isSingleMode()) {
        returnToStartOverlay();
        return;
      }

      socket.emit("room:leave", {}, () => {
        returnToStartOverlay();
      });
    });

    socket.on("room:update", (room) => {
      const currentState = App.game.getState();
      if (!currentState.mySocketId) return;
      if (!room.players.some((player) => player.socketId === currentState.mySocketId)) return;
      App.game.handleRoomUpdate(room);
    });

    socket.on("room:message", ({ message }) => {
      if (message) App.game.setMessage(message, "bad", { duration: 1200 });
    });

    socket.on("game:start", App.game.handleGameStart);
    socket.on("game:boardUpdate", App.game.handleBoardUpdate);
    socket.on("game:result", App.game.handleGameResult);
    socket.on("game:opponentLeft", ({ message }) => {
      App.game.handleOpponentLeft(message);
    });
    socket.on("disconnect", App.game.handleDisconnect);

    window.addEventListener("fruitbox:menu-data-changed", renderMenuData);
  }

  document.addEventListener("DOMContentLoaded", () => {
    App.game.init();
    initLobby();
  });
})();
