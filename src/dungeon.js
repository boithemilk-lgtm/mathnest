
 // Lightweight multiplayer dungeon room service for MathNest.
import crypto from "node:crypto";

const rooms = new Map();
const ROOM_TTL = 45 * 60 * 1000;
const MAX_ROOMS = 250;

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

function cleanName(value) {
  const name = String(value || "wanderer")
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .trim()
    .slice(0, 16);

  return name || "wanderer";
}

function newDungeon() {
  const width = 24;
  const height = 18;
  const walls = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1
      ) {
        walls.push({ x, y });
      } else if (
        x > 3 &&
        y > 3 &&
        Math.random() < 0.055 &&
        !(x < 7 && y < 7) &&
        !(x > 17 && y > 11)
      ) {
        walls.push({ x, y });
      }
    }
  }

  const enemyTypes = [
    {
      name: "Cave crawler",
      emoji: "☠",
      hp: 36,
      damage: 7,
      speed: 0.55,
      color: "#b7d66b"
    },
    {
      name: "Ash wraith",
      emoji: "👻",
      hp: 27,
      damage: 9,
      speed: 0.72,
      color: "#ad9cff"
    },
    {
      name: "Dungeon brute",
      emoji: "👹",
      hp: 65,
      damage: 12,
      speed: 0.36,
      color: "#e77c70"
    }
  ];

  const enemies = [];

  for (let i = 0; i < 7; i++) {
    const type =
      enemyTypes[Math.floor(Math.random() * enemyTypes.length)];

    let x = 8 + Math.floor(Math.random() * 13);
    let y = 3 + Math.floor(Math.random() * 12);

    if (walls.some(wall => wall.x === x && wall.y === y)) {
      x = 18;
      y = 14;
    }

    enemies.push({
      id: "m" + i,
      x,
      y,
      hp: type.hp,
      maxHp: type.hp,
      damage: type.damage,
      speed: type.speed,
      name: type.name,
      emoji: type.emoji,
      color: type.color,
      alive: true,
      attackAt: 0,
      moveAt: 0
    });
  }

  const lootTypes = [
    { name: "Old coins", emoji: "🪙", kind: "gold", value: 15 },
    { name: "Small potion", emoji: "🧪", kind: "heal", value: 25 },
    { name: "Iron shard", emoji: "⚔️", kind: "gold", value: 25 },
    { name: "Dream crystal", emoji: "💎", kind: "gold", value: 50 },
    { name: "Bread", emoji: "🍞", kind: "heal", value: 12 }
  ];

  const loot = [];

  for (let i = 0; i < 11; i++) {
    let x = 2 + Math.floor(Math.random() * 20);
    let y = 2 + Math.floor(Math.random() * 14);

    if (
      walls.some(wall => wall.x === x && wall.y === y) ||
      (x < 6 && y < 5)
    ) {
      x = 7 + (i % 12);
      y = 5 + (i % 8);
    }

    loot.push({
      ...lootTypes[Math.floor(Math.random() * lootTypes.length)],
      id: "l" + i,
      x,
      y
    });
  }

  return {
    width,
    height,
    walls,
    enemies,
    loot,
    exit: { x: 22, y: 16 },
    players: {},
    startedAt: Date.now(),
    escaped: false,
    log: [
      {
        at: Date.now(),
        text: "The dungeon wakes. Find loot, stay together, and seek the sealed exit."
      }
    ]
  };
}

function safeRoom(room) {
  return {
    code: room.code,
    players: Object.values(room.state.players).map(player => ({
      ...player
    })),
    width: room.state.width,
    height: room.state.height,
    walls: room.state.walls,
    enemies: room.state.enemies,
    loot: room.state.loot,
    exit: room.state.exit,
    escaped: room.state.escaped,
    log: room.state.log.slice(-8),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

function send(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });

  res.end(JSON.stringify(data));
}

function getRoom(code) {
  return rooms.get(String(code || "").toUpperCase());
}

function addLog(room, message) {
  room.state.log.push({
    at: Date.now(),
    text: String(message).slice(0, 160)
  });

  room.state.log = room.state.log.slice(-20);
}

function canMove(room, x, y) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 1 ||
    y < 1 ||
    x > room.state.width - 2 ||
    y > room.state.height - 2
  ) {
    return false;
  }

  return !room.state.walls.some(
    wall =>
      wall.x === Math.round(x) &&
      wall.y === Math.round(y)
  );
}

