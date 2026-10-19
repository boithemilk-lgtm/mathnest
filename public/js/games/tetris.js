// Tetris — arrows to move/rotate, space to drop. Line clears, levels, the works.

const COLS = 10, ROWS = 20, CELL = 24;
const W = COLS * CELL, H = ROWS * CELL;

const PIECES = {
  I: { color: "#62e88c", shape: [[1, 1, 1, 1]] },
  O: { color: "#ffc24b", shape: [[1, 1], [1, 1]] },
  T: { color: "#8b7cf8", shape: [[0, 1, 0], [1, 1, 1]] },
  S: { color: "#3dd878", shape: [[0, 1, 1], [1, 1, 0]] },
  Z: { color: "#ff5d7a", shape: [[1, 1, 0], [0, 1, 1]] },
  J: { color: "#5591c7", shape: [[1, 0, 0], [1, 1, 1]] },
  L: { color: "#ff8a5c", shape: [[0, 0, 1], [1, 1, 1]] },
};
const KEYS = Object.keys(PIECES);

function rotate(shape) {
  const rows = shape.length, cols = shape[0].length;
  const out = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[c][rows - 1 - r] = shape[r][c];
  return out;
}

export default class Tetris {
  constructor(canvas, hooks) {
    this.canvas = canvas; this.hooks = hooks;
    canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext("2d");
    this.reset();
    this._keyHandler = this.onKey.bind(this);
    window.addEventListener("keydown", this._keyHandler);
    this.last = performance.now();
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  reset() {
    this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.over = false;
    this.dropMs = 800;
    this.spawn();
    this.hooks.onScore(0);
  }

  restart() { this.reset(); }

  spawn() {
    const key = KEYS[Math.floor(Math.random() * KEYS.length)];
    const shape = PIECES[key].shape.map((r) => [...r]);
    this.piece = {
      key, shape,
      color: PIECES[key].color,
      x: Math.floor((COLS - shape[0].length) / 2),
      y: 0,
    };
    if (this.collides(this.piece.x, this.piece.y, this.piece.shape)) {
      this.over = true;
      this.hooks.onGameOver(this.score);
    }
  }

  collides(x, y, shape) {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const gx = x + c, gy = y + r;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy >= 0 && this.grid[gy][gx]) return true;
      }
    }
    return false;
  }

  lock() {
    const p = this.piece;
    for (let r = 0; r < p.shape.length; r++) {
      for (let c = 0; c < p.shape[r].length; c++) {
        if (p.shape[r][c]) {
          const gy = p.y + r;
          if (gy < 0) { this.over = true; this.hooks.onGameOver(this.score); return; }
          this.grid[gy][p.x + c] = p.color;
        }
      }
    }
    // clear lines
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.grid[r].every((cell) => cell)) {
        this.grid.splice(r, 1);
        this.grid.unshift(Array(COLS).fill(null));
        cleared++;
        r++;
      }
    }
    if (cleared) {
      this.lines += cleared;
      this.score += [0, 100, 300, 500, 800][cleared] * this.level;
      this.level = 1 + Math.floor(this.lines / 10);
      this.dropMs = Math.max(120, 800 - (this.level - 1) * 70);
      window.vaultSfx?.blip(400 + cleared * 150, 0.09);
      this.hooks.onScore(this.score);
    } else {
      window.vaultSfx?.blip(180, 0.03);
    }
    if (!this.over) this.spawn();
  }

  onKey(e) {
    if (this.over) return;
    const p = this.piece;
    if (e.key === "ArrowLeft" || e.key === "a") {
      e.preventDefault();
      if (!this.collides(p.x - 1, p.y, p.shape)) p.x--;
    } else if (e.key === "ArrowRight" || e.key === "d") {
      e.preventDefault();
      if (!this.collides(p.x + 1, p.y, p.shape)) p.x++;
    } else if (e.key === "ArrowDown" || e.key === "s") {
      e.preventDefault();
      if (!this.collides(p.x, p.y + 1, p.shape)) { p.y++; this.score += 1; this.hooks.onScore(this.score); }
    } else if (e.key === "ArrowUp" || e.key === "w") {
      e.preventDefault();
      const rotated = rotate(p.shape);
      if (!this.collides(p.x, p.y, rotated)) p.shape = rotated;
    } else if (e.code === "Space") {
      e.preventDefault();
      while (!this.collides(p.x, p.y + 1, p.shape)) { p.y++; this.score += 2; }
      this.hooks.onScore(this.score);
      this.lock();
    }
  }

  update(dt) {
    if (this.over) return;
    this.acc = (this.acc || 0) + dt;
    if (this.acc >= this.dropMs) {
      this.acc = 0;
      const p = this.piece;
      if (!this.collides(p.x, p.y + 1, p.shape)) p.y++;
      else this.lock();
    }
  }

  loop(ts) {
    const dt = Math.min(50, ts - this.last);
    this.last = ts;
    this.update(dt);
    this.draw();
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = "#06080c";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H); ctx.stroke(); }
    for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(W, y * CELL); ctx.stroke(); }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c]) this.drawCell(ctx, c, r, this.grid[r][c]);
      }
    }

    if (this.piece && !this.over) {
      const p = this.piece;
      for (let r = 0; r < p.shape.length; r++) {
        for (let c = 0; c < p.shape[r].length; c++) {
          if (p.shape[r][c]) this.drawCell(ctx, p.x + c, p.y + r, p.color);
        }
      }
    }

    if (this.over) {
      ctx.fillStyle = "rgba(6,8,12,0.72)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ff5d7a";
      ctx.font = "700 28px 'Clash Display', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", W / 2, H / 2 - 16);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "500 14px Satoshi, sans-serif";
      ctx.fillText(`Score ${this.score} · Lines ${this.lines}`, W / 2, H / 2 + 18);
    }
  }

  drawCell(ctx, c, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(c * CELL + 1.5, r * CELL + 1.5, CELL - 3, CELL - 3, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(c * CELL + 3, r * CELL + 3, CELL - 6, 3);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._keyHandler);
  }
}
