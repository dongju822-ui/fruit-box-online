
(() => {
  const App = window.App || (window.App = {});
  const state = App.state || (App.state = {
    socket: null,
    mySocketId: null,
    myName: "",
    myRoomCode: "",
    currentRoom: null,
    mode: "menu",
    lastSingleSeed: 1,
    ROWS: 14,
    COLS: 14,
    DURATION: 120,
    board: [],
    cellEls: [],
    score: 0,
    timeLeft: 120,
    endsAt: null,
    timerId: null,
    isGameActive: false,
    isDragging: false,
    isResolving: false,
    activePointerId: null,
    dragStart: null,
    dragCurrent: null,
    selectedPositions: []
  });

  const dom = {};

  function cacheDom() {
    dom.board = document.getElementById("board");
    dom.boardFrame = document.getElementById("boardFrame");
    dom.selectionRect = document.getElementById("selectionRect");
    dom.timeValue = document.getElementById("timeValue");
    dom.timeBarFill = document.getElementById("timeBarFill");
    dom.scoreValue = document.getElementById("scoreValue");
    dom.opponentCard = document.getElementById("opponentCard");
    dom.opponentScoreValue = document.getElementById("opponentScoreValue");
    dom.modeHint = document.getElementById("modeHint");
    dom.message = document.getElementById("message");
    dom.rotateOverlay = document.getElementById("rotateOverlay");
    dom.gameOver = document.getElementById("gameOver");
    dom.finalScore = document.getElementById("finalScore");
    dom.resultText = document.getElementById("resultText");
    dom.startOverlay = document.getElementById("startOverlay");
    dom.roomOverlay = document.getElementById("roomOverlay");
    dom.roomCodeBox = document.getElementById("roomCodeBox");
    dom.roomPlayerList = document.getElementById("roomPlayerList");
    dom.readyBtn = document.getElementById("readyBtn");
    dom.lobbyError = document.getElementById("lobbyError");
    dom.dropLayer = null;
  }

  function getSocket() {
    return App.state.socket;
  }

  function ensureDropLayer() {
    if (dom.dropLayer && dom.dropLayer.isConnected) {
      return dom.dropLayer;
    }

    const layer = document.createElement("div");
    layer.id = "dropLayer";
    Object.assign(layer.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      overflow: "visible",
      zIndex: "8"
    });

    dom.boardFrame.appendChild(layer);
    dom.dropLayer = layer;
    return layer;
  }

  function isSingleMode() {
    return state.mode === "single";
  }

  function isOnlineMode() {
    return state.mode === "online";
  }

  function updateModeUI() {
    if (dom.modeHint) {
      dom.modeHint.textContent = isSingleMode() ? "싱글 플레이" : "온라인 대전";
    }

    if (dom.opponentCard) {
      dom.opponentCard.classList.toggle("hidden", !isOnlineMode());
    }

    const restartLabel = isSingleMode() ? "다시하기" : "대기실로 돌아가기";
    const restartBtn = document.getElementById("restartBtn");
    if (restartBtn) restartBtn.textContent = isSingleMode() ? "다시하기" : "리셋";
    const restartModalBtn = document.getElementById("restartBtnModal");
    if (restartModalBtn) restartModalBtn.textContent = restartLabel;
  }

  function setMode(mode) {
    state.mode = mode;
    updateModeUI();
  }

  function updateMobileOrientationUI() {
    const isMobile = window.innerWidth <= 900;
    const isPortrait = window.innerHeight > window.innerWidth;

    if (isMobile && isPortrait) {
      dom.rotateOverlay.classList.remove("hidden");
    } else {
      dom.rotateOverlay.classList.add("hidden");
    }
  }

  function createSeededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
    return function seeded() {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function createPreviewBoard(seed) {
    const rand = createSeededRandom(seed);
    state.board = [];

    for (let row = 0; row < state.ROWS; row += 1) {
      const rowData = [];
      for (let col = 0; col < state.COLS; col += 1) {
        rowData.push({
          value: Math.floor(rand() * 9) + 1,
          removed: false
        });
      }
      state.board.push(rowData);
    }

    return cloneBoard(state.board);
  }

  function cloneBoard(board) {
    return (board || []).map((row) =>
      row.map((cell) => ({
        value: Number(cell.value) || 0,
        removed: Boolean(cell.removed)
      }))
    );
  }

  function setBoard(board, rows, cols) {
    if (Number.isInteger(rows)) state.ROWS = rows;
    if (Number.isInteger(cols)) state.COLS = cols;
    state.board = cloneBoard(board);
  }

  function setMessage(text, type = "") {
    dom.message.textContent = text;
    dom.message.classList.remove("good", "bad");
    if (type) dom.message.classList.add(type);
  }

  function updateScore() {
    dom.scoreValue.textContent = String(state.score);
  }

  function updateOpponentScore(value = 0) {
    dom.opponentScoreValue.textContent = String(value);
  }

  function updateScoresFromPlayers(players = []) {
    const me = players.find((player) => player.socketId === state.mySocketId);
    const opponent = players.find((player) => player.socketId !== state.mySocketId);

    state.score = typeof me?.score === "number" ? me.score : 0;
    updateScore();
    updateOpponentScore(typeof opponent?.score === "number" ? opponent.score : 0);
  }

  function resetPlayState() {
    state.isGameActive = false;
    state.isDragging = false;
    state.isResolving = false;
    state.activePointerId = null;
    state.dragStart = null;
    state.dragCurrent = null;
    state.selectedPositions = [];
  }

  function prepareGameStart() {
    resetPlayState();
    state.isGameActive = true;
    hideGameOver();
    setMessage("");
    clearSelectionVisuals();
  }

  function isBoardFullyRemovedLocal(board = state.board) {
    for (const row of board) {
      for (const cell of row) {
        if (!cell.removed) return false;
      }
    }
    return true;
  }

  function computeTimeLeft() {
    if (!state.endsAt) return state.timeLeft;
    return Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
  }

  function updateTime() {
    state.timeLeft = computeTimeLeft();
    dom.timeValue.textContent = String(state.timeLeft);
    const ratio = Math.max(0, Math.min(1, state.timeLeft / state.DURATION));
    dom.timeBarFill.style.width = `${ratio * 100}%`;
    dom.timeValue.classList.toggle("time-warning", state.timeLeft <= 10);
  }

  function hideGameOver() {
    dom.gameOver.classList.remove("show");
  }

  function showGameOver() {
    dom.finalScore.textContent = String(state.score);
    dom.gameOver.classList.add("show");
  }

  function clearTimer() {
    if (state.timerId !== null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function startTimer() {
    clearTimer();

    state.timerId = window.setInterval(() => {
      updateTime();

      if (state.timeLeft <= 0) {
        clearTimer();
        state.isGameActive = false;
        state.isResolving = false;
        cancelDrag(false);

        if (isSingleMode()) {
          finishSingleGame("timeup");
        } else {
          setMessage("결과 계산 중...", "good");
        }
      }
    }, 200);
  }

  function buildCellMarkup(value) {
    return `
      <div class="apple" aria-hidden="true">
        <span class="apple-stem"></span>
        <span class="apple-leaf"></span>
        <span class="apple-body"></span>
        <span class="apple-notch"></span>
        <span class="apple-glow"></span>
        <span class="apple-num">${value}</span>
      </div>
    `;
  }

  function ensureBoardGrid() {
    const needsRebuild =
      state.cellEls.length !== state.ROWS ||
      !state.cellEls[0] ||
      state.cellEls[0].length !== state.COLS;

    if (!needsRebuild) return;

    dom.board.innerHTML = "";
    state.cellEls = [];
    dom.board.style.gridTemplateColumns = `repeat(${state.COLS}, 1fr)`;
    dom.board.style.gridTemplateRows = `repeat(${state.ROWS}, 1fr)`;

    for (let row = 0; row < state.ROWS; row += 1) {
      const rowEls = [];
      for (let col = 0; col < state.COLS; col += 1) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.innerHTML = buildCellMarkup(state.board[row][col].value);
        dom.board.appendChild(cell);
        rowEls.push(cell);
      }
      state.cellEls.push(rowEls);
    }
  }

  function syncBoardVisuals() {
    ensureBoardGrid();

    for (let row = 0; row < state.ROWS; row += 1) {
      for (let col = 0; col < state.COLS; col += 1) {
        const cell = state.cellEls[row][col];
        const cellData = state.board[row][col];
        const appleNum = cell.querySelector(".apple-num");

        if (appleNum) {
          appleNum.textContent = String(cellData.value);
        }

        if (cellData.removed) {
          cell.classList.add("removed");
          cell.classList.remove("selected", "good", "dropping");
        } else {
          cell.classList.remove("removed", "dropping");
        }

        if (cell._dropAnimation && cellData.removed) {
          try {
            cell._dropAnimation.cancel();
          } catch (error) {}
          cell._dropAnimation = null;
        }
      }
    }
  }

  function renderBoard() {
    syncBoardVisuals();
  }

  function getCellFromClient(clientX, clientY, clamp = false) {
    const rect = dom.board.getBoundingClientRect();
    let x = clientX - rect.left;
    let y = clientY - rect.top;

    if (clamp) {
      x = Math.max(0, Math.min(rect.width - 1, x));
      y = Math.max(0, Math.min(rect.height - 1, y));
    } else if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return null;
    }

    const row = Math.max(0, Math.min(state.ROWS - 1, Math.floor((y / rect.height) * state.ROWS)));
    const col = Math.max(0, Math.min(state.COLS - 1, Math.floor((x / rect.width) * state.COLS)));

    return { row, col };
  }

  function clearSelectionVisuals() {
    for (let row = 0; row < state.cellEls.length; row += 1) {
      for (let col = 0; col < state.cellEls[row].length; col += 1) {
        state.cellEls[row][col].classList.remove("selected", "good");
      }
    }

    dom.selectionRect.style.display = "none";
    dom.selectionRect.classList.remove("good");
  }

  function paintSelectedCells(isGood) {
    clearSelectionVisuals();

    for (const pos of state.selectedPositions) {
      if (!state.board[pos.row][pos.col].removed) {
        state.cellEls[pos.row][pos.col].classList.add("selected");
        if (isGood) state.cellEls[pos.row][pos.col].classList.add("good");
      }
    }
  }

  function updateSelectionRect(minRow, minCol, maxRow, maxCol, isGood) {
    const firstCell = state.cellEls[minRow][minCol];
    const lastCell = state.cellEls[maxRow][maxCol];
    if (!firstCell || !lastCell) return;

    const frameRect = dom.boardFrame.getBoundingClientRect();
    const firstRect = firstCell.getBoundingClientRect();
    const lastRect = lastCell.getBoundingClientRect();

    const left = firstRect.left - frameRect.left;
    const top = firstRect.top - frameRect.top;
    const right = lastRect.right - frameRect.left;
    const bottom = lastRect.bottom - frameRect.top;

    dom.selectionRect.style.left = `${left}px`;
    dom.selectionRect.style.top = `${top}px`;
    dom.selectionRect.style.width = `${right - left}px`;
    dom.selectionRect.style.height = `${bottom - top}px`;
    dom.selectionRect.style.display = "block";
    dom.selectionRect.classList.toggle("good", isGood);
  }

  function updateSelection(start, end) {
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);

    state.selectedPositions = [];
    let count = 0;
    let sum = 0;

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        state.selectedPositions.push({ row, col });
        if (!state.board[row][col].removed) {
          count += 1;
          sum += state.board[row][col].value;
        }
      }
    }

    const isGood = count > 0 && sum === 10;

    paintSelectedCells(isGood);
    updateSelectionRect(minRow, minCol, maxRow, maxCol, isGood);

    if (count === 0) {
      setMessage("");
    } else if (isGood) {
      setMessage("좋아요! 지금 놓으면 제거됩니다", "good");
    } else {
      setMessage("");
    }
  }

  function cancelDrag(resetMessage = true) {
    state.isDragging = false;
    state.activePointerId = null;
    state.dragStart = null;
    state.dragCurrent = null;
    state.selectedPositions = [];
    clearSelectionVisuals();

    if (resetMessage && state.isGameActive && !state.isResolving) {
      setMessage("");
    }
  }

  function cubicCurve(t, p0, p1, p2, p3) {
    const omt = 1 - t;
    return (omt * omt * omt * p0)
      + (3 * omt * omt * t * p1)
      + (3 * omt * t * t * p2)
      + (t * t * t * p3);
  }

  function animateRemoval(positions) {
    const dropLayer = ensureDropLayer();
    const frameRect = dom.boardFrame.getBoundingClientRect();
    const boardHeight = dom.boardFrame.clientHeight || dom.board.clientHeight || 600;

    positions.forEach((pos, index) => {
      const cell = state.cellEls[pos.row]?.[pos.col];
      const apple = cell?.querySelector(".apple");
      if (!cell || !apple) return;

      const appleRect = apple.getBoundingClientRect();
      if (!appleRect.width || !appleRect.height) return;

      const ghost = apple.cloneNode(true);
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "absolute",
        left: `${appleRect.left - frameRect.left}px`,
        top: `${appleRect.top - frameRect.top}px`,
        width: `${appleRect.width}px`,
        height: `${appleRect.height}px`,
        margin: "0",
        pointerEvents: "none",
        transformOrigin: "50% 50%",
        zIndex: "1"
      });

      dropLayer.appendChild(ghost);

      const centerBias = (pos.col - (state.COLS - 1) / 2) / ((state.COLS - 1) / 2 || 1);
      const driftX = (centerBias * 54) + (Math.random() * 18 - 9);
      const liftY = 40 + Math.random() * 16;
      const fallY = boardHeight + 120 + Math.random() * 44;
      const duration = 860 + Math.min(index * 16, 96);

      const x0 = 0;
      const x1 = driftX * 0.18;
      const x2 = driftX * 0.72;
      const x3 = driftX;

      const y0 = 0;
      const y1 = -liftY;
      const y2 = fallY * 0.34;
      const y3 = fallY;

      const keyframes = [];
      const steps = 90;

      for (let i = 0; i < steps; i += 1) {
        const t = i / (steps - 1);
        const x = cubicCurve(t, x0, x1, x2, x3);
        const y = cubicCurve(t, y0, y1, y2, y3);
        const wobble = Math.sin(t * Math.PI * 2.35) * (1 - t) * (4 + Math.abs(driftX) * 0.03);
        const rotate = (driftX * 0.22 * t) + wobble;
        const squash = Math.max(0, 1 - (t / 0.16));
        const scaleX = 1 + (0.05 * squash) - (0.04 * t);
        const scaleY = 1 - (0.06 * squash) - (0.08 * t);
        const opacity = t < 0.72 ? 1 : 1 - ((t - 0.72) / 0.28);

        keyframes.push({
          transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rotate.toFixed(2)}deg) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`,
          opacity: Math.max(0, Math.min(1, opacity)).toFixed(4),
          offset: t
        });
      }

      const animation = ghost.animate(keyframes, {
        duration,
        easing: "linear",
        fill: "forwards"
      });

      animation.finished
        .catch(() => {})
        .finally(() => {
          ghost.remove();
        });
    });
  }

  async function handleBoardUpdate({ board, players, removedPositions = [], bySocketId = null, byName = "", endsAt = null } = {}) {
    if (!Array.isArray(board)) return;

    const positions = Array.isArray(removedPositions) ? removedPositions : [];
    const wasDragging = state.isDragging;
    const oldRows = state.ROWS;
    const oldCols = state.COLS;

    if (Array.isArray(board)) {
      setBoard(board, board.length || state.ROWS, board[0]?.length || state.COLS);
    }

    if (typeof endsAt === "number") {
      state.endsAt = endsAt;
    }

    updateScoresFromPlayers(players || []);

    if (wasDragging) {
      cancelDrag(false);
    } else {
      clearSelectionVisuals();
    }

    if (oldRows !== state.ROWS || oldCols !== state.COLS || state.cellEls.length === 0) {
      renderBoard();
      state.isResolving = false;
      return;
    }

    if (positions.length > 0) {
      if (bySocketId === state.mySocketId) {
        App.audio.playSuccessSound();
        setMessage(`성공! ${positions.length}개 제거`, "good");
      } else {
        App.audio.playSelectSound();
        setMessage(`${byName || "상대"}가 ${positions.length}개 제거`, "bad");
      }

      animateRemoval(positions);
    }

    syncBoardVisuals();
    state.isResolving = false;
  }

  async function applyLocalSelection(positions) {
    positions.forEach(({ row, col }) => {
      state.board[row][col].removed = true;
    });

    state.score += positions.length;
    updateScore();
    App.audio.playSuccessSound();
    setMessage(`성공! ${positions.length}개 제거`, "good");

    animateRemoval(positions);
    syncBoardVisuals();

    state.isResolving = false;

    if (isBoardFullyRemovedLocal()) {
      finishSingleGame("boardCleared");
    }
  }

  async function resolveSelection() {
    const validPositions = state.selectedPositions.filter((pos) => !state.board[pos.row][pos.col].removed);
    const sum = validPositions.reduce((acc, pos) => acc + state.board[pos.row][pos.col].value, 0);
    const socket = getSocket();

    if (validPositions.length === 0) {
      cancelDrag();
      return;
    }

    if (sum !== 10) {
      App.audio.playFailSound();
      setMessage("합이 10이 아니에요", "bad");
      cancelDrag(false);
      return;
    }

    if (!state.dragStart || !state.dragCurrent) {
      cancelDrag();
      return;
    }

    state.isResolving = true;

    if (isSingleMode()) {
      cancelDrag(false);
      await applyLocalSelection(validPositions);
      return;
    }

    if (!socket) {
      cancelDrag();
      state.isResolving = false;
      return;
    }

    setMessage("확인 중...", "good");

    const payload = {
      start: state.dragStart,
      end: state.dragCurrent
    };

    cancelDrag(false);

    socket.emit("game:attemptSelect", payload, (response) => {
      if (response?.ok) return;

      state.isResolving = false;
      App.audio.playFailSound();
      setMessage(response?.message || "처리에 실패했습니다.", "bad");
    });
  }

  function renderRoom(room) {
    setMode("online");
    state.currentRoom = room;
    dom.roomCodeBox.textContent = room.code;

    dom.roomPlayerList.innerHTML = room.players
      .map((player) => {
        const readyClass = player.ready ? "ready" : "not-ready";
        const readyText = player.ready ? "준비 완료" : "대기 중";
        return `
          <div class="room-player-item">
            <span>${player.name}${player.socketId === state.mySocketId ? " (나)" : ""}</span>
            <span class="${readyClass}">${readyText}</span>
          </div>
        `;
      })
      .join("");

    const me = room.players.find((player) => player.socketId === state.mySocketId);
    const opponent = room.players.find((player) => player.socketId !== state.mySocketId);
    updateOpponentScore(opponent && typeof opponent.score === "number" ? opponent.score : 0);
    dom.readyBtn.textContent = me && me.ready ? "준비 취소" : "준비하기";
  }

  function showLobbyError(text) {
    dom.lobbyError.textContent = text || "";
  }

  function resetToStartOverlay() {
    setMode("menu");
    state.currentRoom = null;
    state.mySocketId = null;
    state.myName = "";
    state.myRoomCode = "";
    state.endsAt = null;
    state.score = 0;
    state.timeLeft = state.DURATION;
    updateScore();
    updateOpponentScore(0);
    dom.roomOverlay.classList.add("hidden");
    hideGameOver();
    dom.startOverlay.classList.remove("hidden");
    setMessage("");
    clearTimer();
    resetPlayState();
    createPreviewBoard(1);
    renderBoard();
    updateTime();
  }

  function setPlayerIdentity({ socketId = null, name = "", roomCode = "" } = {}) {
    state.mySocketId = socketId;
    state.myName = name;
    state.myRoomCode = roomCode;
  }

  function enterOnlineLobby() {
    setMode("online");
    hideGameOver();
    dom.startOverlay.classList.add("hidden");
  }

  function startSharedGame({ board, rows, cols, duration, endsAt, players } = {}) {
    setMode("online");
    state.ROWS = rows || state.ROWS;
    state.COLS = cols || state.COLS;
    state.DURATION = duration || state.DURATION;
    state.endsAt = typeof endsAt === "number" ? endsAt : Date.now() + (state.DURATION * 1000);

    prepareGameStart();
    setBoard(board || state.board, state.ROWS, state.COLS);
    updateScoresFromPlayers(players || []);
    renderBoard();
    updateTime();
    startTimer();
  }

  function finishSingleGame(reason = "timeup") {
    clearTimer();
    state.isGameActive = false;
    state.isResolving = false;
    cancelDrag(false);

    dom.finalScore.textContent = String(state.score);

    if (reason === "boardCleared") {
      dom.resultText.textContent = "클리어! 보드를 전부 지웠어요";
      App.audio.playResultSound("win");
    } else {
      dom.resultText.textContent = "시간 종료";
      App.audio.playResultSound("draw");
    }

    showGameOver();
  }

  function startSingleGame(seed = Math.floor(Math.random() * 1000000000)) {
    setMode("single");
    state.lastSingleSeed = seed;
    state.currentRoom = null;
    state.mySocketId = "single-player";
    state.myName = "싱글";
    state.myRoomCode = "";
    state.ROWS = 14;
    state.COLS = 14;
    state.DURATION = 120;
    state.endsAt = Date.now() + (state.DURATION * 1000);
    state.score = 0;
    updateScore();
    updateOpponentScore(0);
    dom.startOverlay.classList.add("hidden");
    dom.roomOverlay.classList.add("hidden");

    prepareGameStart();
    setBoard(createPreviewBoard(seed), state.ROWS, state.COLS);
    renderBoard();
    updateTime();
    startTimer();
    App.audio.ensureAudio();
    App.audio.playStartSound();
  }

  function restartSingleGame() {
    hideGameOver();
    startSingleGame(Math.floor(Math.random() * 1000000000));
  }

  function handleGameStart(payload) {
    App.audio.ensureAudio();
    App.audio.playStartSound();
    dom.roomOverlay.classList.add("hidden");
    startSharedGame(payload);
  }

  function handleGameResult(result) {
    if (isSingleMode()) return;

    App.audio.ensureAudio();
    state.isGameActive = false;
    state.isResolving = false;
    clearTimer();
    cancelDrag(false);
    setMessage("");

    const myScoreEntry = result.scores.find((entry) => entry.socketId === state.mySocketId);
    const winnerEntry = result.scores.find((entry) => entry.socketId === result.winnerSocketId);

    if (myScoreEntry) {
      state.score = myScoreEntry.score;
      updateScore();
    }

    if (result.draw) {
      dom.resultText.textContent = "무승부";
      App.audio.playResultSound("draw");
    } else if (winnerEntry && winnerEntry.socketId === state.mySocketId) {
      dom.resultText.textContent = "승리!";
      App.audio.playResultSound("win");
    } else if (winnerEntry) {
      dom.resultText.textContent = `패배 · 승자: ${winnerEntry.name}`;
      App.audio.playResultSound("lose");
    } else {
      dom.resultText.textContent = "";
    }

    showGameOver();
  }

  function handleOpponentLeft(message) {
    if (isSingleMode()) return;
    App.audio.ensureAudio();
    App.audio.playOpponentLeftSound();
    clearTimer();
    hideGameOver();
    dom.roomOverlay.classList.remove("hidden");
    setMessage(message || "상대가 나가서 대기실로 돌아갑니다.", "bad");
    state.isGameActive = false;
    state.isResolving = false;
  }

  function handleDisconnect() {
    if (isSingleMode()) return;
    setMessage("서버 연결이 끊겼습니다.", "bad");
    clearTimer();
    state.isGameActive = false;
    state.isResolving = false;
  }

  function handleRestartIntent() {
    App.audio.ensureAudio();
    App.audio.playUiSound();

    if (isSingleMode()) {
      restartSingleGame();
      return;
    }

    if (!state.currentRoom || !state.currentRoom.gameStarted) return;
    window.alert("온라인 모드에서는 임의 리셋 대신 게임 종료 후 다시 준비해주세요.");
  }

  function bindBoardEvents() {
    dom.board.addEventListener("pointerdown", (event) => {
      App.audio.ensureAudio();
      if (!state.isGameActive || state.isResolving || state.isDragging || state.timeLeft <= 0) return;

      const pos = getCellFromClient(event.clientX, event.clientY);
      if (!pos) return;

      event.preventDefault();

      state.isDragging = true;
      state.activePointerId = event.pointerId;
      state.dragStart = pos;
      state.dragCurrent = pos;

      try {
        dom.board.setPointerCapture(event.pointerId);
      } catch (error) {}

      App.audio.playSelectSound();
      updateSelection(state.dragStart, state.dragCurrent);
    });

    window.addEventListener("pointermove", (event) => {
      if (!state.isGameActive || !state.isDragging || state.isResolving) return;
      if (event.pointerId !== state.activePointerId) return;

      event.preventDefault();

      const pos = getCellFromClient(event.clientX, event.clientY, true);
      if (!pos) return;
      if (state.dragCurrent && state.dragCurrent.row === pos.row && state.dragCurrent.col === pos.col) return;

      state.dragCurrent = pos;
      updateSelection(state.dragStart, state.dragCurrent);
    }, { passive: false });

    window.addEventListener("pointerup", async (event) => {
      if (!state.isDragging) return;
      if (event.pointerId !== state.activePointerId) return;

      event.preventDefault();

      try {
        dom.board.releasePointerCapture(event.pointerId);
      } catch (error) {}

      await resolveSelection();
    }, { passive: false });

    window.addEventListener("pointercancel", () => {
      if (state.isDragging) cancelDrag();
    });

    window.addEventListener("blur", () => {
      if (state.isDragging) cancelDrag();
    });

    window.addEventListener("resize", () => {
      updateMobileOrientationUI();
      if (state.isDragging && state.dragStart && state.dragCurrent) {
        updateSelection(state.dragStart, state.dragCurrent);
      }
    });

    window.addEventListener("orientationchange", updateMobileOrientationUI);
  }

  function init() {
    cacheDom();
    ensureDropLayer();
    bindBoardEvents();
    setMode("menu");
    updateMobileOrientationUI();
    createPreviewBoard(1);
    renderBoard();
    updateScore();
    updateTime();
    updateModeUI();
  }

  App.game = {
    init,
    setMessage,
    updateOpponentScore,
    clearTimer,
    hideGameOver,
    showLobbyError,
    renderRoom,
    resetToStartOverlay,
    setPlayerIdentity,
    enterOnlineLobby,
    startSingleGame,
    restartSingleGame,
    isSingleMode,
    handleGameStart,
    handleBoardUpdate,
    handleGameResult,
    handleOpponentLeft,
    handleDisconnect,
    handleRestartIntent,
    getState: () => state,
    getDom: () => dom
  };
})();