function moveMonsters(room) {
  const state = room.state;
  const now = Date.now();

  for (const monster of state.enemies) {
    if (!monster.alive) continue;

    const targets = Object.values(state.players).filter(
      player => player.hp > 0
    );

    if (!targets.length) continue;

    targets.sort(
      (a, b) =>
        Math.abs(a.x - monster.x) +
        Math.abs(a.y - monster.y) -
        (Math.abs(b.x - monster.x) +
          Math.abs(b.y - monster.y))
    );

    const player = targets[0];
    const dx = player.x - monster.x;
    const dy = player.y - monster.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 1.05) {
      if (now - (monster.attackAt || 0) > 1000) {
        player.hp = Math.max(0, player.hp - monster.damage);
        monster.attackAt = now;

        if (player.hp === 0) {
          addLog(
            room,
            `${player.name} has fallen! Their friend can still revive them.`
          );
        }
      }
    } else if (
      distance > 0.1 &&
      now - (monster.moveAt || 0) > 450
    ) {
      const nextX = monster.x + Math.sign(dx) * monster.speed;
      const nextY = monster.y + Math.sign(dy) * monster.speed;

      if (canMove(room, nextX, monster.y)) {
        monster.x = nextX;
      } else if (canMove(room, monster.x, nextY)) {
        monster.y = nextY;
      }

      monster.moveAt = now;
    }
  }
}

