
"use strict";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const CHAMPIONS = require("./champions-data.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const MATCH_MS = 5 * 60 * 1000;
const RECONNECT_MS = 30 * 1000;
const LANE_MIN = 0;
const LANE_MAX = 2;

const SKILLS = {
  Q: { mana: 15, cooldown: 5000, damage: 105, travel: 850 },
  W: { mana: 20, cooldown: 7000, damage: 135, travel: 900 },
  E: { mana: 25, cooldown: 9000, damage: 165, travel: 950 },
  R: { mana: 50, cooldown: 18000, damage: 280, travel: 1150 }
};

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "PROJECT 2", rooms: rooms.size });
});

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 5 },
    () => chars[crypto.randomInt(chars.length)]
  ).join("");
}

function cleanName(value) {
  const name = String(value || "").trim().slice(0, 16);
  return name || "Oyuncu";
}

function playerView(p, reveal = false) {
  return {
    id: p.id,
    name: p.name,
    ready: p.ready,
    champion: reveal ? p.champion : null,
    lane: p.lane,
    hp: p.hp,
    maxHp: p.maxHp,
    mana: p.mana,
    maxMana: p.maxMana,
    damage: p.damage,
    hits: p.hits,
    connected: p.connected
  };
}

function roomView(room) {
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(p => playerView(p, false))
  };
}

function getRoom(socket) {
  return rooms.get(socket.data.roomCode);
}

function getPlayer(room, socketId) {
  return room?.players.find(p => p.id === socketId);
}

function sendError(socket, message) {
  socket.emit("app:error", { message });
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", roomView(room));
}

function emitState(room) {
  io.to(room.code).emit("match:state", {
    remainingMs: room.remainingMs,
    players: room.players.map(p => playerView(p, true))
  });
}

function createPlayer(id, token, name) {
  return {
    id,
    token,
    name: cleanName(name),
    connected: true,
    champion: null,
    ready: false,
    lane: 1,
    hp: 1000,
    maxHp: 1000,
    mana: 100,
    maxMana: 100,
    damage: 0,
    hits: 0,
    cooldowns: {},
    reconnectTimer: null
  };
}

function startClock(room) {
  if (room.clock) clearInterval(room.clock);

  room.lastTick = Date.now();

  room.clock = setInterval(() => {
    if (room.status !== "playing") return;

    const now = Date.now();
    const delta = Math.min(1000, now - room.lastTick);

    room.lastTick = now;
    room.remainingMs = Math.max(0, room.remainingMs - delta);

    for (const p of room.players) {
      p.mana = Math.min(p.maxMana, p.mana + delta * 0.006);
    }

    if (now - room.lastStateAt >= 250) {
      room.lastStateAt = now;
      emitState(room);
    }

    if (room.remainingMs <= 0) {
      finishMatch(room, "time");
    }
  }, 100);
}

function startMatch(room) {
  if (
    room.status !== "waiting" ||
    room.players.length !== 2 ||
    !room.players.every(p => p.ready)
  ) return;

  room.status = "countdown";
  emitRoom(room);

  io.to(room.code).emit("match:countdown", { seconds: 3 });

  room.countdown = setTimeout(() => {
    if (room.status !== "countdown") return;

    room.status = "playing";
    room.remainingMs = MATCH_MS;
    room.startedAt = Date.now();
    room.lastStateAt = 0;

    io.to(room.code).emit("match:start", {
      duration: MATCH_MS / 1000,
      players: room.players.map(p => playerView(p, true))
    });

    startClock(room);
  }, 3000);
}

function finishMatch(room, reason, disconnectedPlayerId = null) {
  if (!room || ["finished", "closed"].includes(room.status)) return;

  room.status = "finished";

  if (room.clock) clearInterval(room.clock);
  if (room.countdown) clearTimeout(room.countdown);

  for (const p of room.players) {
    if (p.reconnectTimer) clearTimeout(p.reconnectTimer);
  }

  let winnerId = null;

  if (reason === "knockout") {
    winnerId = room.players.find(p => p.hp > 0)?.id || null;
  }

  if (reason === "time") {
    const [a, b] = room.players;
    winnerId = a.hp === b.hp ? null : (a.hp > b.hp ? a.id : b.id);
  }

  if (reason === "disconnect") {
    winnerId = room.players.find(p => p.id !== disconnectedPlayerId)?.id || null;
  }

  io.to(room.code).emit("match:finished", {
    reason,
    winnerId,
    draw: reason === "time" && room.players[0].hp === room.players[1].hp,
    players: room.players.map(p => playerView(p, true))
  });

  room.projectiles.clear();
}

