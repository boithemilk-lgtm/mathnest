// Pong vs the machine — first to 7. Move with mouse or arrows.

const W = 480, H = 480;

export default class Pong {
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
      const y = (e.touches[0].clientY - rect.top) * (H / rect.height);
      this.player.y = Math.max(0, Math.min(H - this.player.h, y - this.player.h / 2));
      e.preventDefault();
    }, { passive: false });
    this.keys = {};
    window.addEventListener("keyup", this._keyup = (e) => {
      if (["ArrowUp", "ArrowDown", "w", "s"].includes(e.key)) this.keys[e.key] = false;
    });
    this.last = performance.now();
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  reset() {
    this.player = { x: 22, y: H / 2 - 40, w: 10, h: 80 };
    this.ai = { x: W - 32, y: H / 2 - 40, w: 10, h: 80 };
    this.ball = { x: W / 2, y: H / 2, r: 7, vx: 4, vy: (Math.random() - 0.5) * 4 };
    this.ps = 0; this.as = 0;
    this.over = false;
    this.hooks.onScore(0);
  }

  restart() { this.reset(); }

  onKey(e) {
    if (["ArrowUp", "ArrowDown", "w", "s"].includes(e.key)) {
      this.keys[e.key] = true;
      e.preventDefault();
    }
  }

  onMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (H / rect.height);
    this.player.y = Math.max(0, Math.min(H - this.player.h, y - this.player.h / 2));
  }

  update(dt) {
    if (this.over) return;
    const step = dt / 16.67;
    const p = this.player, b = this.ball;

    if (this.keys.ArrowUp || this.keys.w) p.y = Math.max(0, p.y - 6.5 * step);
    if (this.keys.ArrowDown || this.keys.s) p.y = Math.min(H - p.h, p.y + 6.5 * step);

    // AI follows with capped speed
    const target = b.y - this.ai.h / 2;
    const diff = target - this.ai.y;
    const speed = 3.6;
    this.ai.y += Math.max(-speed * step, Math.min(speed * step, diff));
    this.ai.y = Math.max(0, Math.min(H - this.ai.h, this.ai.y));

    b.x += b.vx * step; b.y += b.vy * step;
    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
    if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy); }

    // paddles
    if (b.vx < 0 && b.x - b.r < p.x + p.w && b.x - b.r > p.x - 8 &&
        b.y > p.y - b.r && b.y < p.y + p.h + b.r) {
      b.vx = Math.abs(b.vx) * 1.04;
      b.vy += ((b.y - (p.y + p.h / 2)) / (p.h / 2)) * 2.4;
      window.vaultSfx?.blip(330, 0.04);
    }
    if (b.vx > 0 && b.x + b.r > this.ai.x && b.x + b.r < this.ai.x + this.ai.w + 8 &&
        b.y > this.ai.y - b.r && b.y < this.ai.y + this.ai.h + b.r) {
      b.vx = -Math.abs(b.vx) * 1.04;
      b.vy += ((b.y - (this.ai.y + this.ai.h / 2)) / (this.ai.h / 2)) * 2.4;
      window.vaultSfx?.blip(440, 0.04);
    }
    b.vy = Math.max(-6.5, Math.min(6.5, b.vy));

    if (b.x < -b.r) {
      this.as++;
      this.serve(-1);
    } else if (b.x > W + b.r) {
      this.ps++;
      window.vaultSfx?.blip(660, 0.08);
      this.serve(1);
    }
    this.hooks.onScore(this.ps);

    if (this.ps >= 7 || this.as >= 7) {
      this.over = true;
      this.hooks.onGameOver(this.ps);
    }
  }

  serve(dirTo) {
    const b = this.ball;
    b.x = W / 2; b.y = H / 2;
    b.vx = 4 * dirTo;
    b.vy = (Math.random() - 0.5) * 4;
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
    ctx.fillStyle = "#06080c";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.setLineDash([8, 12]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#8b93a7";
    ctx.font = "700 44px 'Clash Display', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(String(this.ps), W / 2 - 60, 18);
    ctx.fillText(String(this.as), W / 2 + 60, 18);

    ctx.fillStyle = "#62e88c";
    ctx.beginPath(); ctx.roundRect(this.player.x, this.player.y, this.player.w, this.player.h, 5); ctx.fill();
    ctx.fillStyle = "#8b7cf8";
    ctx.beginPath(); ctx.roundRect(this.ai.x, this.ai.y, this.ai.w, this.ai.h, 5); ctx.fill();
    ctx.fillStyle = "#e8ecf4";
    ctx.beginPath(); ctx.arc(this.ball.x, this.ball.y, this.ball.r, 0, Math.PI * 2); ctx.fill();

    if (this.over) {
      ctx.fillStyle = "rgba(6,8,12,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = this.ps > this.as ? "#62e88c" : "#ff5d7a";
      ctx.font = "700 30px 'Clash Display', sans-serif";
      ctx.fillText(this.ps > this.as ? "YOU WIN!" : "MACHINE WINS", W / 2, H / 2 - 8);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "500 15px Satoshi, sans-serif";
      ctx.fillText(`${this.ps} — ${this.as}`, W / 2, H / 2 + 24);
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._keyHandler);
    window.removeEventListener("keyup", this._keyup);
    this.canvas.removeEventListener("mousemove", this._mouseHandler);
  }
}
