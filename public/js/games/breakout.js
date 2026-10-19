// Breakout — move with mouse or arrows. 3 lives.

const W = 480, H = 480;
const C = {
  bg: "#06080c", paddle: "#62e88c", ball: "#e8ecf4",
  rows: ["#ff5d7a", "#ff8a5c", "#ffc24b", "#62e88c", "#8b7cf8"],
};

export default class Breakout {
  constructor(canvas, hooks) {
    this.canvas = canvas; this.hooks = hooks;
    canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext("2d");
    this.reset();
    this._keyHandler = this.onKey.bind(this);
    this._mouseHandler = this.onMouse.bind(this);
    window.addEventListener("keydown", this._keyHandler);
    canvas.addEventListener("mousemove", this._mouseHandler);
    canvas.addEventListener("touchmove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.touches[0].clientX - rect.left) * (W / rect.width);
      this.paddle.x = Math.max(0, Math.min(W - this.paddle.w, x - this.paddle.w / 2));
      e.preventDefault();
    }, { passive: false });
    this.last = performance.now();
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  reset() {
    this.paddle = { x: W / 2 - 48, w: 96, h: 12, y: H - 34 };
    this.ball = { x: W / 2, y: H - 60, r: 7, vx: 3.1, vy: -3.6 };
    this.lives = 3;
    this.score = 0;
    this.won = false;
    this.dead = false;
    this.buildBricks();
    this.hooks.onScore(0);
  }

  restart() { this.reset(); }

  buildBricks() {
    this.bricks = [];
    const rows = 5, cols = 9;
    const bw = (W - 40 - (cols - 1) * 8) / cols, bh = 18;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.bricks.push({ x: 20 + c * (bw + 8), y: 56 + r * (bh + 8), w: bw, h: bh, color: C.rows[r], alive: true });
      }
    }
  }

  onKey(e) {
    if (["ArrowLeft", "a"].includes(e.key)) { this.keys = { ...this.keys, left: true }; e.preventDefault(); }
    if (["ArrowRight", "d"].includes(e.key)) { this.keys = { ...this.keys, right: true }; e.preventDefault(); }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault();
    this.keys = this.keys || {};
    if (e.key === "ArrowLeft" || e.key === "a") this.keys.left = true;
    if (e.key === "ArrowRight" || e.key === "d") this.keys.right = true;
  }

  onMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    this.paddle.x = Math.max(0, Math.min(W - this.paddle.w, x - this.paddle.w / 2));
  }

  update(dt) {
    if (this.dead || this.won) return;
    const p = this.paddle, b = this.ball;
    this.keys = this.keys || {};
    if (this.keys.left) p.x = Math.max(0, p.x - 7);
    if (this.keys.right) p.x = Math.min(W - p.w, p.x + 7);
    this.keys.left = this.keys.right = false;

    b.x += b.vx; b.y += b.vy;

    if (b.x < b.r) { b.x = b.r; b.vx *= -1; window.vaultSfx?.blip(300, 0.03); }
    if (b.x > W - b.r) { b.x = W - b.r; b.vx *= -1; window.vaultSfx?.blip(300, 0.03); }
    if (b.y < b.r) { b.y = b.r; b.vy *= -1; window.vaultSfx?.blip(300, 0.03); }

    // paddle
    if (b.vy > 0 && b.y + b.r >= p.y && b.y + b.r <= p.y + p.h + 6 &&
        b.x >= p.x - b.r && b.x <= p.x + p.w + b.r) {
      const hit = (b.x - (p.x + p.w / 2)) / (p.w / 2); // -1..1
      const speed = Math.min(6.5, Math.hypot(b.vx, b.vy) * 1.02);
      const angle = hit * (Math.PI / 3); // up to 60°
      b.vx = speed * Math.sin(angle);
      b.vy = -Math.abs(speed * Math.cos(angle));
      window.vaultSfx?.blip(220, 0.04);
    }

    // bricks
    for (const br of this.bricks) {
      if (!br.alive) continue;
      if (b.x + b.r > br.x && b.x - b.r < br.x + br.w && b.y + b.r > br.y && b.y - b.r < br.y + br.h) {
        br.alive = false;
        this.score += 10;
        this.hooks.onScore(this.score);
        window.vaultSfx?.blip(500 + Math.random() * 200, 0.04);
        const overlapX = Math.min(b.x + b.r - br.x, br.x + br.w - (b.x - b.r));
        const overlapY = Math.min(b.y + b.r - br.y, br.y + br.h - (b.y - b.r));
        if (overlapX < overlapY) b.vx *= -1; else b.vy *= -1;
        break;
      }
    }
    if (this.bricks.every((br) => !br.alive)) {
      this.won = true;
      this.hooks.onGameOver(this.score);
    }

    // miss
    if (b.y > H + b.r) {
      this.lives--;
      if (this.lives <= 0) {
        this.dead = true;
        this.hooks.onGameOver(this.score);
      } else {
        b.x = W / 2; b.y = H - 60;
        b.vx = (Math.random() > 0.5 ? 1 : -1) * 3.1;
        b.vy = -3.6;
      }
    }
  }

  loop(ts) {
    const dt = Math.min(32, ts - this.last);
    this.last = ts;
    this.update(dt);
    this.draw();
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    for (const br of this.bricks) {
      if (!br.alive) continue;
      ctx.fillStyle = br.color;
      ctx.beginPath(); ctx.roundRect(br.x, br.y, br.w, br.h, 4); ctx.fill();
    }
    const p = this.paddle, b = this.ball;
    ctx.fillStyle = C.paddle;
    ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 6); ctx.fill();
    ctx.fillStyle = C.ball;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#8b93a7";
    ctx.font = "600 13px Satoshi, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Lives: " + "●".repeat(this.lives), 14, 26);

    if (this.dead || this.won) {
      ctx.fillStyle = "rgba(6,8,12,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = this.won ? "#62e88c" : "#ff5d7a";
      ctx.font = "700 30px 'Clash Display', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(this.won ? "YOU CLEARED IT!" : "GAME OVER", W / 2, H / 2 - 8);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "500 15px Satoshi, sans-serif";
      ctx.fillText("Score: " + this.score, W / 2, H / 2 + 24);
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._keyHandler);
    this.canvas.removeEventListener("mousemove", this._mouseHandler);
  }
}
