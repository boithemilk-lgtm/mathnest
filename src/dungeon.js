// Multiplayer room service for Dungeon of Broken Dreams.
// Rooms persist between restarts when the host supports a shared writable filesystem.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rooms = new Map();
const ROOM_FILE = fileURLToPath(
  new URL("./dungeon-rooms.json", import.meta.url)
);

const ROOM_TTL = 45 * 60 * 1000;
const MAX_ROOMS = 250;

let saveQueue = Promise.resolve();

// Load saved rooms when the server starts.
try {
  const saved = JSON.parse(await fs.readFile(ROOM_FILE, "utf8"));
  const now = Date.now();

  for (const room of Array.isArray(saved) ? saved : []) {
    if (
      room?.code &&
      room?.state &&
      now - Number(room.updatedAt || 0) < ROOM_TTL
    ) {
      rooms.set(String(room.code).toUpperCase(), room);
    }
  }
} catch {
  // The save file may not exist on the first run.
}

async function refreshRooms() {
  try {
    const saved = JSON.parse(await fs.readFile(ROOM_FILE, "utf8"));
    const now = Date.now();

    for (const room of Array.isArray(saved) ? saved : []) {
      if (
        !room?.code ||
        !room?.state ||
        now - Number(room.updatedAt || 0) >= ROOM_TTL
      ) {
        continue;
      }

      const key = String(room.code).toUpperCase();
      const current = rooms.get(key);

      if (
        !current ||
        Number(room.updatedAt || 0) >=
          Number(current.updatedAt || 0)
      ) {
        rooms.set(key, room);
      }
    }
  } catch {
    // No saved rooms yet, or filesystem access is unavailable.
  }
}

function persistRooms() {
  saveQueue = saveQueue
    .then(async () => {
      // Merge saved rooms before writing to reduce overwriting
      // rooms created by another process on the same filesystem.
      try {
        const saved = JSON.parse(
          await fs.readFile(ROOM_FILE, "utf8")
        );

        for (const room of Array.isArray(saved) ? saved : []) {
          const key = String(room?.code || "").toUpperCase();
          const current = rooms.get(key);

          if (
            key &&
            room.state &&
            Date.now() - Number(room.updatedAt || 0) < ROOM_TTL &&
            (
              !current ||
              Number(room.updatedAt || 0) >
                Number(current.updatedAt || 0)
            )
          ) {
            rooms.set(key, room);
          }
        }
      } catch {
        // First save.
      }

      const snapshot = JSON.stringify([...rooms.values()]);
      const tempFile = `${ROOM_FILE}.tmp`;

      await fs.writeFile(tempFile, snapshot, "utf8");
      await fs.rename(tempFile, ROOM_FILE);
    })
    .catch((error) => {
      console.error("Could not persist dungeon rooms:", error);
    });

  return saveQueue;
}

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

  const enemies = [];

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

  for (let i = 0; i < 7; i++) {
    const type =
      enemyTypes[Math.floor(Math.random() * enemyTypes.length)];

    let x = 8 + Math.floor(Math.random() * 13);
    let y = 3 + Math.floor(Math.random() * 12);

    if (walls.some((wall) => wall.x === x && wall.y === y)) {
      x = 18;
      y = 14;
    }

    enemies.push({
      id: `m${i}`,
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
      attackAt: 0
    });
  }

  const lootTypes = [
    {
      name: "Old coins",
      emoji: "🪙",
      kind: "gold",
      value: 15
    },
    {
      name: "Small potion",
      emoji: "🧪",
      kind: "heal",
      value: 25
    },
    {
      name: "Iron shard",
      emoji: "⚔️",
      kind: "gold",
      value: 25
    },
    {
      name: "Dream crystal",
      emoji: "💎",
      kind: "gold",
      value: 50
    },
    {
      name: "Bread",
      emoji: "🍞",
      kind: "heal",
      value: 12
    }
  ];

  const loot = [];

  for (let i = 0; i < 11; i++) {
    let x = 2 + Math.floor(Math.random() * 20);
    let y = 2 + Math.floor(Math.random() * 14);

    if (
      walls.some((wall) => wall.x === x && wall.y === y) ||
      (x < 6 && y < 5)
    ) {
      x = 7 + (i % 12);
      y = 5 + (i % 8);
    }

    loot.push({
      ...lootTypes[
        Math.floor(Math.random() * lootTypes.length)
      ],
      id: `l${i}`,
      x,
      y
    });
  }

  const now = Date.now();

  return {
    width,
    height,
    walls,
    enemies,
    loot,
    exit: { x: 22, y: 16 },
    players: {},
    startedAt: now,
    escaped: false,
    log: [
      {
        at: now,
        text: "The dungeon wakes. Find loot, stay together, and seek the sealed exit."
      }
    ]
  };
}

