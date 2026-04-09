(() => {
  const App = window.App || (window.App = {});

  const DEFAULT_ROWS = 9;
  const DEFAULT_COLS = 18;
  const DEFAULT_DURATION = 120;
  const DRAG_FEEDBACK_THROTTLE_MS = 40;
  const COMBO_WINDOW_MS = 2000;
  const PERFECT_CLEAR_BONUS = 80;
  const HINT_DURATION_MS = 2200;
  const HINT_COOLDOWN_MS = 10000;
  const HINT_MAX_USES = 2;
  const MOBILE_BREAKPOINT = 900;
  const VIEWPORT_SYNC_DELAY_MS = 160;
  const VIEWPORT_SETTLE_DELAY_MS = 360;
  const SINGLE_RECORDS_KEY = "fruitbox-single-records";
  const DAILY_PROGRESS_KEY = "fruitbox-daily-progress";
  const SINGLE_MODE_PRESETS = Object.freeze({
    classic: { label: "클래식", duration: 120 },
    timeattack: { label: "타임어택", duration: 60 },
    daily: { label: "오늘의 퍼즐", duration: 120 }
  });

  const dom = {};

  const state = App.state || (App.state = {
    socket: null,
    mySocketId: null,
    myName: "",
    myRoomCode: "",
    currentRoom: null,
    mode: "menu",
    lastSingleSeed: 1,
    ROWS: DEFAULT_ROWS,
    COLS: DEFAULT_COLS,
    DURATION: DEFAULT_DURATION,
    board: [],
    cellEls: [],
    score: 0,
    timeLeft: DEFAULT_DURATION,
    endsAt: null,
    timerId: null,
    isGameActive: false,
    isDragging: false,
    isResolving: false,
    activePointerId: null,
    dragStart: null,
    dragCurrent: null,
    selectedPositions: [],
    dragVisitedKeys: new Set(),
    highlightedCells: [],
    hintCells: [],
    lastDragFeedbackAt: 0,
    lastSelectionSignature: "",
    lastSelectionIsGood: false,
    layout: null,
    boardLayoutRaf: null,
    pendingSelectionRaf: null,
    queuedDragPos: null,
    resizeObserver: null,
    viewportSyncTimerId: null,
    viewportSettleTimerId: null,
    toastTimerId: null,
    dropLayer: null,
    removalEffects: new Set(),
    boardFrameSize: {
      width: 0,
      height: 0
    },
    singleConfig: {
      modeId: "classic",
      label: SINGLE_MODE_PRESETS.classic.label,
      duration: SINGLE_MODE_PRESETS.classic.duration,
      seed: 1,
      dailyKey: ""
    },
    singleStats: {
      removedCount: 0,
      currentCombo: 0,
      bestCombo: 0,
      lastClearAt: 0,
      perfectClear: false,
      hintUsesLeft: HINT_MAX_USES,
      hintCooldownUntil: 0
    },
    hintPreview: null,
    hintPreviewTimerId: null,
    comboChipTimerId: null,
    records: loadSingleRecords(),
    dailyProgress: loadDailyProgress(),
    dailyChallenge: createFallbackDailyChallenge()
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sanitizeName(name, fallback = "나") {
    return String(name || "").trim().slice(0, 12) || fallback;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getSingleCellCount() {
    return state.ROWS * state.COLS;
  }

  function createLocalDateKey(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value || "1970";
    const month = parts.find((part) => part.type === "month")?.value || "01";
    const day = parts.find((part) => part.type === "day")?.value || "01";
    return `${year}-${month}-${day}`;
  }

  function hashStringToSeed(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (Math.abs(hash) % 1000000000) + 1;
  }

  function loadSingleRecords() {
    const defaults = {
      bestScore: 0,
      bestCombo: 0,
      bestClearRate: 0,
      perfectClearCount: 0
    };

    try {
      const raw = window.localStorage.getItem(SINGLE_RECORDS_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return {
        bestScore: Math.max(0, Number(parsed?.bestScore) || 0),
        bestCombo: Math.max(0, Number(parsed?.bestCombo) || 0),
        bestClearRate: Math.max(0, Math.min(100, Number(parsed?.bestClearRate) || 0)),
        perfectClearCount: Math.max(0, Number(parsed?.perfectClearCount) || 0)
      };
    } catch (error) {
      return defaults;
    }
  }

  function saveSingleRecords() {
    try {
      window.localStorage.setItem(SINGLE_RECORDS_KEY, JSON.stringify(state.records));
    } catch (error) {}
  }

  function loadDailyProgress() {
    try {
      const raw = window.localStorage.getItem(DAILY_PROGRESS_KEY);
      if (!raw) return { lastPlayedKey: "" };
      const parsed = JSON.parse(raw);
      return {
        lastPlayedKey: String(parsed?.lastPlayedKey || "")
      };
    } catch (error) {
      return { lastPlayedKey: "" };
    }
  }

  function saveDailyProgress() {
    try {
      window.localStorage.setItem(DAILY_PROGRESS_KEY, JSON.stringify(state.dailyProgress));
    } catch (error) {}
  }

  function createFallbackDailyChallenge() {
    const dateKey = createLocalDateKey();
    return {
      dateKey,
      label: dateKey.replace(/-/g, "."),
      seed: hashStringToSeed(`fruit-box-daily:${dateKey}`)
    };
  }

  function getMenuData() {
    return {
      records: { ...state.records },
      dailyChallenge: { ...state.dailyChallenge },
      hasPlayedDaily: state.dailyProgress.lastPlayedKey === state.dailyChallenge.dateKey
    };
  }

  function emitMenuDataChange() {
    window.dispatchEvent(
      new CustomEvent("fruitbox:menu-data-changed", {
        detail: getMenuData()
      })
    );
  }

  function setDailyChallenge(info = {}) {
    const fallback = createFallbackDailyChallenge();
    state.dailyChallenge = {
      dateKey: String(info.dateKey || fallback.dateKey),
      label: String(info.label || fallback.label),
      seed: Number.isFinite(Number(info.seed)) ? Number(info.seed) : fallback.seed
    };
    emitMenuDataChange();
  }

  function markDailyPlayed(dateKey) {
    if (!dateKey) return;
    state.dailyProgress.lastPlayedKey = dateKey;
    saveDailyProgress();
    emitMenuDataChange();
  }

  function persistSingleRecords(summary) {
    const flags = {
      bestScore: summary.score > state.records.bestScore,
      bestCombo: summary.bestCombo > state.records.bestCombo,
      bestClearRate: summary.clearRate > state.records.bestClearRate,
      perfectClear: summary.perfectClear
    };

    state.records.bestScore = Math.max(state.records.bestScore, summary.score);
    state.records.bestCombo = Math.max(state.records.bestCombo, summary.bestCombo);
    state.records.bestClearRate = Math.max(state.records.bestClearRate, summary.clearRate);
    if (summary.perfectClear) {
      state.records.perfectClearCount += 1;
    }

    saveSingleRecords();
    emitMenuDataChange();
    return flags;
  }

  function cacheDom() {
    dom.board = document.getElementById("board");
    dom.boardStage = document.getElementById("boardStage");
    dom.boardFrame = document.getElementById("boardFrame");
    dom.selectionRect = document.getElementById("selectionRect");
    dom.hintRect = document.getElementById("hintRect");
    dom.timeValue = document.getElementById("timeValue");
    dom.timeBarFill = document.getElementById("timeBarFill");
    dom.scoreLabel = document.getElementById("scoreLabel");
    dom.scoreValue = document.getElementById("scoreValue");
    dom.opponentCard = document.getElementById("opponentCard");
    dom.opponentScoreLabel = document.getElementById("opponentScoreLabel");
    dom.opponentScoreValue = document.getElementById("opponentScoreValue");
    dom.modeHint = document.getElementById("modeHint");
    dom.comboChip = document.getElementById("comboChip");
    dom.recordChip = document.getElementById("recordChip");
    dom.hintBtn = document.getElementById("hintBtn");
    dom.statusToast = document.getElementById("statusToast");
    dom.rotateOverlay = document.getElementById("rotateOverlay");
    dom.settingsOverlay = document.getElementById("settingsOverlay");
    dom.gameOver = document.getElementById("gameOver");
    dom.resultCard = document.getElementById("resultCard");
    dom.resultTitle = document.getElementById("resultTitle");
    dom.resultText = document.getElementById("resultText");
    dom.resultIcon = document.getElementById("resultIcon");
    dom.resultModeBadge = document.getElementById("resultModeBadge");
    dom.resultStatePill = document.getElementById("resultStatePill");
    dom.resultMeta = document.getElementById("resultMeta");
    dom.resultMeName = document.getElementById("resultMeName");
    dom.resultOpponentName = document.getElementById("resultOpponentName");
    dom.resultMeOutcome = document.getElementById("resultMeOutcome");
    dom.resultOpponentOutcome = document.getElementById("resultOpponentOutcome");
    dom.resultStreakBadge = document.getElementById("resultStreakBadge");
    dom.finalScore = document.getElementById("finalScore");
    dom.resultStat1Label = document.getElementById("resultStat1Label");
    dom.resultStat2Label = document.getElementById("resultStat2Label");
    dom.resultStat3Label = document.getElementById("resultStat3Label");
    dom.resultStat2Value = document.getElementById("resultStat2Value");
    dom.resultStat3Value = document.getElementById("resultStat3Value");
    dom.restartBtnModal = document.getElementById("restartBtnModal");
    dom.rematchBtn = document.getElementById("rematchBtn");
    dom.startOverlay = document.getElementById("startOverlay");
    dom.roomOverlay = document.getElementById("roomOverlay");
    dom.roomCodeBox = document.getElementById("roomCodeBox");
    dom.roomPlayerList = document.getElementById("roomPlayerList");
    dom.readyBtn = document.getElementById("readyBtn");
    dom.restartBtn = document.getElementById("restartBtn");
    dom.restartBtnTop = document.getElementById("restartBtnTop");
  }

  function getSocket() {
    return App.state.socket;
  }

  function getCellKey(pos) {
    return `${pos.row}:${pos.col}`;
  }

  function isIOSDevice() {
    const userAgent = window.navigator.userAgent || "";
    const platform = window.navigator.platform || "";
    return /iPad|iPhone|iPod/i.test(userAgent)
      || (platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  }

  function canUseTouchVibration() {
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
    const hasTouch = coarsePointer || window.navigator.maxTouchPoints > 0;
    return hasTouch && typeof window.navigator.vibrate === "function" && !isIOSDevice();
  }

  function isTouchViewport() {
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
    return Boolean(coarsePointer || window.navigator.maxTouchPoints > 0);
  }

  function isLandscapeViewport() {
    return window.matchMedia?.("(orientation: landscape)")?.matches ?? (window.innerWidth >= window.innerHeight);
  }

  function shouldUseLiteEffects() {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    return Boolean(
      reducedMotion
      || isIOSDevice()
      || (isTouchViewport() && (window.innerWidth <= 1024 || window.innerHeight <= 900))
    );
  }

  function hasBlockingOverlayOpen() {
    return Boolean(
      !dom.startOverlay.classList.contains("hidden")
      || !dom.roomOverlay.classList.contains("hidden")
      || !dom.settingsOverlay.classList.contains("hidden")
      || dom.gameOver.classList.contains("show")
    );
  }

  function syncBodyUiState() {
    document.body.classList.toggle("lite-effects", shouldUseLiteEffects());
    document.body.classList.toggle("mode-menu", state.mode === "menu");
    document.body.classList.toggle("mode-single", state.mode === "single");
    document.body.classList.toggle("mode-online", state.mode === "online");
    document.body.classList.toggle("game-active", state.isGameActive);
    document.body.classList.toggle("touch-landscape", isTouchViewport() && isLandscapeViewport());
  }

  function isSingleMode() {
    return state.mode === "single";
  }

  function isOnlineMode() {
    return state.mode === "online";
  }

  function hideToast() {
    if (state.toastTimerId !== null) {
      window.clearTimeout(state.toastTimerId);
      state.toastTimerId = null;
    }

    if (!dom.statusToast) return;
    dom.statusToast.textContent = "";
    dom.statusToast.classList.add("hidden");
    dom.statusToast.classList.remove("good", "bad", "show", "sticky");
  }

  function setMessage(text, type = "", options = {}) {
    const { duration = 900, sticky = false } = options;

    if (!text) {
      hideToast();
      return;
    }

    if (state.toastTimerId !== null) {
      window.clearTimeout(state.toastTimerId);
      state.toastTimerId = null;
    }

    dom.statusToast.textContent = text;
    dom.statusToast.classList.remove("hidden", "good", "bad", "sticky");
    dom.statusToast.classList.add("show");
    if (type) dom.statusToast.classList.add(type);
    if (sticky) dom.statusToast.classList.add("sticky");

    if (!sticky) {
      state.toastTimerId = window.setTimeout(() => {
        hideToast();
      }, duration);
    }
  }

  function updateScore() {
    dom.scoreValue.textContent = String(state.score);
  }

  function updateOpponentScore(value = 0) {
    dom.opponentScoreValue.textContent = String(value);
  }

  function updateScoreboardLabels(players = null) {
    const roomPlayers = Array.isArray(players) && players.length
      ? players
      : Array.isArray(state.currentRoom?.players)
        ? state.currentRoom.players
        : [];

    let myLabel = sanitizeName(state.myName, "나");
    let opponentLabel = "상대";
    let showOpponent = false;

    if (isOnlineMode()) {
      const me = roomPlayers.find((player) => player.socketId === state.mySocketId);
      const opponent = roomPlayers.find((player) => player.socketId !== state.mySocketId);

      myLabel = sanitizeName(me?.name || state.myName, "나");
      opponentLabel = sanitizeName(opponent?.name, "상대");
      showOpponent = Boolean(opponent);
    }

    dom.scoreLabel.textContent = myLabel;
    dom.scoreLabel.title = myLabel;
    dom.opponentScoreLabel.textContent = opponentLabel;
    dom.opponentScoreLabel.title = opponentLabel;
    dom.opponentCard.classList.toggle("hidden", !showOpponent);
  }

  function updateScoresFromPlayers(players = []) {
    const me = players.find((player) => player.socketId === state.mySocketId);
    const opponent = players.find((player) => player.socketId !== state.mySocketId);

    state.score = typeof me?.score === "number" ? me.score : 0;
    updateScore();
    updateOpponentScore(typeof opponent?.score === "number" ? opponent.score : 0);
    updateScoreboardLabels(players);
  }

  function hideComboChip() {
    if (state.comboChipTimerId) {
      window.clearTimeout(state.comboChipTimerId);
      state.comboChipTimerId = null;
    }
    dom.comboChip.classList.add("hidden");
  }

  function showComboChip(combo, bonus) {
    if (combo < 2 || bonus <= 0) {
      hideComboChip();
      return;
    }

    if (state.comboChipTimerId) {
      window.clearTimeout(state.comboChipTimerId);
    }

    dom.comboChip.textContent = `콤보 x${combo} +${bonus}`;
    dom.comboChip.classList.remove("hidden");
    state.comboChipTimerId = window.setTimeout(() => {
      hideComboChip();
    }, 1800);
  }

  function updateRecordChip() {
    const shouldShow = isSingleMode() && state.isGameActive;
    dom.recordChip.classList.toggle("hidden", !shouldShow);
    if (!shouldShow) return;
    dom.recordChip.textContent = `BEST ${state.records.bestScore} · 최고 x${state.records.bestCombo}`;
  }

  function updateHintButton() {
    const show = isSingleMode() && state.isGameActive;
    dom.hintBtn.classList.toggle("hidden", !show);
    if (!show) return;

    const now = Date.now();
    const remaining = Math.max(0, state.singleStats.hintCooldownUntil - now);

    if (state.singleStats.hintUsesLeft <= 0) {
      dom.hintBtn.disabled = true;
      dom.hintBtn.textContent = "힌트 종료";
      return;
    }

    if (remaining > 0) {
      dom.hintBtn.disabled = true;
      dom.hintBtn.textContent = `힌트 ${Math.ceil(remaining / 1000)}s`;
      return;
    }

    dom.hintBtn.disabled = false;
    dom.hintBtn.textContent = `힌트 ${state.singleStats.hintUsesLeft}`;
  }

  function updateModeUI() {
    if (dom.modeHint) {
      if (state.mode === "menu") {
        dom.modeHint.textContent = "모드를 고르고 바로 시작하세요";
      } else if (isSingleMode()) {
        dom.modeHint.textContent = state.singleConfig.modeId === "timeattack"
          ? `${state.singleConfig.label} · ${state.singleConfig.duration}초`
          : state.singleConfig.label;
      } else {
        dom.modeHint.textContent = state.myRoomCode
          ? `온라인 대전 · ROOM ${state.myRoomCode}`
          : "온라인 대전";
      }
    }

    updateRecordChip();
    updateHintButton();
    updateScoreboardLabels();
  }

  function setMode(mode) {
    state.mode = mode;
    syncBodyUiState();
    updateModeUI();
  }

  function updateMobileOrientationUI() {
    syncBodyUiState();

    const isMobile = isTouchViewport() && (window.innerWidth <= MOBILE_BREAKPOINT || window.innerHeight <= MOBILE_BREAKPOINT);
    const isPortrait = window.matchMedia?.("(orientation: portrait)")?.matches ?? (window.innerHeight > window.innerWidth);
    const shouldShowRotate = isMobile && isPortrait && state.isGameActive && !hasBlockingOverlayOpen();
    dom.rotateOverlay.classList.toggle("hidden", !shouldShowRotate);
    document.body.classList.toggle("rotate-locked", shouldShowRotate);

    if (shouldShowRotate) {
      if (state.isDragging) cancelDrag(false);
      clearHintPreview();
    }
  }

  function scheduleViewportSync() {
    updateMobileOrientationUI();
    scheduleBoardLayout();

    if (state.viewportSyncTimerId !== null) {
      window.clearTimeout(state.viewportSyncTimerId);
    }

    if (state.viewportSettleTimerId !== null) {
      window.clearTimeout(state.viewportSettleTimerId);
    }

    state.viewportSyncTimerId = window.setTimeout(() => {
      state.viewportSyncTimerId = null;
      updateMobileOrientationUI();
      scheduleBoardLayout();
    }, VIEWPORT_SYNC_DELAY_MS);

    state.viewportSettleTimerId = window.setTimeout(() => {
      state.viewportSettleTimerId = null;
      updateMobileOrientationUI();
      scheduleBoardLayout();
    }, VIEWPORT_SETTLE_DELAY_MS);
  }

  function createSeededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
    return function seeded() {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function cloneBoard(board) {
    return (board || []).map((row) =>
      row.map((cell) => ({
        value: Number(cell.value) || 0,
        removed: Boolean(cell.removed)
      }))
    );
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

  function setBoard(board, rows, cols) {
    if (Number.isInteger(rows)) state.ROWS = rows;
    if (Number.isInteger(cols)) state.COLS = cols;
    state.board = cloneBoard(board);
  }

  function ensureDropLayer() {
    if (state.dropLayer && state.dropLayer.isConnected) {
      return state.dropLayer;
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
    state.dropLayer = layer;
    return layer;
  }

  function clearRemovalEffects() {
    if (state.removalEffects.size) {
      state.removalEffects.forEach((effect) => {
        if (effect?.cleanupTimerId !== null) {
          window.clearTimeout(effect.cleanupTimerId);
        }

        if (effect?.animation) {
          try {
            effect.animation.cancel();
          } catch (error) {}
        }

        effect?.ghost?.remove();
      });

      state.removalEffects.clear();
    }

    if (state.dropLayer?.replaceChildren) {
      state.dropLayer.replaceChildren();
    } else if (state.dropLayer) {
      state.dropLayer.innerHTML = "";
    }
  }

  function scheduleBoardLayout() {
    if (state.boardLayoutRaf !== null) {
      window.cancelAnimationFrame(state.boardLayoutRaf);
    }

    state.boardLayoutRaf = window.requestAnimationFrame(() => {
      state.boardLayoutRaf = null;
      applyBoardFrameSize();
      refreshBoardMetrics();

      if (state.isDragging && state.dragStart && state.dragCurrent) {
        updateSelection(state.dragStart, state.dragCurrent);
      }

      if (state.hintPreview) {
        paintHintPreview(state.hintPreview);
      }
    });
  }

  function applyBoardFrameSize() {
    if (!dom.boardStage || !dom.boardFrame) return;

    const stageRect = dom.boardStage.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return;

    const ratio = state.COLS / state.ROWS;
    let width = stageRect.width;
    let height = width / ratio;

    if (height > stageRect.height) {
      height = stageRect.height;
      width = height * ratio;
    }

    const safeWidth = Math.max(10, Math.floor(width));
    const safeHeight = Math.max(10, Math.floor(height));
    const framePad = clamp(Math.round(Math.min(safeWidth, safeHeight) * 0.022), 6, 14);
    const hasFrameResize =
      Math.abs(state.boardFrameSize.width - safeWidth) > 1
      || Math.abs(state.boardFrameSize.height - safeHeight) > 1;

    if (hasFrameResize && state.removalEffects.size) {
      clearRemovalEffects();
    }

    dom.boardFrame.style.width = `${safeWidth}px`;
    dom.boardFrame.style.height = `${safeHeight}px`;
    dom.boardFrame.style.setProperty("--frame-pad", `${framePad}px`);
    state.boardFrameSize.width = safeWidth;
    state.boardFrameSize.height = safeHeight;
  }

  function refreshBoardMetrics() {
    if (!dom.board || !dom.boardFrame) return;

    const frameRect = dom.boardFrame.getBoundingClientRect();
    const boardRect = dom.board.getBoundingClientRect();
    if (!boardRect.width || !boardRect.height) return;

    const cellBase = Math.min(boardRect.width / state.COLS, boardRect.height / state.ROWS);
    const gap = clamp(Math.round(cellBase * 0.065), 2, 6);

    dom.board.style.gap = `${gap}px`;

    const finalRect = dom.board.getBoundingClientRect();
    const cellWidth = (finalRect.width - gap * (state.COLS - 1)) / state.COLS;
    const cellHeight = (finalRect.height - gap * (state.ROWS - 1)) / state.ROWS;
    const cellMin = Math.min(cellWidth, cellHeight);

    state.layout = {
      boardRect: finalRect,
      boardOffsetLeft: finalRect.left - frameRect.left,
      boardOffsetTop: finalRect.top - frameRect.top,
      gapX: gap,
      gapY: gap,
      cellWidth,
      cellHeight,
      cellSpanX: cellWidth + gap,
      cellSpanY: cellHeight + gap,
      hitPaddingX: clamp(cellWidth * 0.45, 10, 24),
      hitPaddingY: clamp(cellHeight * 0.45, 10, 24)
    };

    dom.boardFrame.style.setProperty("--cell-gap", `${gap}px`);
    dom.boardFrame.style.setProperty("--cell-min", `${cellMin}px`);
    dom.boardFrame.style.setProperty("--grid-step", `${Math.round(cellMin * 0.6)}px`);
  }

  function resetCellHighlight(cell) {
    if (!cell) return;
    cell.classList.remove("selected", "good", "hint-preview", "drag-entry");

    const apple = cell._appleEl;
    if (apple) {
      apple.style.transform = "";
      apple.style.transition = "";
    }
  }

  function ensureBoardGrid() {
    const needsRebuild =
      state.cellEls.length !== state.ROWS ||
      !state.cellEls[0] ||
      state.cellEls[0].length !== state.COLS;

    dom.board.style.gridTemplateColumns = `repeat(${state.COLS}, 1fr)`;
    dom.board.style.gridTemplateRows = `repeat(${state.ROWS}, 1fr)`;

    if (!needsRebuild) {
      scheduleBoardLayout();
      return;
    }

    clearRemovalEffects();
    dom.board.innerHTML = "";
    state.cellEls = [];
    state.highlightedCells = [];
    state.hintCells = [];
    state.lastSelectionSignature = "";
    state.lastSelectionIsGood = false;

    for (let row = 0; row < state.ROWS; row += 1) {
      const rowEls = [];
      for (let col = 0; col < state.COLS; col += 1) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.innerHTML = `
          <div class="apple" aria-hidden="true">
            <span class="apple-stem"></span>
            <span class="apple-leaf"></span>
            <span class="apple-body"></span>
            <span class="apple-notch"></span>
            <span class="apple-glow"></span>
            <span class="apple-num">${state.board[row][col].value}</span>
          </div>
        `;
        cell._appleEl = cell.querySelector(".apple");
        cell._appleNumEl = cell.querySelector(".apple-num");
        dom.board.appendChild(cell);
        rowEls.push(cell);
      }
      state.cellEls.push(rowEls);
    }

    scheduleBoardLayout();
  }

  function syncBoardVisuals() {
    ensureBoardGrid();

    for (let row = 0; row < state.ROWS; row += 1) {
      for (let col = 0; col < state.COLS; col += 1) {
        const cell = state.cellEls[row][col];
        const cellData = state.board[row][col];
        const appleNum = cell._appleNumEl;

        resetCellHighlight(cell);

        if (appleNum) {
          appleNum.textContent = String(cellData.value);
        }

        if (cellData.removed) {
          cell.classList.add("removed");
          cell.classList.remove("dropping");
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
    scheduleBoardLayout();
  }

  function clearSelectionVisuals() {
    state.highlightedCells.forEach((cell) => {
      cell?.classList.remove("selected", "good");
    });
    state.highlightedCells = [];

    dom.selectionRect.style.display = "none";
    dom.selectionRect.classList.remove("good");
  }

  function clearHintPreview() {
    if (state.hintPreviewTimerId) {
      window.clearTimeout(state.hintPreviewTimerId);
      state.hintPreviewTimerId = null;
    }

    state.hintPreview = null;
    dom.hintRect.style.display = "none";
    state.hintCells.forEach((cell) => {
      cell?.classList.remove("hint-preview");
    });
    state.hintCells = [];
  }

  function paintSelectedCells(isGood) {
    clearSelectionVisuals();

    for (const pos of state.selectedPositions) {
      if (!state.board[pos.row][pos.col].removed) {
        const cell = state.cellEls[pos.row][pos.col];
        cell.classList.add("selected");
        if (isGood) cell.classList.add("good");
        state.highlightedCells.push(cell);
      }
    }
  }

  function updateSelectionRect(target, minRow, minCol, maxRow, maxCol, className = "") {
    if (!state.layout) {
      refreshBoardMetrics();
    }

    const layout = state.layout;
    if (!layout) return;

    const left = layout.boardOffsetLeft + (minCol * layout.cellSpanX);
    const top = layout.boardOffsetTop + (minRow * layout.cellSpanY);
    const width = layout.cellWidth + ((maxCol - minCol) * layout.cellSpanX);
    const height = layout.cellHeight + ((maxRow - minRow) * layout.cellSpanY);

    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    target.style.display = "block";
    if (target === dom.selectionRect) {
      target.classList.toggle("good", className === "good");
    }
  }

  function paintHintPreview(preview) {
    if (!preview) return;
    clearHintPreview();
    state.hintPreview = preview;

    preview.positions.forEach((pos) => {
      const cell = state.cellEls[pos.row]?.[pos.col];
      cell?.classList.add("hint-preview");
      if (cell) state.hintCells.push(cell);
    });

    updateSelectionRect(
      dom.hintRect,
      preview.minRow,
      preview.minCol,
      preview.maxRow,
      preview.maxCol
    );

    state.hintPreviewTimerId = window.setTimeout(() => {
      clearHintPreview();
    }, HINT_DURATION_MS);
  }

  function getCellFromClient(clientX, clientY, options = {}) {
    const { clampToBoard = false, forgiving = false } = options;

    if (!state.layout?.boardRect) {
      refreshBoardMetrics();
    }

    const layout = state.layout;
    if (!layout?.boardRect) return null;

    const boundsX = forgiving ? layout.hitPaddingX : 0;
    const boundsY = forgiving ? layout.hitPaddingY : 0;

    let x = clientX - layout.boardRect.left;
    let y = clientY - layout.boardRect.top;

    if (!clampToBoard) {
      const outsideX = x < -boundsX || x > layout.boardRect.width + boundsX;
      const outsideY = y < -boundsY || y > layout.boardRect.height + boundsY;
      if (outsideX || outsideY) return null;
    }

    x = clamp(x, 0, Math.max(0, layout.boardRect.width - 1));
    y = clamp(y, 0, Math.max(0, layout.boardRect.height - 1));

    const col = clamp(
      Math.round((x - (layout.cellWidth / 2)) / layout.cellSpanX),
      0,
      state.COLS - 1
    );
    const row = clamp(
      Math.round((y - (layout.cellHeight / 2)) / layout.cellSpanY),
      0,
      state.ROWS - 1
    );

    return { row, col };
  }

  function updateSelection(start, end) {
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);
    const signature = `${minRow}:${minCol}:${maxRow}:${maxCol}`;

    if (signature === state.lastSelectionSignature) {
      updateSelectionRect(dom.selectionRect, minRow, minCol, maxRow, maxCol, state.lastSelectionIsGood ? "good" : "");
      return;
    }

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
    state.lastSelectionSignature = signature;
    state.lastSelectionIsGood = isGood;
    updateSelectionRect(dom.selectionRect, minRow, minCol, maxRow, maxCol, isGood ? "good" : "");
  }

  function cancelDrag(clearToast = false) {
    if (state.pendingSelectionRaf !== null) {
      window.cancelAnimationFrame(state.pendingSelectionRaf);
      state.pendingSelectionRaf = null;
    }

    state.isDragging = false;
    state.activePointerId = null;
    state.dragStart = null;
    state.dragCurrent = null;
    state.queuedDragPos = null;
    state.selectedPositions = [];
    state.dragVisitedKeys = new Set();
    state.lastDragFeedbackAt = 0;
    state.lastSelectionSignature = "";
    state.lastSelectionIsGood = false;
    clearSelectionVisuals();

    if (clearToast) {
      hideToast();
    }
  }

  function triggerDragEntryFeedback(pos, options = {}) {
    if (!pos) return;

    const { force = false } = options;
    const cellData = state.board[pos.row]?.[pos.col];
    if (!cellData || cellData.removed) return;

    const key = getCellKey(pos);
    if (!force && state.dragVisitedKeys.has(key)) return;
    state.dragVisitedKeys.add(key);

    const cell = state.cellEls[pos.row]?.[pos.col];
    if (!cell) return;

    if (!shouldUseLiteEffects()) {
      if (cell._dragEntryTimer) {
        window.clearTimeout(cell._dragEntryTimer);
      }

      cell.classList.add("drag-entry");
      cell._dragEntryTimer = window.setTimeout(() => {
        cell.classList.remove("drag-entry");
        cell._dragEntryTimer = null;
      }, 96);
    }

    const now = performance.now();
    if (now - state.lastDragFeedbackAt < DRAG_FEEDBACK_THROTTLE_MS) return;

    state.lastDragFeedbackAt = now;
    App.audio.playSelectSound();

    if (canUseTouchVibration()) {
      try {
        window.navigator.vibrate(12);
      } catch (error) {}
    }
  }

  function flushQueuedSelection() {
    if (state.pendingSelectionRaf !== null) {
      window.cancelAnimationFrame(state.pendingSelectionRaf);
      state.pendingSelectionRaf = null;
    }

    if (!state.isDragging || !state.dragStart || !state.queuedDragPos) {
      state.queuedDragPos = null;
      return;
    }

    const nextPos = state.queuedDragPos;
    state.queuedDragPos = null;
    state.dragCurrent = nextPos;
    triggerDragEntryFeedback(nextPos);
    updateSelection(state.dragStart, nextPos);
  }

  function queueSelectionUpdate(nextPos) {
    state.queuedDragPos = nextPos;
    if (state.pendingSelectionRaf !== null) return;

    state.pendingSelectionRaf = window.requestAnimationFrame(() => {
      state.pendingSelectionRaf = null;
      flushQueuedSelection();
    });
  }

  function cubicCurve(t, p0, p1, p2, p3) {
    const omt = 1 - t;
    return (omt * omt * omt * p0)
      + (3 * omt * omt * t * p1)
      + (3 * omt * t * t * p2)
      + (t * t * t * p3);
  }

  function animateRemoval(positions) {
    if (!Array.isArray(positions) || positions.length === 0) return;

    const dropLayer = ensureDropLayer();
    if (!dropLayer || !dom.boardFrame) return;

    const frameRect = dom.boardFrame.getBoundingClientRect();
    if (!frameRect.width || !frameRect.height) return;

    const boardHeight = dom.boardFrame.clientHeight || dom.board.clientHeight || 600;
    const liteEffects = shouldUseLiteEffects();
    const maxGhosts = Math.min(positions.length, liteEffects ? 6 : 18);
    const sampleStep = Math.max(1, Math.ceil(positions.length / Math.max(1, maxGhosts)));
    const sampled = [];

    if (state.removalEffects.size > (liteEffects ? 14 : 28)) {
      clearRemovalEffects();
    }

    positions.forEach((pos, index) => {
      if (liteEffects && index % sampleStep !== 0) return;

      const cell = state.cellEls[pos.row]?.[pos.col];
      const apple = cell?._appleEl;
      if (!cell || !apple) return;

      const appleRect = apple.getBoundingClientRect();
      if (!appleRect.width || !appleRect.height) return;
      sampled.push({
        pos,
        order: sampled.length,
        appleRect
      });
    });

    if (sampled.length === 0) return;

    const fragment = document.createDocumentFragment();
    const plannedEffects = [];
    const sampleCount = liteEffects ? 8 : 10;

    sampled.forEach(({ pos, order, appleRect }) => {
      const sourceApple = state.cellEls[pos.row]?.[pos.col]?._appleEl;
      if (!sourceApple) return;

      const ghost = sourceApple.cloneNode(true);
      if (liteEffects) {
        ghost.querySelector(".apple-glow")?.remove();
        ghost.querySelector(".apple-notch")?.remove();
      }

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
        transition: "none",
        willChange: "transform, opacity",
        contain: "layout paint",
        backfaceVisibility: "hidden",
        zIndex: "0"
      });

      fragment.appendChild(ghost);

      const centerBias = (pos.col - ((state.COLS - 1) / 2)) / (((state.COLS - 1) / 2) || 1);
      const direction = Math.random() < 0.5 ? -1 : 1;
      const riseY = clamp(
        appleRect.height * (liteEffects ? 0.94 : 1.1),
        liteEffects ? 24 : 32,
        liteEffects ? 42 : 58
      );
      const prepY = clamp(appleRect.height * 0.14, 4, 9);
      const driftX = (direction * (liteEffects
        ? clamp(appleRect.width * 0.42, 10, 18)
        : clamp(appleRect.width * 0.52, 14, 24))) + (centerBias * (liteEffects ? 3 : 5));
      const fallY = boardHeight + appleRect.height + (liteEffects ? 74 : 112) + (Math.random() * (liteEffects ? 16 : 26));
      const delay = liteEffects ? Math.min(order * 16, 72) : Math.min(order * 14, 96);
      const duration = liteEffects ? 720 + Math.min(order * 20, 108) : 980 + Math.min(order * 22, 176);
      const apexAt = liteEffects ? 0.34 : 0.36;
      const gravity = (2 * (riseY + (apexAt * fallY))) / (apexAt * (1 - apexAt));
      const launchVelocity = fallY - (0.5 * gravity);
      const baseRotation = driftX * (liteEffects ? 0.12 : 0.16);
      const keyframes = [];

      for (let step = 0; step <= sampleCount; step += 1) {
        const t = step / sampleCount;
        let x = 0;
        let y = 0;
        let scale = 1;
        let opacity = 1;
        let rotation = 0;

        if (t <= 0.08) {
          const prepProgress = t / 0.08;
          const easedPrep = 1 - Math.pow(1 - prepProgress, 3);
          x = driftX * 0.03 * easedPrep;
          y = prepY * easedPrep;
          scale = 1 - (0.06 * easedPrep);
          rotation = baseRotation * 0.08 * easedPrep;
          opacity = 1;
        } else {
          const u = (t - 0.08) / 0.92;
          const ballisticY = prepY + (launchVelocity * u) + (0.5 * gravity * u * u);
          const horizontalProgress = 0.18 * u + 0.82 * (u * u);
          const descendProgress = clamp((u - 0.54) / 0.46, 0, 1);
          const ascendProgress = clamp(u / apexAt, 0, 1);

          x = driftX * horizontalProgress;
          y = ballisticY;
          rotation = baseRotation * (0.22 * u + 0.78 * u * u);
          scale = u < apexAt
            ? 0.94 + (0.08 * ascendProgress)
            : 1.02 - (0.17 * descendProgress);
          opacity = u < 0.58
            ? 1
            : 1 - Math.pow((u - 0.58) / 0.42, 1.35);
        }

        keyframes.push({
          offset: Number(t.toFixed(4)),
          transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(3)})`,
          opacity: clamp(opacity, 0, 1)
        });
      }

      const effect = {
        ghost,
        animation: null,
        cleanupTimerId: null
      };

      const cleanupEffect = () => {
        if (!state.removalEffects.has(effect)) return;

        state.removalEffects.delete(effect);

        if (effect.cleanupTimerId !== null) {
          window.clearTimeout(effect.cleanupTimerId);
          effect.cleanupTimerId = null;
        }

        if (effect.animation) {
          try {
            effect.animation.cancel();
          } catch (error) {}
          effect.animation = null;
        }

        effect.ghost?.remove();
      };

      state.removalEffects.add(effect);

      if (typeof ghost.animate !== "function") {
        cleanupEffect();
        return;
      }

      plannedEffects.push({
        effect,
        cleanupEffect,
        keyframes,
        options: {
          delay,
          duration,
          easing: "linear",
          fill: "forwards"
        }
      });
    });

    dropLayer.appendChild(fragment);

    window.requestAnimationFrame(() => {
      plannedEffects.forEach(({ effect, cleanupEffect, keyframes, options }) => {
        if (!state.removalEffects.has(effect) || !effect.ghost?.isConnected) return;

        const animation = effect.ghost.animate(keyframes, options);
        effect.animation = animation;
        effect.cleanupTimerId = window.setTimeout(
          cleanupEffect,
          Number(options.delay || 0) + Number(options.duration || 0) + 320
        );

        animation.finished
          .catch(() => {})
          .finally(cleanupEffect);
      });
    });
  }

  function resetSingleStats() {
    state.singleStats = {
      removedCount: 0,
      currentCombo: 0,
      bestCombo: 0,
      lastClearAt: 0,
      perfectClear: false,
      hintUsesLeft: HINT_MAX_USES,
      hintCooldownUntil: 0
    };
    hideComboChip();
    clearHintPreview();
    updateHintButton();
  }

  function resetPlayState() {
    if (state.pendingSelectionRaf !== null) {
      window.cancelAnimationFrame(state.pendingSelectionRaf);
      state.pendingSelectionRaf = null;
    }

    state.isGameActive = false;
    state.isDragging = false;
    state.isResolving = false;
    state.activePointerId = null;
    state.dragStart = null;
    state.dragCurrent = null;
    state.queuedDragPos = null;
    state.selectedPositions = [];
    state.dragVisitedKeys = new Set();
    state.lastDragFeedbackAt = 0;
    state.lastSelectionSignature = "";
    state.lastSelectionIsGood = false;
    clearRemovalEffects();
    clearHintPreview();
    clearSelectionVisuals();
    hideComboChip();
    syncBodyUiState();
  }

  function clearTimer() {
    if (state.timerId !== null) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function computeTimeLeft() {
    if (!state.endsAt) return state.timeLeft;
    return Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
  }

  function updateTime() {
    state.timeLeft = computeTimeLeft();
    dom.timeValue.textContent = String(state.timeLeft);
    const ratio = clamp(state.timeLeft / state.DURATION, 0, 1);
    dom.timeBarFill.style.width = `${ratio * 100}%`;
    dom.timeValue.classList.toggle("time-warning", state.timeLeft <= 10);
    updateHintButton();
  }

  function hideGameOver() {
    dom.gameOver.classList.remove("show");
    scheduleViewportSync();
  }

  function applyResultScreen(config) {
    const resultClass = config.resultClass || "result-neutral";
    const meName = sanitizeName(config.meName || state.myName, "나");
    const opponentName = sanitizeName(config.opponentName, config.showRematch ? "상대" : "기록");
    const meOutcome = String(config.meOutcome || (config.showRematch ? "PLAYER" : "FINISH"));
    const opponentOutcome = String(config.opponentOutcome || (config.showRematch ? "OPPONENT" : "RECORD"));
    const streakText = String(config.streakText || "");

    dom.resultCard.className = `game-over-card ${resultClass}`;
    dom.resultCard.dataset.flow = config.showRematch ? "online" : "single";
    dom.resultModeBadge.textContent = config.modeBadge || "RESULT";
    dom.resultStatePill.textContent = config.stateBadge || "RESULT";
    dom.resultIcon.textContent = config.icon || "★";
    dom.resultTitle.textContent = config.title || "게임 종료";
    dom.resultText.textContent = config.text || "";
    dom.resultMeta.textContent = config.meta || "";
    dom.resultMeName.textContent = meName;
    dom.resultOpponentName.textContent = opponentName;
    dom.resultMeOutcome.textContent = meOutcome;
    dom.resultOpponentOutcome.textContent = opponentOutcome;
    dom.resultStreakBadge.textContent = streakText;
    dom.resultStreakBadge.classList.toggle("hidden", !streakText);
    dom.resultStat1Label.textContent = config.stat1Label || "점수";
    dom.finalScore.textContent = String(config.stat1Value ?? 0);
    dom.resultStat2Label.textContent = config.stat2Label || "최고 콤보";
    dom.resultStat2Value.textContent = String(config.stat2Value ?? "x0");
    dom.resultStat3Label.textContent = config.stat3Label || "클리어율";
    dom.resultStat3Value.textContent = String(config.stat3Value ?? "0%");
    dom.restartBtnModal.classList.toggle("hidden", !config.showRestart);
    dom.rematchBtn.classList.toggle("hidden", !config.showRematch);
    if (config.rematchText) {
      dom.rematchBtn.textContent = config.rematchText;
    }
  }

  function showGameOver(config) {
    applyResultScreen(config);
    dom.resultCard.scrollTop = 0;
    dom.gameOver.scrollTop = 0;
    dom.gameOver.classList.add("show");
    scheduleViewportSync();
  }

  function prepareGameStart() {
    resetPlayState();
    state.isGameActive = true;
    hideGameOver();
    hideToast();
    clearSelectionVisuals();
    syncBodyUiState();
    updateModeUI();
  }

  function updateOnlineRematchState() {
    if (!isOnlineMode() || !dom.gameOver.classList.contains("show") || dom.rematchBtn.classList.contains("hidden")) {
      return;
    }

    const players = state.currentRoom?.players || [];
    const me = players.find((player) => player.socketId === state.mySocketId);
    const readyCount = players.filter((player) => player.ready).length;
    const myReady = Boolean(me?.ready);

    dom.rematchBtn.textContent = myReady ? "재대결 취소" : "재대결";

    if (players.length < 2) {
      dom.resultMeta.textContent = "상대가 떠나면 대기실로 돌아갑니다.";
      return;
    }

    if (myReady) {
      dom.resultMeta.textContent = `재대결 대기 중 (${readyCount}/2)`;
      return;
    }

    dom.resultMeta.textContent = readyCount > 0
      ? `상대가 재대결을 준비했습니다 (${readyCount}/2)`
      : "둘 다 재대결을 누르면 같은 방에서 바로 다음 판이 시작됩니다.";
  }

  function renderRoom(room) {
    state.currentRoom = room;
    if (dom.roomCodeBox) {
      dom.roomCodeBox.textContent = room.code;
    }

    dom.roomPlayerList.innerHTML = room.players
      .map((player) => {
        const readyClass = player.ready ? "ready" : "not-ready";
        const readyText = player.ready ? "준비 완료" : "대기 중";
        const name = `${player.name}${player.socketId === state.mySocketId ? " (나)" : ""}`;
        return `
          <div class="room-player-item">
            <span class="room-player-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="${readyClass}">${readyText}</span>
          </div>
        `;
      })
      .join("");

    const me = room.players.find((player) => player.socketId === state.mySocketId);
    const opponent = room.players.find((player) => player.socketId !== state.mySocketId);

    updateOpponentScore(opponent && typeof opponent.score === "number" ? opponent.score : 0);
    updateScoreboardLabels(room.players);
    dom.readyBtn.textContent = me && me.ready ? "준비 취소" : "준비하기";
    updateOnlineRematchState();
  }

  function showLobbyError(text) {
    const errorEl = document.getElementById("lobbyError");
    if (errorEl) errorEl.textContent = text || "";
  }

  function isBoardFullyRemovedLocal(board = state.board) {
    for (const row of board) {
      for (const cell of row) {
        if (!cell.removed) return false;
      }
    }
    return true;
  }

  function findHintRange() {
    const rows = state.ROWS;
    const cols = state.COLS;
    const sumPrefix = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
    const countPrefix = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const activeValue = state.board[row][col].removed ? 0 : state.board[row][col].value;
        const activeCount = state.board[row][col].removed ? 0 : 1;
        sumPrefix[row + 1][col + 1] =
          sumPrefix[row][col + 1] + sumPrefix[row + 1][col] - sumPrefix[row][col] + activeValue;
        countPrefix[row + 1][col + 1] =
          countPrefix[row][col + 1] + countPrefix[row + 1][col] - countPrefix[row][col] + activeCount;
      }
    }

    const getRect = (prefix, minRow, minCol, maxRow, maxCol) =>
      prefix[maxRow + 1][maxCol + 1]
      - prefix[minRow][maxCol + 1]
      - prefix[maxRow + 1][minCol]
      + prefix[minRow][minCol];

    for (let minRow = 0; minRow < rows; minRow += 1) {
      for (let minCol = 0; minCol < cols; minCol += 1) {
        for (let maxRow = minRow; maxRow < rows; maxRow += 1) {
          for (let maxCol = minCol; maxCol < cols; maxCol += 1) {
            const activeCount = getRect(countPrefix, minRow, minCol, maxRow, maxCol);
            if (!activeCount) continue;
            const activeSum = getRect(sumPrefix, minRow, minCol, maxRow, maxCol);
            if (activeSum !== 10) continue;

            const positions = [];
            for (let row = minRow; row <= maxRow; row += 1) {
              for (let col = minCol; col <= maxCol; col += 1) {
                if (!state.board[row][col].removed) {
                  positions.push({ row, col });
                }
              }
            }

            if (positions.length > 0) {
              return { minRow, minCol, maxRow, maxCol, positions };
            }
          }
        }
      }
    }

    return null;
  }

  function useHint() {
    if (!isSingleMode() || !state.isGameActive) return;

    const now = Date.now();
    if (state.singleStats.hintUsesLeft <= 0) {
      setMessage("이번 판의 힌트는 모두 사용했어요.", "bad");
      return;
    }

    if (state.singleStats.hintCooldownUntil > now) {
      setMessage(`힌트는 ${Math.ceil((state.singleStats.hintCooldownUntil - now) / 1000)}초 뒤에 다시 사용할 수 있어요.`, "bad");
      return;
    }

    const hint = findHintRange();
    if (!hint) {
      setMessage("지금 보드에는 표시할 힌트가 없어요.", "bad");
      return;
    }

    state.singleStats.hintUsesLeft -= 1;
    state.singleStats.hintCooldownUntil = now + HINT_COOLDOWN_MS;
    paintHintPreview(hint);
    updateHintButton();
    setMessage("가능한 합 10 범위를 표시했어요.", "good", { duration: 1200 });
  }

  function buildSingleSummary() {
    const clearRate = Math.round((state.singleStats.removedCount / getSingleCellCount()) * 100);
    return {
      score: state.score,
      bestCombo: state.singleStats.bestCombo,
      clearRate,
      perfectClear: state.singleStats.perfectClear
    };
  }

  function finishSingleGame(reason = "timeup") {
    clearTimer();
    state.isGameActive = false;
    state.isResolving = false;
    cancelDrag(false);
    syncBodyUiState();
    updateHintButton();

    const summary = buildSingleSummary();
    const recordFlags = persistSingleRecords(summary);

    if (state.singleConfig.modeId === "daily" && state.singleConfig.dailyKey) {
      markDailyPlayed(state.singleConfig.dailyKey);
    }

    let resultClass = "result-draw";
    let icon = "⌛";
    let title = "시간 종료";
    let text = "이번 판이 종료되었습니다.";
    let resultSound = "draw";

    if (reason === "perfectClear") {
      resultClass = "result-clear";
      icon = "👑";
      title = "퍼펙트 클리어";
      text = `보드를 모두 지우고 보너스 +${PERFECT_CLEAR_BONUS}점을 획득했어요.`;
      resultSound = "win";
    }

    const notes = [];
    if (recordFlags.bestScore) notes.push("새 최고 점수");
    if (recordFlags.bestCombo) notes.push("새 최고 콤보");
    if (recordFlags.bestClearRate) notes.push("새 최고 클리어율");
    if (recordFlags.perfectClear) notes.push("퍼펙트 기록 갱신");

    showGameOver({
      resultClass,
      modeBadge: state.singleConfig.label,
      stateBadge: reason === "perfectClear" ? "PERFECT" : "RESULT",
      icon,
      title,
      text,
      meta: notes.length ? notes.join(" · ") : "싱글 최고기록은 시작 화면에도 바로 반영됩니다.",
      meName: state.myName || "나",
      opponentName: reason === "perfectClear" ? "퍼펙트" : "오늘 기록",
      meOutcome: reason === "perfectClear" ? "CLEAR" : "FINISH",
      opponentOutcome: notes.length ? "NEW" : "DONE",
      streakText: reason === "perfectClear" ? "보너스 +80" : "",
      stat1Label: "점수",
      stat1Value: summary.score,
      stat2Label: "최고 콤보",
      stat2Value: `x${summary.bestCombo}`,
      stat3Label: "클리어율",
      stat3Value: `${summary.clearRate}%`,
      showRestart: true,
      showRematch: false
    });

    App.audio.playResultSound(resultSound);
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
        }
      }
    }, 200);
  }

  async function applyLocalSelection(positions) {
    positions.forEach(({ row, col }) => {
      state.board[row][col].removed = true;
    });

    const now = Date.now();
    const baseScore = positions.length;
    state.singleStats.removedCount += baseScore;
    state.singleStats.currentCombo =
      now - state.singleStats.lastClearAt <= COMBO_WINDOW_MS
        ? state.singleStats.currentCombo + 1
        : 1;
    state.singleStats.lastClearAt = now;
    state.singleStats.bestCombo = Math.max(state.singleStats.bestCombo, state.singleStats.currentCombo);

    const comboBonus = state.singleStats.currentCombo >= 2 ? state.singleStats.currentCombo * 2 : 0;
    state.score += baseScore + comboBonus;
    updateScore();
    updateRecordChip();
    showComboChip(state.singleStats.currentCombo, comboBonus);

    App.audio.playSuccessSound();
    animateRemoval(positions);
    syncBoardVisuals();
    scheduleBoardLayout();
    state.isResolving = false;

    if (isBoardFullyRemovedLocal()) {
      state.singleStats.perfectClear = true;
      state.score += PERFECT_CLEAR_BONUS;
      updateScore();
      updateRecordChip();
      setMessage(`퍼펙트 클리어 +${PERFECT_CLEAR_BONUS}`, "good", { duration: 1300 });
      finishSingleGame("perfectClear");
    }
  }

  async function resolveSelection() {
    const validPositions = state.selectedPositions.filter((pos) => !state.board[pos.row][pos.col].removed);
    const sum = validPositions.reduce((acc, pos) => acc + state.board[pos.row][pos.col].value, 0);
    const socket = getSocket();

    if (validPositions.length === 0) {
      cancelDrag(false);
      return;
    }

    if (sum !== 10) {
      App.audio.playFailSound();
      cancelDrag(false);
      return;
    }

    if (!state.dragStart || !state.dragCurrent) {
      cancelDrag(false);
      return;
    }

    state.isResolving = true;

    if (isSingleMode()) {
      cancelDrag(false);
      await applyLocalSelection(validPositions);
      return;
    }

    if (!socket) {
      cancelDrag(false);
      state.isResolving = false;
      return;
    }

    const payload = {
      start: state.dragStart,
      end: state.dragCurrent
    };

    cancelDrag(false);

    socket.emit("game:attemptSelect", payload, (response) => {
      if (response?.ok) return;
      state.isResolving = false;
      App.audio.playFailSound();
    });
  }

  async function handleBoardUpdate({ board, players, removedPositions = [], bySocketId = null, endsAt = null } = {}) {
    if (!Array.isArray(board)) return;

    const positions = Array.isArray(removedPositions) ? removedPositions : [];
    const wasDragging = state.isDragging;
    const oldRows = state.ROWS;
    const oldCols = state.COLS;

    setBoard(board, board.length || state.ROWS, board[0]?.length || state.COLS);

    if (typeof endsAt === "number") {
      state.endsAt = endsAt;
    }

    if (Array.isArray(players) && players.length) {
      state.currentRoom = {
        ...(state.currentRoom || {}),
        players
      };
    }

    updateScoresFromPlayers(players || []);

    if (wasDragging) {
      cancelDrag(false);
    } else {
      clearSelectionVisuals();
    }

    clearHintPreview();

    if (oldRows !== state.ROWS || oldCols !== state.COLS || state.cellEls.length === 0) {
      renderBoard();
      state.isResolving = false;
      return;
    }

    if (positions.length > 0) {
      if (bySocketId && bySocketId === state.mySocketId) {
        App.audio.playSuccessSound();
      }
      animateRemoval(positions);
    }

    syncBoardVisuals();
    scheduleBoardLayout();
    state.isResolving = false;
  }

  function buildSingleConfig(options = {}) {
    const preset = SINGLE_MODE_PRESETS[options.modeId] || SINGLE_MODE_PRESETS.classic;
    const seed = Number.isFinite(Number(options.seed))
      ? Number(options.seed)
      : Math.floor(Math.random() * 1000000000);

    return {
      modeId: options.modeId || "classic",
      label: String(options.label || preset.label),
      duration: Number.isFinite(Number(options.duration)) ? Number(options.duration) : preset.duration,
      seed,
      dailyKey: String(options.dailyKey || "")
    };
  }

  function startSingleGame(options = {}) {
    const config = buildSingleConfig(options);

    setMode("single");
    state.singleConfig = config;
    state.lastSingleSeed = config.seed;
    state.currentRoom = null;
    state.mySocketId = "single-player";
    state.myName = sanitizeName(options.playerName, "나");
    state.myRoomCode = "";
    state.ROWS = DEFAULT_ROWS;
    state.COLS = DEFAULT_COLS;
    state.DURATION = config.duration;
    state.endsAt = Date.now() + (state.DURATION * 1000);
    state.score = 0;

    resetSingleStats();
    updateScore();
    updateOpponentScore(0);
    updateScoreboardLabels();
    dom.startOverlay.classList.add("hidden");
    dom.roomOverlay.classList.add("hidden");

    prepareGameStart();
    setBoard(createPreviewBoard(config.seed), state.ROWS, state.COLS);
    renderBoard();
    updateTime();
    startTimer();
    scheduleViewportSync();
    App.audio.ensureAudio();
    App.audio.playStartSound();
  }

  function restartSingleGame() {
    const options = {
      playerName: state.myName || "나",
      modeId: state.singleConfig.modeId,
      label: state.singleConfig.label,
      duration: state.singleConfig.duration,
      seed: state.singleConfig.modeId === "daily" ? state.singleConfig.seed : undefined,
      dailyKey: state.singleConfig.dailyKey
    };
    startSingleGame(options);
  }

  function startSharedGame({ board, rows, cols, duration, endsAt, players } = {}) {
    setMode("online");
    state.ROWS = rows || state.ROWS;
    state.COLS = cols || state.COLS;
    state.DURATION = duration || state.DURATION;
    state.endsAt = typeof endsAt === "number" ? endsAt : Date.now() + (state.DURATION * 1000);
    state.currentRoom = {
      ...(state.currentRoom || {}),
      players: Array.isArray(players) ? players : state.currentRoom?.players || [],
      gameStarted: true,
      gameEnded: false
    };

    prepareGameStart();
    setBoard(board || state.board, state.ROWS, state.COLS);
    updateScoresFromPlayers(players || []);
    renderBoard();
    updateTime();
    startTimer();
    scheduleViewportSync();
  }

  function handleGameStart(payload) {
    App.audio.ensureAudio();
    App.audio.playStartSound();
    dom.roomOverlay.classList.add("hidden");
    hideToast();
    startSharedGame(payload);
    scheduleViewportSync();
  }

  function handleGameResult(result) {
    if (isSingleMode()) return;

    App.audio.ensureAudio();
    state.isGameActive = false;
    state.isResolving = false;
    clearTimer();
    cancelDrag(false);
    clearHintPreview();
    hideToast();
    syncBodyUiState();

    const myScoreEntry = result.scores.find((entry) => entry.socketId === state.mySocketId);
    const opponentEntry = result.scores.find((entry) => entry.socketId !== state.mySocketId);
    const winnerEntry = result.scores.find((entry) => entry.socketId === result.winnerSocketId);

    if (myScoreEntry) {
      state.score = myScoreEntry.score;
      updateScore();
    }
    updateOpponentScore(opponentEntry?.score || 0);

    if (state.currentRoom) {
      state.currentRoom = {
        ...state.currentRoom,
        gameStarted: false,
        gameEnded: true,
        players: (state.currentRoom.players || []).map((player) => ({
          ...player,
          ready: false,
          score: result.scores.find((entry) => entry.socketId === player.socketId)?.score || 0
        }))
      };
    }

    let resultClass = "result-draw";
    let icon = "🤝";
    let title = "무승부";
    let text = "점수가 같아서 비겼습니다.";
    let sound = "draw";
    let meOutcome = "DRAW";
    let opponentOutcome = "DRAW";

    if (!result.draw && winnerEntry?.socketId === state.mySocketId) {
      resultClass = "result-win";
      icon = "🏆";
      title = "승리";
      text = "상대보다 높은 점수로 이번 판을 가져왔어요.";
      sound = "win";
      meOutcome = "WIN";
      opponentOutcome = "LOSE";
    } else if (!result.draw && winnerEntry) {
      resultClass = "result-lose";
      icon = "⚑";
      title = "패배";
      text = `${winnerEntry.name} 플레이어가 이번 판에서 앞섰습니다.`;
      sound = "lose";
      meOutcome = "LOSE";
      opponentOutcome = "WIN";
    }

    showGameOver({
      resultClass,
      modeBadge: "ONLINE",
      stateBadge: "REMATCH",
      icon,
      title,
      text,
      meta: "둘 다 재대결을 누르면 같은 방에서 다음 판이 시작됩니다.",
      meName: myScoreEntry?.name || state.myName || "나",
      opponentName: opponentEntry?.name || "상대",
      meOutcome,
      opponentOutcome,
      stat1Label: "내 점수",
      stat1Value: myScoreEntry?.score || 0,
      stat2Label: "상대 점수",
      stat2Value: opponentEntry ? String(opponentEntry.score) : "-",
      stat3Label: "방 코드",
      stat3Value: state.myRoomCode || "-",
      showRestart: false,
      showRematch: true,
      rematchText: "재대결"
    });

    updateOnlineRematchState();
    App.audio.playResultSound(sound);
  }

  function resetToStartOverlay() {
    setMode("menu");
    state.currentRoom = null;
    state.mySocketId = null;
    state.myRoomCode = "";
    state.ROWS = DEFAULT_ROWS;
    state.COLS = DEFAULT_COLS;
    state.DURATION = DEFAULT_DURATION;
    state.endsAt = null;
    state.score = 0;
    state.timeLeft = state.DURATION;

    updateScore();
    updateOpponentScore(0);
    updateScoreboardLabels();
    dom.roomOverlay.classList.add("hidden");
    hideGameOver();
    dom.startOverlay.classList.remove("hidden");
    hideToast();
    clearTimer();
    resetPlayState();
    createPreviewBoard(1);
    renderBoard();
    updateTime();
    emitMenuDataChange();
    scheduleViewportSync();
  }

  function setPlayerIdentity({ socketId = null, name = "", roomCode = "" } = {}) {
    state.mySocketId = socketId;
    state.myName = sanitizeName(name, "나");
    state.myRoomCode = roomCode;
    updateScoreboardLabels();
    updateModeUI();
  }

  function enterOnlineLobby() {
    setMode("online");
    hideGameOver();
    hideToast();
    dom.startOverlay.classList.add("hidden");
    scheduleViewportSync();
  }

  function handleRoomUpdate(room) {
    if (!room) return;
    renderRoom(room);
  }

  function handleOpponentLeft(message) {
    if (isSingleMode()) return;

    App.audio.ensureAudio();
    App.audio.playOpponentLeftSound();
    clearTimer();
    hideGameOver();
    dom.roomOverlay.classList.remove("hidden");
    setMessage(message || "상대가 나가서 대기실로 돌아갑니다.", "bad", { sticky: true });
    state.isGameActive = false;
    state.isResolving = false;
    syncBodyUiState();
    if (state.currentRoom) {
      state.currentRoom.gameStarted = false;
      state.currentRoom.gameEnded = false;
    }
    scheduleViewportSync();
  }

  function handleDisconnect() {
    if (isSingleMode() || state.mode === "menu") return;
    setMessage("서버 연결이 끊겼습니다.", "bad", { sticky: true });
    clearTimer();
    state.isGameActive = false;
    state.isResolving = false;
    syncBodyUiState();
    scheduleViewportSync();
  }

  function handleRestartIntent() {
    App.audio.ensureAudio();
    App.audio.playUiSound();

    if (isSingleMode()) {
      restartSingleGame();
      return;
    }

    setMessage("온라인은 결과 화면에서 재대결을 선택해 주세요.", "bad", { duration: 1200 });
  }

  function initBoardObserver() {
    if (!window.ResizeObserver || state.resizeObserver || !dom.boardStage) return;

    state.resizeObserver = new window.ResizeObserver(() => {
      scheduleBoardLayout();
    });

    state.resizeObserver.observe(dom.boardStage);
  }

  function bindBoardEvents() {
    dom.board.addEventListener("pointerdown", (event) => {
      App.audio.ensureAudio();
      if (!state.isGameActive || state.isResolving || state.isDragging || state.timeLeft <= 0) return;

      const pos = getCellFromClient(event.clientX, event.clientY, {
        forgiving: true
      });
      if (!pos) return;

      event.preventDefault();
      clearHintPreview();

      state.isDragging = true;
      state.activePointerId = event.pointerId;
      state.dragStart = pos;
      state.dragCurrent = pos;
      state.dragVisitedKeys = new Set();
      state.lastDragFeedbackAt = 0;

      try {
        dom.board.setPointerCapture(event.pointerId);
      } catch (error) {}

      triggerDragEntryFeedback(pos, { force: true });
      updateSelection(state.dragStart, state.dragCurrent);
    });

    window.addEventListener("pointermove", (event) => {
      if (!state.isGameActive || !state.isDragging || state.isResolving) return;
      if (event.pointerId !== state.activePointerId) return;

      event.preventDefault();

      const pos = getCellFromClient(event.clientX, event.clientY, {
        clampToBoard: true,
        forgiving: true
      });
      if (!pos) return;
      if (state.dragCurrent && state.dragCurrent.row === pos.row && state.dragCurrent.col === pos.col) return;

      queueSelectionUpdate(pos);
    }, { passive: false });

    window.addEventListener("pointerup", async (event) => {
      if (!state.isDragging) return;
      if (event.pointerId !== state.activePointerId) return;

      event.preventDefault();

      const pos = getCellFromClient(event.clientX, event.clientY, {
        clampToBoard: true,
        forgiving: true
      });

      flushQueuedSelection();

      if (pos) {
        state.dragCurrent = pos;
        updateSelection(state.dragStart, state.dragCurrent);
      }

      try {
        dom.board.releasePointerCapture(event.pointerId);
      } catch (error) {}

      await resolveSelection();
    }, { passive: false });

    window.addEventListener("pointercancel", () => {
      if (state.isDragging) cancelDrag(false);
    });

    window.addEventListener("blur", () => {
      if (state.isDragging) cancelDrag(false);
    });

    window.addEventListener("resize", () => {
      scheduleViewportSync();
    });

    window.addEventListener("orientationchange", () => {
      scheduleViewportSync();
    });

    window.visualViewport?.addEventListener("resize", scheduleViewportSync);

    dom.hintBtn.addEventListener("click", () => {
      App.audio.ensureAudio();
      App.audio.playUiSound();
      useHint();
    });
  }

  function init() {
    cacheDom();
    ensureDropLayer();
    bindBoardEvents();
    initBoardObserver();
    setMode("menu");
    scheduleViewportSync();
    state.ROWS = DEFAULT_ROWS;
    state.COLS = DEFAULT_COLS;
    state.DURATION = DEFAULT_DURATION;
    state.myName = "나";
    createPreviewBoard(1);
    renderBoard();
    updateScore();
    updateOpponentScore(0);
    updateScoreboardLabels();
    updateTime();
    hideToast();
    emitMenuDataChange();
  }

  App.game = {
    init,
    setMessage,
    updateOpponentScore,
    clearTimer,
    hideGameOver,
    showLobbyError,
    renderRoom,
    handleRoomUpdate,
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
    setDailyChallenge,
    refreshViewportUi: scheduleViewportSync,
    getMenuData,
    getState: () => state
  };
})();
