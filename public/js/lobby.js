(() => {
  const App = window.App || (window.App = {});
  const socket = io();
  const state = App.state || (App.state = {});
  const NICKNAME_STORAGE_KEY = "fruitbox-player-name";

  state.socket = socket;

  function loadSavedNickname() {
    try {
      return String(window.localStorage.getItem(NICKNAME_STORAGE_KEY) || "").trim().slice(0, 12);
    } catch (error) {
      return "";
    }
  }

  function saveNickname(value) {
    try {
      window.localStorage.setItem(NICKNAME_STORAGE_KEY, String(value || "").trim().slice(0, 12));
    } catch (error) {}
  }

  function initLobby() {
    const dom = {
      singleModeBtn: document.getElementById("singleModeBtn"),
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
      openSettingsBtn: document.getElementById("openSettingsBtn"),
      closeSettingsBtn: document.getElementById("closeSettingsBtn"),
      settingsOverlay: document.getElementById("settingsOverlay"),
      bgmVolumeSlider: document.getElementById("bgmVolumeSlider"),
      clearVolumeSlider: document.getElementById("clearVolumeSlider"),
      bgmVolumeValue: document.getElementById("bgmVolumeValue"),
      clearVolumeValue: document.getElementById("clearVolumeValue"),
      startOverlay: document.getElementById("startOverlay"),
      roomOverlay: document.getElementById("roomOverlay")
    };

    const savedName = loadSavedNickname();
    if (savedName) {
      dom.nameInput.value = savedName;
    }

    function syncSettingsUi() {
      const settings = App.audio.getSettings();
      const bgmPercent = Math.round(settings.bgmVolume * 100);
      const clearPercent = Math.round(settings.clearVolume * 100);

      dom.bgmVolumeSlider.value = String(bgmPercent);
      dom.clearVolumeSlider.value = String(clearPercent);
      dom.bgmVolumeValue.textContent = `${bgmPercent}%`;
      dom.clearVolumeValue.textContent = `${clearPercent}%`;
    }

    function openSettings() {
      App.audio.playUiSound();
      syncSettingsUi();
      dom.settingsOverlay.classList.remove("hidden");
    }

    function closeSettings() {
      dom.settingsOverlay.classList.add("hidden");
    }

    function getPlayerName() {
      const name = dom.nameInput.value.trim().slice(0, 12);
      saveNickname(name);
      return name;
    }

    function triggerCreateRoom() {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      const name = getPlayerName();
      socket.emit("room:create", { name }, (response) => {
        if (!response?.ok) {
          App.game.showLobbyError(response?.message);
          return;
        }

        App.game.enterOnlineLobby();
        App.game.setPlayerIdentity({
          socketId: response.you.socketId,
          name: response.you.name,
          roomCode: response.room.code
        });
        App.game.renderRoom(response.room);

        dom.startOverlay.classList.add("hidden");
        dom.roomOverlay.classList.remove("hidden");
        App.game.showLobbyError("");
      });
    }

    function triggerJoinRoom() {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      const name = getPlayerName();
      const code = dom.roomCodeInput.value.trim().toUpperCase();

      socket.emit("room:join", { code, name }, (response) => {
        if (!response?.ok) {
          App.game.showLobbyError(response?.message);
          return;
        }

        App.game.enterOnlineLobby();
        App.game.setPlayerIdentity({
          socketId: response.you.socketId,
          name: response.you.name,
          roomCode: response.room.code
        });
        App.game.renderRoom(response.room);

        dom.startOverlay.classList.add("hidden");
        dom.roomOverlay.classList.remove("hidden");
        App.game.showLobbyError("");
      });
    }

    dom.singleModeBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      App.game.startSingleGame(getPlayerName());
    });

    dom.createRoomBtn.addEventListener("click", triggerCreateRoom);
    dom.joinRoomBtn.addEventListener("click", triggerJoinRoom);

    dom.nameInput.addEventListener("input", () => {
      saveNickname(dom.nameInput.value);
    });

    dom.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        triggerCreateRoom();
      }
    });

    dom.roomCodeInput.addEventListener("input", () => {
      dom.roomCodeInput.value = dom.roomCodeInput.value.toUpperCase();
    });

    dom.roomCodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        triggerJoinRoom();
      }
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
        App.game.resetToStartOverlay();
      });
    });

    dom.homeBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      if (App.game.isSingleMode()) {
        App.game.resetToStartOverlay();
        return;
      }

      socket.emit("room:leave", {}, () => {
        App.game.resetToStartOverlay();
      });
    });

    dom.restartBtn.addEventListener("click", App.game.handleRestartIntent);
    dom.restartBtnTop.addEventListener("click", App.game.handleRestartIntent);

    dom.restartBtnModal.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      if (App.game.isSingleMode()) {
        App.game.restartSingleGame();
        return;
      }

      App.game.hideGameOver();
      dom.roomOverlay.classList.remove("hidden");
      socket.emit("room:resetLobby", {}, () => {});
    });

    dom.openSettingsBtn.addEventListener("click", openSettings);
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

    dom.bgmVolumeSlider.addEventListener("input", () => {
      const value = Number(dom.bgmVolumeSlider.value) / 100;
      App.audio.ensureAudio();
      App.audio.setBgmVolume(value);
      dom.bgmVolumeValue.textContent = `${dom.bgmVolumeSlider.value}%`;
    });

    dom.clearVolumeSlider.addEventListener("input", () => {
      const value = Number(dom.clearVolumeSlider.value) / 100;
      App.audio.ensureAudio();
      App.audio.setClearVolume(value);
      dom.clearVolumeValue.textContent = `${dom.clearVolumeSlider.value}%`;
    });

    dom.clearVolumeSlider.addEventListener("change", () => {
      App.audio.playSuccessSound();
    });

    socket.on("room:update", (room) => {
      const currentState = App.game.getState();
      if (!currentState.mySocketId) return;
      if (!room.players.some((player) => player.socketId === currentState.mySocketId)) return;
      App.game.renderRoom(room);
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

    syncSettingsUi();
  }

  document.addEventListener("DOMContentLoaded", () => {
    App.game.init();
    initLobby();
  });
})();