async function readBody(req, limit = 12000) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;

      if (data.length > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

export async function handleDungeonApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type"
    });
    return res.end();
  }

  if (
    method === "POST" &&
    path === "/api/dungeon/create"
  ) {
    const now = Date.now();

    for (const [code, room] of rooms) {
      if (now - room.updatedAt > ROOM_TTL) {
        rooms.delete(code);
      }
    }

    if (rooms.size >= MAX_ROOMS) {
      return send(res, 503, {
        error: "The dungeon halls are full. Try again in a moment."
      });
    }

    let body;

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON request." });
    }

    let code;

    do {
      code = roomCode();
    } while (rooms.has(code));

    const state = newDungeon();
    const playerId = crypto.randomUUID();

    state.players[playerId] = {
      id: playerId,
      name: cleanName(body.name),
      x: 3,
      y: 3,
      hp: 100,
      maxHp: 100,
      gold: 0,
      alive: true,
      lastSeen: Date.now(),
      color: "#62e88c",
      facing: 1
    };

    const room = {
      code,
      state,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    rooms.set(code, room);

    return send(res, 200, {
      code,
      playerId,
      room: safeRoom(room)
    });
  }

  if (
    method === "POST" &&
    path === "/api/dungeon/join"
  ) {
    let body;

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON request." });
    }

    const room = getRoom(body.code);

    if (!room) {
      return send(res, 404, {
        error: "Room not found. Check the code or ask your friend to create a new one."
      });
    }

    if (Object.keys(room.state.players).length >= 2) {
      return send(res, 409, {
        error: "This room already has two adventurers."
      });
    }

    const playerId = crypto.randomUUID();

    room.state.players[playerId] = {
      id: playerId,
      name: cleanName(body.name),
      x: 4,
      y: 3,
      hp: 100,
      maxHp: 100,
      gold: 0,
      alive: true,
      lastSeen: Date.now(),
      color: "#8b7cf8",
      facing: -1
    };

    room.updatedAt = Date.now();

    addLog(
      room,
      `${room.state.players[playerId].name} joins the expedition.`
    );

    return send(res, 200, {
      code: room.code,
      playerId,
      room: safeRoom(room)
    });
  }

  const code = url.searchParams.get("code") || "";
  const room = getRoom(code);

  if (!room) {
    return send(res, 404, {
      error: "Room expired or not found. Create a new dungeon."
    });
  }

  if (method === "GET" && path === "/api/dungeon/state") {
    const playerId = url.searchParams.get("playerId");
    const player = room.state.players[playerId];

    if (!player) {
      return send(res, 403, {
        error: "Your adventurer is not in this room."
      });
    }

    player.lastSeen = Date.now();
    room.updatedAt = Date.now();

    moveMonsters(room);

    for (const [id, otherPlayer] of Object.entries(
      room.state.players
    )) {
      if (Date.now() - otherPlayer.lastSeen > 45000) {
        delete room.state.players[id];

        addLog(
          room,
          `${otherPlayer.name} disappeared into the shadows.`
        );
      }
    }

    return send(res, 200, {
      room: safeRoom(room),
      playerId
    });
  }

  if (method === "POST" && path === "/api/dungeon/update") {
    let body;

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON request." });
    }

    const player = room.state.players[body.playerId];

    if (!player) {
      return send(res, 403, { error: "Player not in room." });
    }

    const x = Number(body.x);
    const y = Number(body.y);

    if (canMove(room, x, y)) {
      player.x = x;
      player.y = y;
    }

    player.facing = Number(body.facing) < 0 ? -1 : 1;
    player.lastSeen = Date.now();
    room.updatedAt = Date.now();

    return send(res, 200, { ok: true });
  }

  if (method === "POST" && path === "/api/dungeon/action") {
    let body;

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON request." });
    }

    const state = room.state;
    const player = state.players[body.playerId];

    if (!player) {
      return send(res, 403, { error: "Player not in room." });
    }

    player.lastSeen = Date.now();
    room.updatedAt = Date.now();

    if (body.action === "attack") {
      const now = Date.now();

      if (now - (player.attackAt || 0) < 420) {
        return send(res, 429, { error: "Catch your breath." });
      }

      player.attackAt = now;

      const monster = state.enemies
        .filter(
          enemy =>
            enemy.alive &&
            Math.hypot(enemy.x - player.x, enemy.y - player.y) < 1.8
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - player.x, a.y - player.y) -
            Math.hypot(b.x - player.x, b.y - player.y)
        )[0];

      if (monster) {
        monster.hp -= 24;

        if (monster.hp <= 0) {
          monster.hp = 0;
          monster.alive = false;

          addLog(
            room,
            `${player.name} defeated a ${monster.name.toLowerCase()}!`
          );

          if (Math.random() < 0.75) {
            state.loot.push({
              id: "drop" + now,
              name: "Monster essence",
              emoji: "✨",
              kind: "gold",
              value: 20,
              x: Math.round(monster.x),
              y: Math.round(monster.y)
            });
          }
        } else {
          addLog(
            room,
            `${player.name} strikes the ${monster.name.toLowerCase()}.`
          );
        }
      } else {
        addLog(room, `${player.name} swings at the cold, empty air.`);
      }
    } else if (body.action === "pickup") {
      const item = state.loot.find(
        loot => Math.hypot(loot.x - player.x, loot.y - player.y) < 1.15
      );

      if (item) {
        state.loot = state.loot.filter(
          loot => loot.id !== item.id
        );

        if (item.kind === "heal") {
          const healed = Math.min(
            player.maxHp - player.hp,
            item.value
          );

          player.hp += healed;

          addLog(
            room,
            `${player.name} uses ${item.name} (+${healed} health).`
          );
        } else {
          player.gold += item.value;

          addLog(
            room,
            `${player.name} found ${item.value} gold in ${item.name.toLowerCase()}.`
          );
        }
      }
    } else if (body.action === "revive") {
      const target = Object.values(state.players).find(
        other =>
          other.id !== player.id &&
          other.hp <= 0 &&
          Math.hypot(other.x - player.x, other.y - player.y) < 2
      );

      if (target) {
        target.hp = 35;

        addLog(
          room,
          `${player.name} pulls ${target.name} back to their feet!`
        );
      }
    } else if (body.action === "exit") {
      const players = Object.values(state.players);
      const allAlive = players.every(other => other.hp > 0);

      if (
        Math.hypot(
          player.x - state.exit.x,
          player.y - state.exit.y
        ) < 1.6 &&
        allAlive &&
        players.length === 2 &&
        state.enemies.every(enemy => !enemy.alive)
      ) {
        state.escaped = true;

        addLog(
          room,
          "THE SEAL BREAKS. You escaped together. The dungeon will remember you."
        );
      } else {
        addLog(
          room,
          "The exit is sealed. Both adventurers must be standing, and every monster must fall."
        );
      }
    }

    return send(res, 200, {
      ok: true,
      room: safeRoom(room)
    });
  }

  if (method === "POST" && path === "/api/dungeon/leave") {
    let body;

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON request." });
    }

    const player = room.state.players[body.playerId];

    if (player) {
      delete room.state.players[body.playerId];

      addLog(room, `${player.name} left the dungeon.`);
      room.updatedAt = Date.now();
    }

    if (Object.keys(room.state.players).length === 0) {
      rooms.delete(room.code);
    }

    return send(res, 200, { ok: true });
  }

  return send(res, 404, {
    error: "Unknown dungeon endpoint."
  });
}
