// Snake — arrows or WASD, swipe on mobile.

const COLS = 20, ROWS = 20, CELL = 24;
const C = {
  bg: "#06080c", grid: "rgba(255,255,255,0.03)",
  snake: "#62e88c", head: "#8ff7b1", food: "#ffc24b", dead: "#ff5d7a",
};

export default class Snake {
  constructor(canvas, hooks) {
    this.canvas = canvas; this.hooks = hooks;
    canvas.width = COLS * CELL; canvas.height = ROWS * CELL;
    this.ctx = canvas.getContext("2d");
    this.reset();
    this._keyHandler = this.onKey.bind(this);
    this._touchStart = null;
    window.addEventListener("keydown", this._keyHandler);
    canvas.addEventListener("touchstart", (e) => { this._touchStart = e.touches[0]; }, { passive: true });
    canvas.addEventListener("touchend", (e) => {
      if (!this._touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this._touchStart.clientX;
      const dy = t.clientY - this._touchStart.clientY;
      if (Math.abs(dx) > Math.abs(dy)) this.setDir(dx > 0 ? [1, 0] : [-1, 0]);
      else this.setDir(dy > 0 ? [0, 1] : [0, -1]);
      this._touchStart = null;
    }, { passive: true });
    this.last = 0; this.acc = 0;
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  reset() {
    this.snake = [[10, 10], [9, 10], [8, 10]];
    this.dir = [1, 0];
    this.nextDir = [1, 0];
    this.placeFood();
    this.score = 0;
    this.alive = true;
    this.tickMs = 130;
    this.hooks.onScore(0);
  }

  restart() { this.reset(); }

  placeFood() {
    do {
      this.food = [Math.floor(Math.random() * COLS), Math.floor(Math.random() * ROWS)];
    } while (this.snake.some(([x, y]) => x === this.food[0] && y === this.food[1]));
  }

  setDir(d) {
    if (d[0] === -this.dir[0] && d[1] === -this.dir[1]) return; // no reversal
    this.nextDir = d;
  }

  onKey(e) {
    const map = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    };
    const d = map[e.key] || map[e.key.toLowerCase?.()];
    if (d) { e.preventDefault(); this.setDir(d); }
  }

  step() {
    if (!this.alive) return;
    this.dir = this.nextDir;
    const [hx, hy] = this.snake[0];
    const nx = hx + this.dir[0], ny = hy + this.dir[1];
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS ||
        this.snake.some(([x, y]) => x === nx && y === ny)) {
      this.alive = false;
      this.hooks.onGameOver(this.score);
      return;
    }
    this.snake.unshift([nx, ny]);
    if (nx === this.food[0] && ny === this.food[1]) {
      this.score++;
      this.hooks.onScore(this.score);
      this.tickMs = Math.max(65, 130 - this.score * 3);
      window.vaultSfx?.blip(520 + this.score * 12, 0.06);
      this.placeFood();
    } else {
      this.snake.pop();
    }
  }

  loop(ts) {
    const dt = ts - this.last;
    this.last = ts;
    this.acc += dt;
    while (this.acc >= this.tickMs) {
      this.step();
      this.acc -= this.tickMs;
    }
    this.draw();
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = C.grid;
    for (let x = 1; x < COLS; x++) ctx.fillRect(x * CELL, 0, 1, this.canvas.height);
    for (let y = 1; y < ROWS; y++) ctx.fillRect(0, y * CELL, this.canvas.width, 1);

    // food
    const [fx, fy] = this.food;
    ctx.fillStyle = C.food;
    ctx.beginPath();
    ctx.arc(fx * CELL + CELL / 2, fy * CELL + CELL / 2, CELL * 0.36, 0, Math.PI * 2);
    ctx.fill();

    // snake
    this.snake.forEach(([x, y], i) => {
      ctx.fillStyle = i === 0 ? C.head : C.snake;
      ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 1 - i * 0.02);
      ctx.beginPath();
      ctx.roundRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4, 6);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (!this.alive) {
      ctx.fillStyle = "rgba(6,8,12,0.7)";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = C.dead;
      ctx.font = "700 30px 'Clash Display', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", this.canvas.width / 2, this.canvas.height / 2 - 8);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "500 15px Satoshi, sans-serif";
      ctx.fillText("Score: " + this.score, this.canvas.width / 2, this.canvas.height / 2 + 24);
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._keyHandler);
  }
}