function pauseForDisconnect(room, player) {
  if (!["playing", "countdown"].includes(room.status)) return;

  room.pausedFrom = room.status;
  room.status = "paused";
  room.pausedAt = Date.now();

  if (room.clock) {
    clearInterval(room.clock);
    room.clock = null;
  }

  if (room.countdown) {
    clearTimeout(room.countdown);
    room.countdown = null;
  }

  room.projectiles.clear();

  io.to(room.code).emit("match:paused", {
    seconds: 30,
    playerId: player.id
  });

  player.reconnectTimer = setTimeout(() => {
    if (room.status === "paused" && !player.connected) {
      finishMatch(room, "disconnect", player.id);
    }
  }, RECONNECT_MS);
}

function resumePlayer(socket, payload) {
  const code = String(payload?.code || "").trim().toUpperCase();
  const token = String(payload?.token || "");

  const room = rooms.get(code);
  const player = room?.players.find(p => p.token === token);

  if (!room || !player) {
    return sendError(socket, "Oturum bulunamadı. Yeni oda oluşturmalısın.");
  }

  // Eski soket gerçekten bağlıysa ikinci bağlantıyı engelle.
  const oldSocket = io.sockets.sockets.get(player.id);

  if (
    player.connected &&
    player.id !== socket.id &&
    oldSocket?.connected
  ) {
    return sendError(socket, "Bu oyuncu başka bir bağlantıda aktif.");
  }

  const oldId = player.id;

  if (oldId !== socket.id && oldSocket) {
    oldSocket.leave(code);
  }

  player.id = socket.id;
  player.connected = true;

  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }

  socket.join(code);
  socket.data.roomCode = code;
  socket.data.playerToken = token;

  socket.emit("room:resumed", {
    code,
    status: room.status,
    token
  });

  if (room.status === "paused" && room.players.every(p => p.connected)) {
    const previousStatus = room.pausedFrom;

    room.pausedAt = null;
    room.pausedFrom = null;

    if (previousStatus === "countdown") {
      room.status = "waiting";
      emitRoom(room);
      startMatch(room);
    } else {
      room.status = "playing";
      room.lastTick = Date.now();

      io.to(code).emit("match:resumed", {
        remainingMs: room.remainingMs,
        players: room.players.map(p => playerView(p, true))
      });

      startClock(room);
    }
  } else if (room.status === "playing") {
    socket.emit("match:resume-state", {
      remainingMs: room.remainingMs,
      players: room.players.map(p => playerView(p, true))
    });
  } else {
    emitRoom(room);
  }
}