function safeRoom(room) {
  return {
    code: room.code,
    state: room.state,
    players: Object.values(room.state.players).map(
      (player) => ({ ...player })
    ),
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

function send(res, status, object) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });

  res.end(JSON.stringify(object));
}

function getRoom(code) {
  const normalized = String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return rooms.get(normalized);
}

function log(room, message) {
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

  if (
    room.state.walls.some(
      (wall) =>
        wall.x === Math.round(x) &&
        wall.y === Math.round(y)
    )
  ) {
    return false;
  }

  return true;
}

function moveMonsters(room) {
  const state = room.state;
  const now = Date.now();

  for (const monster of state.enemies) {
    if (!monster.alive) continue;

    const targets = Object.values(state.players).filter(
      (player) => player.hp > 0
    );

    if (!targets.length) continue;

    targets.sort(
      (a, b) =>
        Math.abs(a.x - monster.x) +
        Math.abs(a.y - monster.y) -
        (
          Math.abs(b.x - monster.x) +
          Math.abs(b.y - monster.y)
        )
    );

    const player = targets[0];
    const dx = player.x - monster.x;
    const dy = player.y - monster.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 1.05) {
      if (now - (monster.attackAt || 0) > 1000) {
        player.hp = Math.max(
          0,
          player.hp - monster.damage
        );

        monster.attackAt = now;

        if (player.hp === 0) {
          log(
            room,
            `${player.name} has fallen! Their friend can still revive them.`
          );
        }
      }
    } else if (
      distance > 0.1 &&
      now - (monster.moveAt || 0) > 450
    ) {
      const nextX =
        monster.x + Math.sign(dx) * monster.speed;
      const nextY =
        monster.y + Math.sign(dy) * monster.speed;

      if (canMove(room, nextX, monster.y)) {
        monster.x = nextX;
      } else if (canMove(room, monster.x, nextY)) {
        monster.y = nextY;
      }

      monster.moveAt = now;
    }
  }
}

