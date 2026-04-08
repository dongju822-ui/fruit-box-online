(() => {
  const App = window.App || (window.App = {});
  const socket = io();
  const state = App.state || (App.state = {});
  state.socket = socket;

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
      startOverlay: document.getElementById("startOverlay"),
      roomOverlay: document.getElementById("roomOverlay")
    };

    function triggerCreateRoom() {
      App.audio.ensureAudio();
      App.audio.playUiSound();

      const name = dom.nameInput.value.trim();
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

      const name = dom.nameInput.value.trim();
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
      App.game.startSingleGame();
    });

    dom.createRoomBtn.addEventListener("click", triggerCreateRoom);
    dom.joinRoomBtn.addEventListener("click", triggerJoinRoom);

    dom.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        triggerCreateRoom();
      }
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

    socket.on("room:update", (room) => {
      const currentState = App.game.getState();
      if (!currentState.mySocketId) return;
      if (!room.players.some((player) => player.socketId === currentState.mySocketId)) return;
      App.game.renderRoom(room);
    });

    socket.on("room:message", ({ message }) => {
      if (message) App.game.setMessage(message, "bad");
    });

    socket.on("game:start", App.game.handleGameStart);
    socket.on("game:boardUpdate", App.game.handleBoardUpdate);
    socket.on("game:result", App.game.handleGameResult);
    socket.on("game:opponentLeft", ({ message }) => {
      App.game.handleOpponentLeft(message);
    });
    socket.on("disconnect", App.game.handleDisconnect);
  }

  document.addEventListener("DOMContentLoaded", () => {
    App.game.init();
    initLobby();
  });
})();