io.on("connection", socket => {
  socket.emit("app:connected", { id: socket.id });

  // Oda oluştur
  socket.on("room:create", payload => {
    const name = cleanName(payload?.name);

    let code = makeCode();
    while (rooms.has(code)) code = makeCode();

    const token = crypto.randomBytes(24).toString("hex");

    const room = {
      code,
      status: "waiting",
      players: [createPlayer(socket.id, token, name)],
      projectiles: new Map(),
      clock: null,
      countdown: null,
      remainingMs: MATCH_MS,
      startedAt: null,
      pausedAt: null,
      lastTick: Date.now(),
      lastStateAt: 0
    };

    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerToken = token;

    socket.emit("room:created", { code, token });
    emitRoom(room);
  });

  // Odaya katıl
  socket.on("room:join", payload => {
    const code = String(
      typeof payload === "string" ? payload : payload?.code || ""
    ).trim().toUpperCase();

    const name = cleanName(
      typeof payload === "string" ? "" : payload?.name
    );

    const room = rooms.get(code);

    if (!room) {
      return sendError(socket, "Bu oda kodu bulunamadı.");
    }

    if (room.status !== "waiting" || room.players.length >= 2) {
      return sendError(socket, "Bu oda artık katılıma açık değil.");
    }

    const token = crypto.randomBytes(24).toString("hex");

    room.players.push(createPlayer(socket.id, token, name));

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerToken = token;

    socket.emit("room:joined", { code, token });
    emitRoom(room);
  });

  socket.on("room:resume", payload => {
    resumePlayer(socket, payload);
  });

  // Şampiyon seçimi
  socket.on("champion:select", name => {
    const room = getRoom(socket);

    if (!room || room.status !== "waiting") {
      return sendError(socket, "Şampiyon seçimi şu anda kapalı.");
    }

    const champion = CHAMPIONS.find(
      c => c.id === name || c.name === name
    );

    const player = getPlayer(room, socket.id);

    if (!player || !champion) {
      return sendError(socket, "Geçersiz şampiyon seçimi.");
    }

    player.champion = champion.id;
    player.ready = true;

    socket.emit("champion:locked", { champion: champion.id });

    emitRoom(room);
    startMatch(room);
  });

  // Şerit değiştirme
  socket.on("player:move", rawLane => {
    const room = getRoom(socket);
    const player = getPlayer(room, socket.id);

    if (!room || room.status !== "playing" || !player) return;

    const lane = Number(rawLane);

    if (!Number.isInteger(lane) || lane < LANE_MIN || lane > LANE_MAX) {
      return;
    }

    player.lane = lane;

    io.to(room.code).emit("player:moved", {
      playerId: player.id,
      lane
    });
  });

  // Yetenek kullanma
  socket.on("skill:cast", payload => {
    const room = getRoom(socket);
    const player = getPlayer(room, socket.id);

    if (!room || room.status !== "playing" || !player) return;

    const skill = String(payload?.skill || "").toUpperCase();
    const lane = Number(payload?.lane);
    const spec = SKILLS[skill];

    if (!spec || !Number.isInteger(lane) || lane < 0 || lane > 2) {
      return;
    }

    const now = Date.now();
    const readyAt = player.cooldowns[skill] || 0;

    if (readyAt > now) {
      return socket.emit("skill:rejected", {
        message: "Yetenek henüz hazır değil.",
        skill,
        remainingMs: readyAt - now
      });
    }

    if (player.mana < spec.mana) {
      return socket.emit("skill:rejected", {
        message: "Yeterli mana yok.",
        skill
      });
    }

    player.mana -= spec.mana;
    player.cooldowns[skill] = now + spec.cooldown;

    const target = room.players.find(p => p.id !== player.id);
    const projectileId = crypto.randomUUID();

    const projectile = {
      id: projectileId,
      fromId: player.id,
      champion: player.champion,
      skill,
      lane,
      launchedAt: now,
      impactAt: now + spec.travel
    };

    room.projectiles.set(projectileId, projectile);

    io.to(room.code).emit("skill:launched", projectile);

    socket.emit("player:resources", {
      mana: Math.floor(player.mana),
      cooldowns: player.cooldowns
    });

    setTimeout(() => {
      if (
        room.status !== "playing" ||
        !room.projectiles.has(projectileId)
      ) return;

      room.projectiles.delete(projectileId);

      const victim = room.players.find(p => p.id !== player.id);

      if (!victim || !target) return;

      const hit = victim.lane === lane;

      if (hit) {
        victim.hp = Math.max(0, victim.hp - spec.damage);
        player.damage += spec.damage;
        player.hits += 1;
      }

      io.to(room.code).emit("skill:impact", {
        projectileId,
        attackerId: player.id,
        victimId: victim.id,
        skill,
        lane,
        hit,
        damage: hit ? spec.damage : 0,
        players: room.players.map(p => playerView(p, true))
      });

      emitState(room);

      if (victim.hp <= 0) {
        finishMatch(room, "knockout");
      }
    }, spec.travel);
  });

  // Bağlantı kesilmesi
  socket.on("disconnect", () => {
    const room = getRoom(socket);
    const player = getPlayer(room, socket.id);

    if (!room || !player) return;

    player.connected = false;

    if (room.status === "playing" || room.status === "countdown") {
      pauseForDisconnect(room, player);
    } else if (room.status === "waiting") {
      room.players = room.players.filter(p => p.id !== socket.id);

      if (!room.players.length) {
        rooms.delete(room.code);
      } else {
        emitRoom(room);
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PROJECT 2 listening on ${PORT}`);
});
