
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROOM_PLAYER_LIMIT = 2;
const GAME_DURATION = 120;
const ROWS = 9;
const COLS = 18;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += chars[randomInt(0, chars.length - 1)];
  }
  return code;
}

function createSeededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return function seeded() {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function generateBoardFromSeed(seed) {
  const rand = createSeededRandom(seed);
  const board = [];

  for (let row = 0; row < ROWS; row += 1) {
    const rowData = [];
    for (let col = 0; col < COLS; col += 1) {
      rowData.push({
        value: Math.floor(rand() * 9) + 1,
        removed: false
      });
    }
    board.push(rowData);
  }

  return board;
}

function cloneBoard(board) {
  return board.map((row) => row.map((cell) => ({
    value: cell.value,
    removed: Boolean(cell.removed)
  })));
}

function serializePlayers(room) {
  return room.players.map((player) => ({
    socketId: player.socketId,
    name: player.name,
    ready: player.ready,
    score: player.score
  }));
}

function createRoom(hostSocketId, hostName) {
  let code = generateRoomCode();

  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  const room = {
    code,
    hostSocketId,
    players: [
      {
        socketId: hostSocketId,
        name: hostName,
        ready: false,
        score: null
      }
    ],
    gameStarted: false,
    gameEnded: false,
    seed: null,
    board: null,
    startedAt: null,
    endsAt: null,
    gameTimer: null
  };

  rooms.set(code, room);
  return room;
}

function getRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    const found = room.players.find((player) => player.socketId === socketId);
    if (found) return room;
  }
  return null;
}

function sanitizeRoomForClient(room) {
  return {
    code: room.code,
    gameStarted: room.gameStarted,
    gameEnded: room.gameEnded,
    players: serializePlayers(room)
  };
}

function broadcastRoomUpdate(room) {
  io.to(room.code).emit("room:update", sanitizeRoomForClient(room));
}

function clearGameTimer(room) {
  if (room.gameTimer) {
    clearTimeout(room.gameTimer);
    room.gameTimer = null;
  }
}

function resetRoomToLobby(room) {
  clearGameTimer(room);
  room.gameStarted = false;
  room.gameEnded = false;
  room.seed = null;
  room.board = null;
  room.startedAt = null;
  room.endsAt = null;

  room.players.forEach((player) => {
    player.ready = false;
    player.score = null;
  });
}

function emitBoardUpdate(room, { removedPositions = [], bySocketId = null, byName = "" } = {}) {
  io.to(room.code).emit("game:boardUpdate", {
    board: cloneBoard(room.board),
    players: serializePlayers(room),
    removedPositions,
    bySocketId,
    byName,
    endsAt: room.endsAt
  });
}

