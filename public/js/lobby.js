(() => {
  const App = window.App || (window.App = {});
  const socket = io();
  const state = App.state || (App.state = {});
  const NICKNAME_STORAGE_KEY = "fruitbox-player-name";
  const MOBILE_START_BREAKPOINT = 900;

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
      startOverlay: document.getElementById("startOverlay"),
      roomOverlay: document.getElementById("roomOverlay"),
      desktopStartLayout: document.getElementById("desktopStartLayout"),
      mobileStartLayout: document.getElementById("mobileStartLayout"),
      singleModeBtn: document.getElementById("singleModeBtn"),
      singleModeBtnMobile: document.getElementById("singleModeBtnMobile"),
      mobileOnlineMenuBtn: document.getElementById("mobileOnlineMenuBtn"),
      mobileOnlineBackBtn: document.getElementById("mobileOnlineBackBtn"),
      nameInput: document.getElementById("nameInput"),
      nameInputMobile: document.getElementById("nameInputMobile"),
      roomCodeInput: document.getElementById("roomCodeInput"),
      roomCodeInputMobile: document.getElementById("roomCodeInputMobile"),
      createRoomBtn: document.getElementById("createRoomBtn"),
      createRoomBtnMobile: document.getElementById("createRoomBtnMobile"),
      joinRoomBtn: document.getElementById("joinRoomBtn"),
      joinRoomBtnMobile: document.getElementById("joinRoomBtnMobile"),
      readyBtn: document.getElementById("readyBtn"),
      leaveToLobbyBtn: document.getElementById("leaveToLobbyBtn"),
      homeBtn: document.getElementById("homeBtn"),
      restartBtn: document.getElementById("restartBtn"),
      restartBtnTop: document.getElementById("restartBtnTop"),
      restartBtnModal: document.getElementById("restartBtnModal"),
      openSettingsBtn: document.getElementById("openSettingsBtn"),
      openSettingsBtnMobile: document.getElementById("openSettingsBtnMobile"),
      closeSettingsBtn: document.getElementById("closeSettingsBtn"),
      settingsOverlay: document.getElementById("settingsOverlay"),
      bgmVolumeSlider: document.getElementById("bgmVolumeSlider"),
      dragVolumeSlider: document.getElementById("dragVolumeSlider"),
      clearVolumeSlider: document.getElementById("clearVolumeSlider"),
      bgmVolumeValue: document.getElementById("bgmVolumeValue"),
      dragVolumeValue: document.getElementById("dragVolumeValue"),
      clearVolumeValue: document.getElementById("clearVolumeValue")
    };

    const nameInputs = [dom.nameInput, dom.nameInputMobile].filter(Boolean);
    const roomCodeInputs = [dom.roomCodeInput, dom.roomCodeInputMobile].filter(Boolean);
    const singleButtons = [dom.singleModeBtn, dom.singleModeBtnMobile].filter(Boolean);
    const createButtons = [dom.createRoomBtn, dom.createRoomBtnMobile].filter(Boolean);
    const joinButtons = [dom.joinRoomBtn, dom.joinRoomBtnMobile].filter(Boolean);
    const openSettingsButtons = [dom.openSettingsBtn, dom.openSettingsBtnMobile].filter(Boolean);

    function isMobileStartLayout() {
      return window.innerWidth <= MOBILE_START_BREAKPOINT;
    }

    function syncStartLayoutMode() {
      const mobile = isMobileStartLayout();

      if (dom.desktopStartLayout) {
        dom.desktopStartLayout.hidden = mobile;
      }

      if (dom.mobileStartLayout) {
        dom.mobileStartLayout.hidden = !mobile;
      }

      if (!mobile) {
        dom.startOverlay.classList.remove("mobile-online-open");
      }
    }

    function setMobileMenuState(view) {
      syncStartLayoutMode();

      const isOnlineView = isMobileStartLayout() && view === "online";
      dom.startOverlay.classList.toggle("mobile-online-open", isOnlineView);

      if (!isOnlineView) {
        App.game.showLobbyError("");
      }
    }

    function syncSettingsUi() {
      const settings = App.audio.getSettings();
      const bgmPercent = Math.round(settings.bgmVolume * 100);
      const dragPercent = Math.round(settings.dragVolume * 100);
      const clearPercent = Math.round(settings.clearVolume * 100);

      dom.bgmVolumeSlider.value = String(bgmPercent);
      dom.dragVolumeSlider.value = String(dragPercent);
      dom.clearVolumeSlider.value = String(clearPercent);
      dom.bgmVolumeValue.textContent = `${bgmPercent}%`;
      dom.dragVolumeValue.textContent = `${dragPercent}%`;
      dom.clearVolumeValue.textContent = `${clearPercent}%`;
    }

    function syncTextInputs(targets, value, source = null) {
      targets.forEach((input) => {
        if (!input || input === source) return;
        input.value = value;
      });
    }

    function getPlayerName() {
      return String(nameInputs[0]?.value || "").trim().slice(0, 12);
    }

    function getRoomCode() {
      return String(roomCodeInputs[0]?.value || "").trim().toUpperCase().slice(0, 5);
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

    function returnToStartOverlay() {
      App.game.resetToStartOverlay();
      setMobileMenuState("home");
    }

    function triggerCreateRoom() {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      const name = getPlayerName();
      saveNickname(name);

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
        setMobileMenuState("home");
      });
    }

    function triggerJoinRoom() {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      const name = getPlayerName();
      const code = getRoomCode();
      saveNickname(name);

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
        setMobileMenuState("home");
      });
    }

    const savedName = loadSavedNickname();
    if (savedName) {
      syncTextInputs(nameInputs, savedName);
      if (nameInputs[0]) nameInputs[0].value = savedName;
    }

    nameInputs.forEach((input) => {
      input.addEventListener("input", () => {
        const value = input.value.trim().slice(0, 12);
        input.value = value;
        syncTextInputs(nameInputs, value, input);
        saveNickname(value);
      });

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          triggerCreateRoom();
        }
      });
    });

    roomCodeInputs.forEach((input) => {
      input.addEventListener("input", () => {
        const value = input.value.toUpperCase().slice(0, 5);
        input.value = value;
        syncTextInputs(roomCodeInputs, value, input);
      });

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          triggerJoinRoom();
        }
      });
    });

    singleButtons.forEach((button) => {
      button.addEventListener("click", () => {
        App.audio.ensureAudio();
        App.audio.playUiSound();
        App.game.startSingleGame(getPlayerName());
        setMobileMenuState("home");
      });
    });

    createButtons.forEach((button) => {
      button.addEventListener("click", triggerCreateRoom);
    });

    joinButtons.forEach((button) => {
      button.addEventListener("click", triggerJoinRoom);
    });

    openSettingsButtons.forEach((button) => {
      button.addEventListener("click", openSettings);
    });

    [dom.bgmVolumeSlider, dom.dragVolumeSlider, dom.clearVolumeSlider].forEach((slider) => {
      if (!slider) return;

      const primeAudio = () => {
        App.audio.ensureAudio();
      };

      slider.addEventListener("pointerdown", primeAudio, { passive: true });
      slider.addEventListener("touchstart", primeAudio, { passive: true });
      slider.addEventListener("focus", primeAudio);
    });

    dom.mobileOnlineMenuBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      App.game.showLobbyError("");
      setMobileMenuState("online");
    });

    dom.mobileOnlineBackBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      setMobileMenuState("home");
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

    const handleBgmVolumeInput = () => {
      const value = Number(dom.bgmVolumeSlider.value) / 100;
      App.audio.ensureAudio();
      App.audio.setBgmVolume(value);
      dom.bgmVolumeValue.textContent = `${dom.bgmVolumeSlider.value}%`;
    };

    dom.bgmVolumeSlider.addEventListener("input", handleBgmVolumeInput);
    dom.bgmVolumeSlider.addEventListener("change", handleBgmVolumeInput);

    const handleDragVolumeInput = () => {
      const value = Number(dom.dragVolumeSlider.value) / 100;
      App.audio.ensureAudio();
      App.audio.setDragVolume(value);
      dom.dragVolumeValue.textContent = `${dom.dragVolumeSlider.value}%`;
    };

    dom.dragVolumeSlider.addEventListener("input", handleDragVolumeInput);
    dom.dragVolumeSlider.addEventListener("change", handleDragVolumeInput);

    dom.dragVolumeSlider.addEventListener("input", () => {
      App.audio.playSelectSound();
    });

    dom.dragVolumeSlider.addEventListener("change", () => {
      App.audio.playSelectSound({ bypassThrottle: true });
    });

    const handleClearVolumeInput = () => {
      const value = Number(dom.clearVolumeSlider.value) / 100;
      App.audio.ensureAudio();
      App.audio.setClearVolume(value);
      dom.clearVolumeValue.textContent = `${dom.clearVolumeSlider.value}%`;
    };

    dom.clearVolumeSlider.addEventListener("input", handleClearVolumeInput);
    dom.clearVolumeSlider.addEventListener("change", handleClearVolumeInput);

    dom.clearVolumeSlider.addEventListener("input", () => {
      App.audio.playClearPreviewSound();
    });

    dom.clearVolumeSlider.addEventListener("change", () => {
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

      if (App.game.isSingleMode()) {
        App.game.restartSingleGame();
        return;
      }

      App.game.hideGameOver();
      dom.roomOverlay.classList.remove("hidden");
      socket.emit("room:resetLobby", {}, () => {});
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

    window.addEventListener("resize", () => {
      syncStartLayoutMode();
      if (!isMobileStartLayout()) {
        setMobileMenuState("home");
      }
    });

    syncStartLayoutMode();
    setMobileMenuState("home");
    syncSettingsUi();
  }

  document.addEventListener("DOMContentLoaded", () => {
    App.game.init();
    initLobby();
  });
})();
