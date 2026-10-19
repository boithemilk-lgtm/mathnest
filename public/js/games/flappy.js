// Flappy — click, tap or press space to flap.

const W = 420, H = 480;

export default class Flappy {
  constructor(canvas, hooks) {
    this.canvas = canvas; this.hooks = hooks;
    canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext("2d");
    this.reset();
    this._keyHandler = this.onKey.bind(this);
    this._clickHandler = () => this.flap();
    window.addEventListener("keydown", this._keyHandler);
    canvas.addEventListener("pointerdown", this._clickHandler);
    this.last = performance.now();
    this.pipeTimer = 0;
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  reset() {
    this.bird = { x: 110, y: H / 2, vy: 0, r: 13 };
    this.pipes = [];
    this.score = 0;
    this.dead = false;
    this.started = false;
    this.hooks.onScore(0);
  }

  restart() { this.reset(); }

  flap() {
    if (this.dead) return;
    this.started = true;
    this.bird.vy = -6.6;
    window.vaultSfx?.blip(700, 0.05);
  }

  onKey(e) {
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      this.flap();
    }
  }

  update(dt) {
    const b = this.bird;
    if (!this.started || this.dead) return;
    const step = dt / 16.67;
    b.vy += 0.42 * step;
    b.y += b.vy * step;

    this.pipeTimer -= dt;
    if (this.pipeTimer <= 0) {
      const gap = 150;
      const top = 60 + Math.random() * (H - gap - 160);
      this.pipes.push({ x: W + 40, top, gap, scored: false });
      this.pipeTimer = 1700;
    }
    for (const p of this.pipes) {
      p.x -= 2.4 * step;
      if (!p.scored && p.x + 52 < b.x) {
        p.scored = true;
        this.score++;
        this.hooks.onScore(this.score);
        window.vaultSfx?.blip(880, 0.06);
      }
    }
    this.pipes = this.pipes.filter((p) => p.x > -80);

    // collision
    if (b.y + b.r > H - 20 || b.y - b.r < 0) return this.die();
    for (const p of this.pipes) {
      const inX = b.x + b.r > p.x && b.x - b.r < p.x + 52;
      if (inX && (b.y - b.r < p.top || b.y + b.r > p.top + p.gap)) return this.die();
    }
  }

  die() {
    this.dead = true;
    window.vaultSfx?.buzz();
    this.hooks.onGameOver(this.score);
  }

  loop(ts) {
    const dt = Math.min(32, ts - this.last);
    this.last = ts;
    this.update(dt);
    this.draw();
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  draw() {
    const ctx = this.ctx, b = this.bird;
    // sky
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0e1524");
    grad.addColorStop(1, "#06080c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // pipes
    for (const p of this.pipes) {
      ctx.fillStyle = "#2f9e58";
      ctx.beginPath(); ctx.roundRect(p.x, 0, 52, p.top, 8); ctx.fill();
      ctx.beginPath(); ctx.roundRect(p.x, p.top + p.gap, 52, H - p.top - p.gap - 20, 8); ctx.fill();
      ctx.fillStyle = "#62e88c";
      ctx.fillRect(p.x + 3, 0, 6, p.top);
      ctx.fillRect(p.x + 3, p.top + p.gap, 6, H - p.top - p.gap - 20);
    }

    // ground
    ctx.fillStyle = "#141a28";
    ctx.fillRect(0, H - 20, W, 20);

    // bird
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.max(-0.5, Math.min(0.9, b.vy / 14)));
    ctx.fillStyle = "#ffc24b";
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#06080c";
    ctx.beginPath(); ctx.arc(5, -4, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff8a5c";
    ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(18, 4); ctx.lineTo(10, 7); ctx.fill();
    ctx.restore();

    if (!this.started) {
      ctx.fillStyle = "rgba(232,236,244,0.9)";
      ctx.font = "600 16px Satoshi, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Click or press SPACE to flap", W / 2, H / 2 - 60);
    }

    if (this.dead) {
      ctx.fillStyle = "rgba(6,8,12,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ff5d7a";
      ctx.font = "700 30px 'Clash Display', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", W / 2, H / 2 - 8);
      ctx.fillStyle = "#e8ecf4";
      ctx.font = "500 15px Satoshi, sans-serif";
      ctx.fillText("Score: " + this.score, W / 2, H / 2 + 24);
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener("keydown", this._keyHandler);
    this.canvas.removeEventListener("pointerdown", this._clickHandler);
  }
}