function finishGame(room, reason = "timeup") {
  if (!room || room.gameEnded || !room.gameStarted) return;

  clearGameTimer(room);
  room.gameStarted = false;
  room.gameEnded = true;

  const sorted = [...room.players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = sorted[0];
  const second = sorted[1];

  const result = {
    reason,
    winnerSocketId: null,
    draw: false,
    scores: room.players.map((player) => ({
      socketId: player.socketId,
      name: player.name,
      score: player.score || 0
    }))
  };

  if (second && (top.score || 0) === (second.score || 0)) {
    result.draw = true;
  } else if (top) {
    result.winnerSocketId = top.socketId;
  }

  io.to(room.code).emit("game:result", result);
  broadcastRoomUpdate(room);
}

function maybeStartGame(room) {
  if (room.gameStarted) return;
  if (room.players.length !== ROOM_PLAYER_LIMIT) return;

  const everyoneReady = room.players.every((player) => player.ready);
  if (!everyoneReady) return;

  room.gameStarted = true;
  room.gameEnded = false;
  room.seed = Math.floor(Math.random() * 1000000000);
  room.board = generateBoardFromSeed(room.seed);
  room.startedAt = Date.now();
  room.endsAt = room.startedAt + (GAME_DURATION * 1000);

  room.players.forEach((player) => {
    player.score = 0;
  });

  clearGameTimer(room);
  room.gameTimer = setTimeout(() => {
    const currentRoom = rooms.get(room.code);
    if (!currentRoom) return;
    finishGame(currentRoom, "timeup");
  }, GAME_DURATION * 1000);

  io.to(room.code).emit("game:start", {
    roomCode: room.code,
    rows: ROWS,
    cols: COLS,
    duration: GAME_DURATION,
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    board: cloneBoard(room.board),
    players: serializePlayers(room)
  });

  broadcastRoomUpdate(room);
}

function isBoardFullyRemoved(board) {
  for (const row of board) {
    for (const cell of row) {
      if (!cell.removed) return false;
    }
  }
  return true;
}

function sanitizePoint(point) {
  if (!point || typeof point !== "object") return null;
  const row = Number(point.row);
  const col = Number(point.col);

  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
}

function removePlayerFromRoom(room, socketId, options = {}) {
  const {
    notifyOpponentLeft = false,
    opponentLeftMessage = "상대가 나가서 대기실로 돌아갑니다."
  } = options;

  const wasGameInProgress = room.gameStarted && !room.gameEnded;
  const remainingPlayers = room.players.filter((player) => player.socketId !== socketId);

  if (notifyOpponentLeft && wasGameInProgress && remainingPlayers.length > 0) {
    remainingPlayers.forEach((player) => {
      io.to(player.socketId).emit("game:opponentLeft", {
        message: opponentLeftMessage
      });
    });
  }

  room.players = remainingPlayers;

  if (room.players.length === 0) {
    clearGameTimer(room);
    rooms.delete(room.code);
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
  }

  resetRoomToLobby(room);
  broadcastRoomUpdate(room);
}

function cleanupExistingRoom(socket, options = {}) {
  const room = getRoomBySocketId(socket.id);
  if (!room) return null;

  try {
    socket.leave(room.code);
  } catch (error) {}

  removePlayerFromRoom(room, socket.id, options);
  return room;
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name } = {}, callback) => {
    try {
      cleanupExistingRoom(socket, {
        notifyOpponentLeft: true,
        opponentLeftMessage: "상대가 방을 나가 대기실로 돌아갑니다."
      });

      const trimmedName = String(name || "").trim().slice(0, 12) || "플레이어";
      const room = createRoom(socket.id, trimmedName);

      socket.join(room.code);

      callback?.({
        ok: true,
        room: sanitizeRoomForClient(room),
        you: {
          socketId: socket.id,
          name: trimmedName
        }
      });

      broadcastRoomUpdate(room);
    } catch (error) {
      callback?.({
        ok: false,
        message: "방 생성에 실패했습니다."
      });
    }
  });

  socket.on("room:join", ({ code, name } = {}, callback) => {
    try {
      cleanupExistingRoom(socket, {
        notifyOpponentLeft: true,
        opponentLeftMessage: "상대가 방을 나가 대기실로 돌아갑니다."
      });

      const roomCode = String(code || "").trim().toUpperCase();
      const trimmedName = String(name || "").trim().slice(0, 12) || "플레이어";
      const room = rooms.get(roomCode);

      if (!room) {
        callback?.({ ok: false, message: "존재하지 않는 방입니다." });
        return;
      }

      if (room.players.length >= ROOM_PLAYER_LIMIT) {
        callback?.({ ok: false, message: "방이 가득 찼습니다." });
        return;
      }

      if (room.gameStarted) {
        callback?.({ ok: false, message: "이미 게임이 시작된 방입니다." });
        return;
      }

      room.players.push({
        socketId: socket.id,
        name: trimmedName,
        ready: false,
        score: null
      });

      socket.join(room.code);

      callback?.({
        ok: true,
        room: sanitizeRoomForClient(room),
        you: {
          socketId: socket.id,
          name: trimmedName
        }
      });

      broadcastRoomUpdate(room);
    } catch (error) {
      callback?.({
        ok: false,
        message: "방 참가에 실패했습니다."
      });
    }
  });

  socket.on("room:leave", (_, callback) => {
    const room = getRoomBySocketId(socket.id);

    if (!room) {
      callback?.({ ok: false, message: "참여 중인 방이 없습니다." });
      return;
    }

    try {
      socket.leave(room.code);
    } catch (error) {}

    removePlayerFromRoom(room, socket.id, {
      notifyOpponentLeft: true,
      opponentLeftMessage: "상대가 방을 나가 대기실로 돌아갑니다."
    });

    callback?.({ ok: true });
  });

  socket.on("room:toggleReady", (_, callback) => {
    const room = getRoomBySocketId(socket.id);

    if (!room) {
      callback?.({ ok: false, message: "참여 중인 방이 없습니다." });
      return;
    }

    if (room.gameStarted) {
      callback?.({ ok: false, message: "이미 게임이 시작되었습니다." });
      return;
    }

    const player = room.players.find((item) => item.socketId === socket.id);

    if (!player) {
      callback?.({ ok: false, message: "플레이어 정보를 찾을 수 없습니다." });
      return;
    }

    player.ready = !player.ready;

    callback?.({
      ok: true,
      ready: player.ready
    });

    broadcastRoomUpdate(room);
    maybeStartGame(room);
  });

  socket.on("game:attemptSelect", ({ start, end } = {}, callback) => {
    const room = getRoomBySocketId(socket.id);

    if (!room) {
      callback?.({ ok: false, message: "방 정보가 없습니다." });
      return;
    }

    if (!room.gameStarted || room.gameEnded || !room.board) {
      callback?.({ ok: false, message: "게임이 진행 중이 아닙니다." });
      return;
    }

    if (Date.now() >= room.endsAt) {
      finishGame(room, "timeup");
      callback?.({ ok: false, message: "이미 게임이 종료되었습니다." });
      return;
    }

    const player = room.players.find((item) => item.socketId === socket.id);

    if (!player) {
      callback?.({ ok: false, message: "플레이어 정보를 찾을 수 없습니다." });
      return;
    }

    const safeStart = sanitizePoint(start);
    const safeEnd = sanitizePoint(end);

    if (!safeStart || !safeEnd) {
      callback?.({ ok: false, message: "선택 정보가 올바르지 않습니다." });
      return;
    }

    const minRow = Math.max(0, Math.min(safeStart.row, safeEnd.row));
    const maxRow = Math.min(ROWS - 1, Math.max(safeStart.row, safeEnd.row));
    const minCol = Math.max(0, Math.min(safeStart.col, safeEnd.col));
    const maxCol = Math.min(COLS - 1, Math.max(safeStart.col, safeEnd.col));

    const removedPositions = [];
    let sum = 0;
    let hadRemovedCellInside = false;

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const cell = room.board[row][col];
        if (cell.removed) {
          hadRemovedCellInside = true;
          continue;
        }

        removedPositions.push({ row, col });
        sum += cell.value;
      }
    }

    if (removedPositions.length === 0) {
      callback?.({ ok: false, message: "이미 다른 플레이어가 먼저 가져갔어요." });
      return;
    }

    if (sum !== 10) {
      callback?.({
        ok: false,
        message: hadRemovedCellInside ? "이미 상태가 바뀌었습니다. 다시 선택해 주세요." : "합이 10이 아니에요."
      });
      return;
    }

    removedPositions.forEach(({ row, col }) => {
      room.board[row][col].removed = true;
    });

    player.score = (player.score || 0) + removedPositions.length;

    emitBoardUpdate(room, {
      removedPositions,
      bySocketId: player.socketId,
      byName: player.name
    });
    broadcastRoomUpdate(room);

    callback?.({ ok: true });

    if (isBoardFullyRemoved(room.board)) {
      finishGame(room, "boardCleared");
    }
  });

  socket.on("room:resetLobby", (_, callback) => {
    const room = getRoomBySocketId(socket.id);

    if (!room) {
      callback?.({ ok: false, message: "방 정보가 없습니다." });
      return;
    }

    resetRoomToLobby(room);

    callback?.({ ok: true });
    broadcastRoomUpdate(room);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocketId(socket.id);
    if (!room) return;

    removePlayerFromRoom(room, socket.id, {
      notifyOpponentLeft: true,
      opponentLeftMessage: "상대 연결이 끊겨 대기실로 돌아갑니다."
    });
  });
});

server.listen(PORT, () => {
  console.log(`Fruit Box server running on http://localhost:${PORT}`);
});
