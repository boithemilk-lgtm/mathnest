(() => {
  const intro = document.getElementById('nexusIntro');
  const canvas = document.getElementById('nexusStars');
  const enter = document.getElementById('nexusEnter');
  if (!intro || !canvas || !enter) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0, height = 0, raf = 0, pointer = { x: -9999, y: -9999 }, particles = [];
  const rand = (min, max) => Math.random() * (max - min) + min;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(150, Math.max(55, Math.floor(width * height / 10500)));
    particles = Array.from({ length: count }, () => ({ x: rand(0,width), y: rand(0,height), vx: rand(-.18,.18), vy: rand(-.15,.15), r: rand(.7,2), a: rand(.25,.85), phase: rand(0,Math.PI*2) }));
    draw(true);
  }
  function draw(staticFrame = false) {
    ctx.clearRect(0,0,width,height);
    const glow = ctx.createRadialGradient(width*.5,height*.47,0,width*.5,height*.47,Math.max(width,height)*.7);
    glow.addColorStop(0,'rgba(82, 80, 190, .10)'); glow.addColorStop(.5,'rgba(12, 21, 42, .08)'); glow.addColorStop(1,'rgba(3, 5, 12, 0)');
    ctx.fillStyle = glow; ctx.fillRect(0,0,width,height);
    for (let i=0;i<particles.length;i++) {
      const p=particles[i];
      if (!staticFrame && !reduceMotion) { p.x += p.vx; p.y += p.vy; p.phase += .012; if(p.x < -10)p.x=width+10; if(p.x>width+10)p.x=-10; if(p.y < -10)p.y=height+10; if(p.y>height+10)p.y=-10; }
      const dx=pointer.x-p.x, dy=pointer.y-p.y, dist=Math.hypot(dx,dy);
      if(dist<155 && dist>0) { const force=(155-dist)/155; p.x -= dx*force*.003; p.y -= dy*force*.003; }
      const alpha=Math.max(.1,Math.min(1,p.a + Math.sin(p.phase)*.15));
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=`rgba(${i%4===0?'119, 244, 213':'158, 154, 255'},${alpha})`; ctx.fill();
      if(dist<155) { ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(pointer.x,pointer.y); ctx.strokeStyle=`rgba(129, 183, 255,${(1-dist/155)*.22})`; ctx.lineWidth=.7; ctx.stroke(); }
      for(let j=i+1;j<Math.min(i+5,particles.length);j++) { const q=particles[j], d=Math.hypot(p.x-q.x,p.y-q.y); if(d<95){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=`rgba(135,145,255,${(1-d/95)*.08})`;ctx.lineWidth=.6;ctx.stroke();} }
    }
    if (!staticFrame && !reduceMotion && !intro.classList.contains('is-leaving')) raf=requestAnimationFrame(()=>draw(false));
  }
  function leave() {
    if (intro.classList.contains('is-leaving')) return;
    intro.classList.add('is-leaving');
    document.body.classList.remove('nexus-intro-active');
    cancelAnimationFrame(raf);
    window.setTimeout(() => { intro.hidden=true; window.dispatchEvent(new Event('nexus:introfinished')); }, 650);
  }
  enter.addEventListener('click', leave);
  window.addEventListener('keydown', e => { if(e.key==='Enter' && !intro.hidden) { e.preventDefault(); leave(); } if(e.key==='Escape' && !intro.hidden) leave(); });
  window.addEventListener('pointermove', e => { pointer.x=e.clientX; pointer.y=e.clientY; const rx=(e.clientX/Math.max(width,1)-.5), ry=(e.clientY/Math.max(height,1)-.5); intro.style.setProperty('--pointer-x', `${rx*24}px`); intro.style.setProperty('--pointer-y', `${ry*18}px`); }, {passive:true});
  window.addEventListener('resize', resize, {passive:true});
  resize();
  if (!reduceMotion) raf=requestAnimationFrame(()=>draw(false));
})();