export async function handleDungeonApi(req, res, url) {
  await refreshRooms();

  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    return send(res, 204, {});
  }

  // CREATE A ROOM
  if (
    method === "POST" &&
    path === "/api/dungeon/create"
  ) {
    if (rooms.size >= MAX_ROOMS) {
      for (const [key, room] of rooms) {
        if (Date.now() - room.updatedAt > ROOM_TTL) {
          rooms.delete(key);
        }
      }
    }

    if (rooms.size >= MAX_ROOMS) {
      return send(res, 503, {
        error: "The dungeon halls are full. Try again in a moment."
      });
    }

    let body = {};

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }

    let code;

    do {
      code = roomCode();
    } while (rooms.has(code));

    const state = newDungeon();
    const playerId = crypto.randomUUID();
    const now = Date.now();

    state.players[playerId] = {
      id: playerId,
      name: cleanName(body.name),
      x: 3,
      y: 3,
      hp: 100,
      maxHp: 100,
      gold: 0,
      alive: true,
      lastSeen: now,
      color: "#62e88c",
      facing: 1
    };

    const room = {
      code,
      state,
      createdAt: now,
      updatedAt: now
    };

    rooms.set(code, room);

    await persistRooms();

    return send(res, 200, {
      code,
      playerId,
      room: safeRoom(room)
    });
  }

  // JOIN A ROOM
  if (
    method === "POST" &&
    path === "/api/dungeon/join"
  ) {
    let body = {};

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
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
    const now = Date.now();

    room.state.players[playerId] = {
      id: playerId,
      name: cleanName(body.name),
      x: 4,
      y: 3,
      hp: 100,
      maxHp: 100,
      gold: 0,
      alive: true,
      lastSeen: now,
      color: "#8b7cf8",
      facing: -1
    };

    room.updatedAt = now;

    log(
      room,
      `${room.state.players[playerId].name} joins the expedition.`
    );

    await persistRooms();

    return send(res, 200, {
      code: room.code,
      playerId,
      room: safeRoom(room)
    });
  }

  // ALL OTHER ROUTES REQUIRE A ROOM CODE.
  const code = url.searchParams.get("code") || "";
  const room = getRoom(code);

  if (!room) {
    return send(res, 404, {
      error: "Room expired or not found. Create a new dungeon."
    });
  }

  // GET CURRENT ROOM STATE
  if (
    method === "GET" &&
    path === "/api/dungeon/state"
  ) {
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

        log(
          room,
          `${otherPlayer.name} disappeared into the shadows.`
        );
      }
    }

    await persistRooms();

    return send(res, 200, {
      room: safeRoom(room),
      playerId
    });
  }

  // UPDATE PLAYER POSITION
  if (
    method === "POST" &&
    path === "/api/dungeon/update"
  ) {
    let body = {};

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }

    const player = room.state.players[body.playerId];

    if (!player) {
      return send(res, 403, {
        error: "Player not in room."
      });
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

    await persistRooms();

    return send(res, 200, { ok: true });
  }

  // PLAYER ACTIONS
  if (
    method === "POST" &&
    path === "/api/dungeon/action"
  ) {
    let body = {};

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }

    const state = room.state;
    const player = state.players[body.playerId];

    if (!player) {
      return send(res, 403, {
        error: "Player not in room."
      });
    }

    player.lastSeen = Date.now();
    room.updatedAt = Date.now();

    // ATTACK
    if (body.action === "attack") {
      const now = Date.now();

      if (now - (player.attackAt || 0) < 420) {
        return send(res, 429, {
          error: "Catch your breath."
        });
      }

      player.attackAt = now;

      const monster = state.enemies
        .filter(
          (enemy) =>
            enemy.alive &&
            Math.hypot(
              enemy.x - player.x,
              enemy.y - player.y
            ) < 1.8
        )
        .sort(
          (a, b) =>
            Math.hypot(
              a.x - player.x,
              a.y - player.y
            ) -
            Math.hypot(
              b.x - player.x,
              b.y - player.y
            )
        )[0];

      if (monster) {
        monster.hp -= 24;

        if (monster.hp <= 0) {
          monster.hp = 0;
          monster.alive = false;

          log(
            room,
            `${player.name} defeated a ${monster.name.toLowerCase()}!`
          );

          if (Math.random() < 0.75) {
            state.loot.push({
              id: `drop${now}`,
              name: "Monster essence",
              emoji: "✨",
              kind: "gold",
              value: 20,
              x: Math.round(monster.x),
              y: Math.round(monster.y)
            });
          }
        } else {
          log(
            room,
            `${player.name} strikes the ${monster.name.toLowerCase()}.`
          );
        }
      } else {
        log(
          room,
          `${player.name} swings at the cold, empty air.`
        );
      }
    }

    // PICK UP LOOT
    else if (body.action === "pickup") {
      const item = state.loot.find(
        (lootItem) =>
          Math.hypot(
            lootItem.x - player.x,
            lootItem.y - player.y
          ) < 1.15
      );

      if (item) {
        state.loot = state.loot.filter(
          (lootItem) => lootItem.id !== item.id
        );

        if (item.kind === "heal") {
          const healed = Math.min(
            player.maxHp - player.hp,
            item.value
          );

          player.hp += healed;

          log(
            room,
            `${player.name} uses ${item.name} (+${healed} health).`
          );
        } else {
          player.gold += item.value;

          log(
            room,
            `${player.name} found ${item.value} gold in ${item.name.toLowerCase()}.`
          );
        }
      }
    }

    // REVIVE A DOWNED TEAMMATE
    else if (body.action === "revive") {
      const target = Object.values(state.players).find(
        (otherPlayer) =>
          otherPlayer.id !== player.id &&
          otherPlayer.hp <= 0 &&
          Math.hypot(
            otherPlayer.x - player.x,
            otherPlayer.y - player.y
          ) < 2
      );

      if (target) {
        target.hp = 35;

        log(
          room,
          `${player.name} pulls ${target.name} back to their feet!`
        );
      }
    }

    // ESCAPE THE DUNGEON
    else if (body.action === "exit") {
      const alivePlayers = Object.values(
        state.players
      ).filter((otherPlayer) => otherPlayer.hp > 0);

      const standingTogether =
        alivePlayers.length ===
          Object.keys(state.players).length &&
        alivePlayers.length === 2;

      const nearExit =
        Math.hypot(
          player.x - state.exit.x,
          player.y - state.exit.y
        ) < 1.6;

      const allMonstersDefeated = state.enemies.every(
        (enemy) => !enemy.alive
      );

      if (
        nearExit &&
        standingTogether &&
        allMonstersDefeated
      ) {
        state.escaped = true;

        log(
          room,
          "THE SEAL BREAKS. You escaped together. The dungeon will remember you."
        );
      } else {
        log(
          room,
          "The exit is sealed. Both adventurers must be standing, and every monster must fall."
        );
      }
    }

    await persistRooms();

    return send(res, 200, {
      ok: true,
      room: safeRoom(room)
    });
  }

  // LEAVE THE ROOM
  if (
    method === "POST" &&
    path === "/api/dungeon/leave"
  ) {
    let body = {};

    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: "Invalid JSON" });
    }

    const player = room.state.players[body.playerId];

    if (player) {
      delete room.state.players[body.playerId];

      log(
        room,
        `${player.name} left the dungeon.`
      );

      room.updatedAt = Date.now();
    }

    // Keep the room around briefly in case a player reconnects.
    await persistRooms();

    return send(res, 200, { ok: true });
  }

  return send(res, 404, {
    error: "Unknown dungeon endpoint"
  });
}

function readBody(req, limit = 12000) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;

      if (data.length > limit) {
        reject(new Error("Body too large"));
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
