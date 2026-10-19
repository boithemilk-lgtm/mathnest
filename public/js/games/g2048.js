// 2048 — arrows or swipe. Merge tiles, beat your best.

const N = 4, CELL = 106, GAP = 12, PAD = 12;
const TILE_COLORS = {
  2: ["#2a3245", "#e8ecf4"], 4: ["#31405c", "#e8ecf4"], 8: ["#8b7cf8", "#fff"],
  16: ["#7a6cf0", "#fff"], 32: ["#62e88c", "#06240f"], 64: ["#3dd878", "#06240f"],
  128: ["#ffc24b", "#2c1e04"], 256: ["#ffa23e", "#2c1e04"], 512: ["#ff8a5c", "#fff"],
  1024: ["#ff5d7a", "#fff"], 2048: ["#f43f5e", "#fff"],
};
const SIZE = PAD * 2 + CELL * N + GAP * (N - 1);

export default class G2048 {
  constructor(canvas, hooks) {
    this.canvas = canvas; this.hooks = hooks;
    canvas.width = SIZE; canvas.height = SIZE;
    this.ctx = canvas.getContext("2d");
    this.reset();
    this._keyHandler = this.onKey.bind(this);
    window.addEventListener("keydown", this._keyHandler);
    this._touch = null;
    canvas.addEventListener("touchstart", (e) => { this._touch = e.touches[0]; }, { passive: true });
    canvas.addEventListener("touchend", (e) => {
      if (!this._touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this._touch.clientX, dy = t.clientY - this._touch.clientY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? "right" : "left");
      else this.move(dy > 0 ? "down" : "up");
      this._touch = null;
    }, { passive: true });
    this.draw();
  }

  reset() {
    this.grid = Array.from({ length: N }, () => Array(N).fill(0));
    this.score = 0;
    this.over = false;
    this.spawn(); this.spawn();
    this.hooks.onScore(0);
  }

  restart() { this.reset(); this.draw(); }

  spawn() {
    const empty = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!this.grid[r][c]) empty.push([r, c]);
    if (!empty.length) return;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    this.grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  onKey(e) {
    const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      w: "up", s: "down", a: "left", d: "right" };
    const dir = map[e.key] || map[e.key.toLowerCase?.()];
    if (dir) { e.preventDefault(); this.move(dir); }
  }

  slideRow(row) {
    let arr = row.filter((v) => v);
    let gained = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i] === arr[i + 1]) {
        arr[i] *= 2; gained += arr[i];
        arr.splice(i + 1, 1);
      }
    }
    while (arr.length < N) arr.push(0);
    return { arr, gained };
  }

  move(dir) {
    if (this.over) return;
    let moved = false, gained = 0;
    const g = this.grid;
    for (let i = 0; i < N; i++) {
      if (dir === "left") {
        const { arr, gained: gg } = this.slideRow(g[i]);
        if (arr.join() !== g[i].join()) moved = true;
        gained += gg; g[i] = arr;
      } else if (dir === "right") {
        const rev = [...g[i]].reverse();
        const { arr, gained: gg } = this.slideRow(rev);
        const back = arr.reverse();
        if (back.join() !== g[i].join()) moved = true;
        gained += gg; g[i] = back;
      } else if (dir === "up") {
        const col = [g[0][i], g[1][i], g[2][i], g[3][i]];
        const { arr, gained: gg } = this.slideRow(col);
        if (arr.join() !== col.join()) moved = true;
        gained += gg;
        for (let r = 0; r < N; r++) g[r][i] = arr[r];
      } else if (dir === "down") {
        const col = [g[3][i], g[2][i], g[1][i], g[0][i]];
        const { arr, gained: gg } = this.slideRow(col);
        if (arr.join() !== col.join()) moved = true;
        gained += gg;
        for (let r = 0; r < N; r++) g[3 - r][i] = arr[r];
      }
    }
    if (!moved) return;
    this.score += gained;
    if (gained > 0) { this.hooks.onScore(this.score); window.vaultSfx?.blip(440 + Math.min(gained, 800), 0.05); }
    this.spawn();
    if (!this.canMove()) {
      this.over = true;
      this.hooks.onGameOver(this.score);
    }
    this.draw();
  }

  canMove() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!this.grid[r][c]) return true;
      if (c < N - 1 && this.grid[r][c] === this.grid[r][c + 1]) return true;
      if (r < N - 1 && this.grid[r][c] === this.grid[r + 1][c]) return true;
    }
    return false;
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = "#0a0d13";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "#121722";
    ctx.beginPath();
    ctx.roundRect(0, 0, SIZE, SIZE, 16);
    ctx.fill();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const x = PAD + c * (CELL + GAP), y = PAD + r * (CELL + GAP);
        const v = this.grid[r][c];
        ctx.fillStyle = "#181e2c";
        ctx.beginPath(); ctx.roundRect(x, y, CELL, CELL, 12); ctx.fill();
        if (!v) continue;
        const [bg, fg] = TILE_COLORS[v] || ["#f43f5e", "#fff"];
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.roundRect(x, y, CELL, CELL, 12); ctx.fill();
        ctx.fillStyle = fg;
        ctx.font = `700 ${v > 999 ? 30 : v > 99 ? 38 : 44}px 'Clash Display', sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 2);
      }
    }
    if (this.over) {
      ctx.fillStyle = "rgba(6,8,12,0.72)";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#ff5d7a";
      ctx.font = "700 34px 'Clash Display', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("NO MOVES LEFT", SIZE / 2, SIZE / 2 - 16);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "500 16px Satoshi, sans-serif";
      ctx.fillText("Score: " + this.score, SIZE / 2, SIZE / 2 + 22);
    }
  }

  destroy() {
    window.removeEventListener("keydown", this._keyHandler);
  }
}
