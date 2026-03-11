(function () {
    const CV = document.getElementById('main_canvas');
    const CTX = CV.getContext('2d');
    const TCV = document.getElementById('timeline_canvas');
    const TCTX = TCV.getContext('2d');
    const TT = document.getElementById('tooltip');
    const STATS = document.getElementById('stats_container');
    const SEL = document.getElementById('selection_info');
    const LOG = document.getElementById('log_container');
    const ML = document.getElementById('mode_label');

    let W, H, TW, TH;
    let STATE = { nodes: [], edges: [], epoch: 0, mode: 'observe', selected: null, params: { intensity: 50, entropy: 30, cohesion: 60, decay: 20 }, history: [], dragging: null, mouse: { x: 0, y: 0 }, running: true, nn_history: [], pool_history: [] };
    let AF;
    let particles = [];
    let bubbles = [];
    let plants = [];
    let tick = 0;
    let foodParts = [];

    function resize() {
        const r = CV.parentElement.getBoundingClientRect();
        W = r.width; H = r.height - 60;
        CV.width = W; CV.height = H;
        TW = r.width; TH = 60;
        TCV.width = TW; TCV.height = TH;
        generatePlants();
    }
    window.addEventListener('resize', resize);

    function generatePlants() {
        plants = [];
        const count = Math.floor(W / 60);
        for (let i = 0; i < count; i++) {
            const x = 30 + i * (W - 60) / count + Math.random() * 30;
            const h = 40 + Math.random() * 80;
            const blades = 3 + Math.floor(Math.random() * 4);
            const hue = 100 + Math.random() * 40;
            plants.push({ x, h, blades, hue, phase: Math.random() * Math.PI * 2 });
        }
    }

    function spawnBubble(x, y) {
        bubbles.push({ x: x + Math.random() * 10 - 5, y, r: 1 + Math.random() * 3, speed: 0.3 + Math.random() * 0.8, wobble: Math.random() * Math.PI * 2 });
    }

    function spawnFood(x, y) {
        for (let i = 0; i < 5; i++) {
            foodParts.push({ x: x + Math.random() * 20 - 10, y: y + Math.random() * 10 - 5, vy: 0.2 + Math.random() * 0.5, life: 1.0, size: 2 + Math.random() * 3 });
        }
    }

    function log(msg) {
        const d = document.createElement('div');
        d.style.cssText = 'padding:2px 0;border-bottom:1px solid #081828;color:#336688';
        d.textContent = `[${STATE.epoch}] ${msg}`;
        LOG.prepend(d);
        if (LOG.children.length > 50) LOG.removeChild(LOG.lastChild);
    }

    let prevAlive = new Set();

    function detectEvents() {
        const currentAlive = new Set(STATE.nodes.filter(n => n.alive).map(n => n.label));
        for (const n of STATE.nodes) {
            if (n.alive && !prevAlive.has(n.label)) {
                for (let i = 0; i < 3; i++)spawnBubble(n.x, n.y);
                log('hatched: ' + n.label + ' (gen ' + n.gen + ')');
            }
        }
        for (const label of prevAlive) {
            if (!currentAlive.has(label)) {
                log('lost: ' + label);
            }
        }
        prevAlive = currentAlive;
    }

    function fetchState() {
        fetch('/api/state').then(r => r.json()).then(d => {
            STATE.nodes = d.nodes || [];
            STATE.edges = d.edges || [];
            STATE.epoch = d.epoch || 0;
            STATE.nn_history = d.nn_history || [];
            STATE.pool_history = d.pool_history || [];
            detectEvents();
            updateStats(d.meta || {});
        });
    }

    function sendAction(action, params = {}) {
        fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, params: { ...STATE.params, ...params } }) }).then(r => r.json()).then(d => {
            STATE.nodes = d.nodes || STATE.nodes;
            STATE.edges = d.edges || STATE.edges;
            STATE.epoch = d.epoch || STATE.epoch;
            STATE.nn_history = d.nn_history || [];
            STATE.pool_history = d.pool_history || [];
            STATE.history.push({ epoch: STATE.epoch, count: STATE.nodes.filter(n => n.alive).length, action });
            detectEvents();
            if (d.meta) updateStats(d.meta);
        });
    }

    function updateStats(meta) {
        let html = '';
        const labels = { alive: 'population', epoch: 'cycle', births: 'hatched', deaths: 'lost', avg_energy: 'avg vitality', avg_age: 'avg age', max_gen: 'generation', nn_trained: 'brain cycles', nn_error: 'brain error', evo_gen: 'evo generation', evo_best: 'evo fitness' };
        for (let [k, v] of Object.entries(meta)) {
            const label = labels[k] || k;
            const val = typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : v;
            const color = k === 'alive' ? '#33ddaa' : k === 'deaths' ? '#ff6655' : k === 'avg_energy' ? '#ffaa33' : '#66aacc';
            html += `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value" style="color:${color}">${val === null ? '—' : val}</span></div>`;
        }
        STATS.innerHTML = html;
    }

    // ---- FISH RENDERING ----

    function fishColor(energy, hue) {
        if (!hue) hue = 'rgb(50,150,200)';
        // parse existing hue or generate from energy
        const vitality = Math.min(1, energy / 100);
        if (energy > 80) {
            const r = 30 + Math.floor(vitality * 40);
            const g = 150 + Math.floor(vitality * 80);
            const b = 180 + Math.floor(vitality * 60);
            return { body: `rgb(${r},${g},${b})`, belly: `rgba(${r + 60},${g + 40},${b + 30},0.6)`, fin: `rgba(${r - 10},${g + 20},${b + 40},0.7)` };
        } else if (energy > 40) {
            const t = energy / 80;
            return { body: `rgb(${80 + Math.floor(t * 60)},${100 + Math.floor(t * 80)},${120 + Math.floor(t * 80)})`, belly: `rgba(180,180,160,0.5)`, fin: `rgba(60,120,160,0.6)` };
        } else {
            return { body: `rgb(${100 + Math.floor(vitality * 40)},${80 + Math.floor(vitality * 40)},${70 + Math.floor(vitality * 30)})`, belly: 'rgba(140,120,100,0.4)', fin: 'rgba(80,70,60,0.5)' };
        }
    }

    function drawFish(n, i) {
        if (!n.alive) return;
        const x = n.x, y = n.y;
        const size = Math.max(8, Math.min(28, (n.r || 8) * 1.8));
        const colors = fishColor(n.energy, n.hue);

        // determine direction from trail or default
        let angle = 0;
        if (n.trail && n.trail.length >= 2) {
            const last = n.trail[n.trail.length - 1];
            const prev = n.trail[n.trail.length - 2];
            angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        }

        const tailWag = Math.sin(tick * 0.15 + i * 2) * 0.3;
        const bodyWobble = Math.sin(tick * 0.08 + i * 1.5) * 1.5;

        CTX.save();
        CTX.translate(x, y + bodyWobble);
        CTX.rotate(angle);

        // tail
        CTX.beginPath();
        CTX.moveTo(-size * 0.4, 0);
        const tailY1 = size * 0.5 * Math.sin(tick * 0.12 + i + tailWag);
        const tailY2 = size * 0.7 * Math.sin(tick * 0.12 + i + tailWag + 0.5);
        CTX.quadraticCurveTo(-size * 0.8, tailY1, -size * 1.1, tailY2);
        CTX.quadraticCurveTo(-size * 0.8, -tailY1 * 0.3, -size * 0.4, 0);
        CTX.fillStyle = colors.fin;
        CTX.fill();

        // body
        CTX.beginPath();
        CTX.ellipse(0, 0, size * 0.55, size * 0.3, 0, 0, Math.PI * 2);
        CTX.fillStyle = colors.body;
        CTX.globalAlpha = 0.9;
        CTX.fill();

        // belly highlight
        CTX.beginPath();
        CTX.ellipse(size * 0.05, size * 0.05, size * 0.35, size * 0.15, 0.1, 0, Math.PI * 2);
        CTX.fillStyle = colors.belly;
        CTX.fill();

        // dorsal fin
        const dorsalWag = Math.sin(tick * 0.1 + i) * 0.15;
        CTX.beginPath();
        CTX.moveTo(size * 0.1, -size * 0.28);
        CTX.quadraticCurveTo(0, -size * 0.55 + dorsalWag * size, -size * 0.15, -size * 0.28);
        CTX.fillStyle = colors.fin;
        CTX.globalAlpha = 0.6;
        CTX.fill();

        // pectoral fin
        const pecWag = Math.sin(tick * 0.13 + i * 3) * 0.2;
        CTX.beginPath();
        CTX.moveTo(size * 0.1, size * 0.15);
        CTX.quadraticCurveTo(size * 0.05, size * 0.4 + pecWag * size, size * -0.15, size * 0.22);
        CTX.fillStyle = colors.fin;
        CTX.globalAlpha = 0.5;
        CTX.fill();

        CTX.globalAlpha = 1;

        // eye
        const eyeX = size * 0.32;
        const eyeY = -size * 0.05;
        CTX.beginPath();
        CTX.arc(eyeX, eyeY, size * 0.09, 0, Math.PI * 2);
        CTX.fillStyle = '#e8e8e0';
        CTX.fill();
        CTX.beginPath();
        CTX.arc(eyeX + size * 0.02, eyeY, size * 0.05, 0, Math.PI * 2);
        CTX.fillStyle = '#111';
        CTX.fill();
        CTX.beginPath();
        CTX.arc(eyeX + size * 0.035, eyeY - size * 0.015, size * 0.02, 0, Math.PI * 2);
        CTX.fillStyle = '#fff';
        CTX.fill();

        // mouth
        CTX.beginPath();
        CTX.arc(size * 0.5, size * 0.02, size * 0.04, 0, Math.PI);
        CTX.strokeStyle = 'rgba(0,0,0,0.3)';
        CTX.lineWidth = 0.8;
        CTX.stroke();

        CTX.restore();

        // energy bar (subtle)
        if (STATE.selected === i || n.energy < 40) {
            const barW = size * 1.2;
            const barH = 2;
            const barX = x - barW / 2;
            const barY = y - size * 0.5 - 8;
            CTX.fillStyle = 'rgba(0,0,0,0.3)';
            CTX.fillRect(barX, barY, barW, barH);
            const pct = Math.min(1, n.energy / 100);
            CTX.fillStyle = pct > 0.6 ? '#33ddaa' : pct > 0.3 ? '#ffaa33' : '#ff4433';
            CTX.fillRect(barX, barY, barW * pct, barH);
        }

        // generation badge
        if (n.gen > 0) {
            CTX.globalAlpha = 0.25;
            CTX.fillStyle = '#aaddff';
            CTX.font = '7px monospace';
            CTX.fillText('g' + n.gen, x + size * 0.6, y - size * 0.4);
            CTX.globalAlpha = 1;
        }

        // selected highlight
        if (STATE.selected === i) {
            CTX.beginPath();
            CTX.arc(x, y, size * 0.8, 0, Math.PI * 2);
            CTX.strokeStyle = 'rgba(100,200,255,0.4)';
            CTX.lineWidth = 1.5;
            CTX.setLineDash([3, 3]);
            CTX.stroke();
            CTX.setLineDash([]);
        }

        // random bubbles
        if (Math.random() < 0.003 && n.alive) {
            spawnBubble(x + size * 0.5 * Math.cos(angle), y + size * 0.5 * Math.sin(angle));
        }
    }

    // ---- ENVIRONMENT ----

    function drawWater() {
        // gradient background
        const grad = CTX.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#061828');
        grad.addColorStop(0.3, '#082038');
        grad.addColorStop(0.7, '#0a2848');
        grad.addColorStop(1, '#061525');
        CTX.fillStyle = grad;
        CTX.fillRect(0, 0, W, H);

        // light rays from top
        CTX.save();
        for (let i = 0; i < 5; i++) {
            const rx = W * 0.15 + i * W * 0.18;
            const rw = 30 + Math.sin(tick * 0.02 + i) * 15;
            const grd = CTX.createLinearGradient(rx, 0, rx + rw, H * 0.7);
            grd.addColorStop(0, 'rgba(100,180,255,0.04)');
            grd.addColorStop(0.5, 'rgba(80,160,240,0.02)');
            grd.addColorStop(1, 'transparent');
            CTX.fillStyle = grd;
            CTX.beginPath();
            CTX.moveTo(rx, 0);
            CTX.lineTo(rx + rw + 40, H * 0.7);
            CTX.lineTo(rx - 40, H * 0.7);
            CTX.closePath();
            CTX.fill();
        }
        CTX.restore();

        // caustic shimmer
        CTX.globalAlpha = 0.03;
        for (let i = 0; i < 8; i++) {
            const cx = Math.sin(tick * 0.01 + i * 1.3) * W * 0.4 + W / 2;
            const cy = Math.cos(tick * 0.008 + i * 0.9) * H * 0.3 + H * 0.3;
            const cr = 60 + Math.sin(tick * 0.02 + i) * 30;
            const cg = CTX.createRadialGradient(cx, cy, 0, cx, cy, cr);
            cg.addColorStop(0, 'rgba(150,220,255,1)');
            cg.addColorStop(1, 'transparent');
            CTX.fillStyle = cg;
            CTX.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
        }
        CTX.globalAlpha = 1;
    }

    function drawSandFloor() {
        const sandH = 40;
        const grad = CTX.createLinearGradient(0, H - sandH, 0, H);
        grad.addColorStop(0, '#1a2a20');
        grad.addColorStop(0.3, '#1e3025');
        grad.addColorStop(1, '#162018');
        CTX.fillStyle = grad;
        CTX.fillRect(0, H - sandH, W, sandH);

        // sand texture
        CTX.fillStyle = 'rgba(40,60,35,0.3)';
        for (let i = 0; i < W; i += 3) {
            const sh = Math.sin(i * 0.05) * 3 + Math.sin(i * 0.13) * 2;
            CTX.fillRect(i, H - sandH + sh, 2, 1);
        }

        // pebbles
        CTX.globalAlpha = 0.2;
        const rng = new Array(20).fill(0).map((_, i) => ({ x: (i * W / 20 + 15) % W, r: 2 + Math.sin(i * 7) * 2 }));
        for (const p of rng) {
            CTX.beginPath();
            CTX.ellipse(p.x, H - 12 + Math.sin(p.x) * 3, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
            CTX.fillStyle = '#2a3a28';
            CTX.fill();
        }
        CTX.globalAlpha = 1;
    }

    function drawPlants() {
        for (const p of plants) {
            for (let b = 0; b < p.blades; b++) {
                const baseX = p.x + b * 6 - p.blades * 3;
                const sway = Math.sin(tick * 0.025 + p.phase + b * 0.5) * 12;
                const bladeH = p.h * (0.6 + b * 0.1);

                CTX.beginPath();
                CTX.moveTo(baseX, H - 35);

                const cp1x = baseX + sway * 0.4;
                const cp1y = H - 35 - bladeH * 0.4;
                const cp2x = baseX + sway;
                const cp2y = H - 35 - bladeH * 0.7;
                const tipX = baseX + sway * 1.2;
                const tipY = H - 35 - bladeH;

                CTX.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tipX, tipY);
                CTX.bezierCurveTo(cp2x + 3, cp2y, cp1x + 3, cp1y, baseX + 3, H - 35);

                CTX.fillStyle = `hsla(${p.hue},50%,${20 + b * 3}%,0.7)`;
                CTX.fill();
            }
        }
    }

    function drawBubbles() {
        for (let i = bubbles.length - 1; i >= 0; i--) {
            const b = bubbles[i];
            b.y -= b.speed;
            b.x += Math.sin(tick * 0.05 + b.wobble) * 0.3;
            b.r -= 0.003;
            if (b.y < -10 || b.r <= 0) { bubbles.splice(i, 1); continue; }

            CTX.beginPath();
            CTX.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            CTX.strokeStyle = 'rgba(150,200,255,0.3)';
            CTX.lineWidth = 0.5;
            CTX.stroke();
            CTX.beginPath();
            CTX.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.25, 0, Math.PI * 2);
            CTX.fillStyle = 'rgba(200,230,255,0.4)';
            CTX.fill();
        }
    }

    function drawFood() {
        for (let i = foodParts.length - 1; i >= 0; i--) {
            const f = foodParts[i];
            f.y += f.vy;
            f.x += Math.sin(tick * 0.03 + i) * 0.3;
            f.life -= 0.008;
            if (f.life <= 0 || f.y > H - 35) { foodParts.splice(i, 1); continue; }
            CTX.globalAlpha = f.life * 0.8;
            CTX.fillStyle = '#cc8833';
            CTX.beginPath();
            CTX.arc(f.x, f.y, f.size * f.life, 0, Math.PI * 2);
            CTX.fill();
        }
        CTX.globalAlpha = 1;
    }

    function drawConnections() {
        for (const e of STATE.edges) {
            const a = STATE.nodes[e[0]], b = STATE.nodes[e[1]];
            if (!a || !b || !a.alive || !b.alive) continue;
            CTX.beginPath();
            CTX.moveTo(a.x, a.y);
            // curved connection
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 + Math.sin(tick * 0.03) * 5;
            CTX.quadraticCurveTo(mx, my, b.x, b.y);
            CTX.strokeStyle = 'rgba(60,120,180,0.06)';
            CTX.lineWidth = 0.5;
            CTX.stroke();
        }
    }

    function drawSurface() {
        CTX.beginPath();
        CTX.moveTo(0, 0);
        for (let x = 0; x <= W; x += 5) {
            const y = 3 + Math.sin(x * 0.02 + tick * 0.03) * 2 + Math.sin(x * 0.05 + tick * 0.05) * 1;
            CTX.lineTo(x, y);
        }
        CTX.lineTo(W, 0); CTX.closePath();
        CTX.fillStyle = 'rgba(100,180,255,0.08)';
        CTX.fill();
    }

    // ---- TIMELINE ----

    function drawTimeline() {
        TCTX.fillStyle = 'rgba(4,10,24,0.3)'; TCTX.fillRect(0, 0, TW, TH);
        if (STATE.history.length < 2) return;
        const last = STATE.history.slice(-200);
        const maxC = Math.max(...last.map(h => h.count), 1);

        TCTX.beginPath(); TCTX.strokeStyle = '#33ddaa'; TCTX.lineWidth = 1;
        for (let i = 0; i < last.length; i++) {
            const x = (i / (last.length - 1)) * TW;
            const y = TH - (last[i].count / maxC) * (TH - 10) - 5;
            i === 0 ? TCTX.moveTo(x, y) : TCTX.lineTo(x, y);
        }
        TCTX.stroke();

        if (STATE.nn_history.length > 1) {
            const maxErr = Math.max(...STATE.nn_history.map(h => h.error), 0.01);
            TCTX.beginPath(); TCTX.strokeStyle = '#ff6655'; TCTX.lineWidth = 0.8;
            TCTX.setLineDash([3, 3]);
            for (let i = 0; i < STATE.nn_history.length; i++) {
                const x = (i / (STATE.nn_history.length - 1)) * TW;
                const y = TH - (STATE.nn_history[i].error / maxErr) * (TH - 10) - 5;
                i === 0 ? TCTX.moveTo(x, y) : TCTX.lineTo(x, y);
            }
            TCTX.stroke();
            TCTX.setLineDash([]);
        }
    }

    // ---- MAIN RENDER ----

    function render() {
        tick++;
        drawWater();
        drawSurface();
        drawSandFloor();
        drawPlants();
        drawFood();
        drawConnections();
        STATE.nodes.forEach((n, i) => drawFish(n, i));
        drawBubbles();
        drawTimeline();

        if (STATE.running) AF = requestAnimationFrame(render);
    }

    // ---- INTERACTION ----

    function findNode(mx, my) {
        for (let i = STATE.nodes.length - 1; i >= 0; i--) {
            const n = STATE.nodes[i];
            if (!n.alive) continue;
            const dx = mx - n.x, dy = my - n.y;
            const hitR = Math.max(12, (n.r || 8) * 2);
            if (dx * dx + dy * dy < hitR * hitR) return i;
        }
        return -1;
    }

    CV.addEventListener('mousemove', e => {
        const rect = CV.getBoundingClientRect();
        STATE.mouse.x = e.clientX - rect.left;
        STATE.mouse.y = e.clientY - rect.top;
        if (STATE.dragging !== null && STATE.nodes[STATE.dragging]) {
            STATE.nodes[STATE.dragging].x = STATE.mouse.x;
            STATE.nodes[STATE.dragging].y = STATE.mouse.y;
        }
        const idx = findNode(STATE.mouse.x, STATE.mouse.y);
        if (idx >= 0) {
            CV.style.cursor = 'pointer';
            const n = STATE.nodes[idx];
            TT.style.display = 'block';
            TT.style.left = (STATE.mouse.x + 15) + 'px';
            TT.style.top = (STATE.mouse.y + 15) + 'px';
            TT.innerHTML = `<div style="color:#66ccff;font-weight:bold">${n.label}</div>`
                + `<div>vitality: ${n.energy.toFixed(1)}</div>`
                + `<div>age: ${n.age}</div>`
                + `<div>generation: ${n.gen}</div>`;
        } else {
            CV.style.cursor = 'default';
            TT.style.display = 'none';
        }
    });

    CV.addEventListener('mousedown', e => {
        const idx = findNode(STATE.mouse.x, STATE.mouse.y);
        if (idx >= 0) {
            STATE.selected = idx;
            if (STATE.mode === 'interact' || STATE.mode === 'sculpt') STATE.dragging = idx;
            const n = STATE.nodes[idx];
            SEL.innerHTML = `<div style="color:#66ccff;font-weight:bold">${n.label}</div>`
                + `<div>vitality: ${n.energy.toFixed(1)}</div>`
                + `<div>age: ${n.age}</div>`
                + `<div>generation: ${n.gen}</div>`
                + `<div>position: ${n.x.toFixed(0)}, ${n.y.toFixed(0)}</div>`;
        } else {
            STATE.selected = null;
            SEL.textContent = 'tap a fish';
        }
    });

    CV.addEventListener('mouseup', () => { STATE.dragging = null; });

    CV.addEventListener('dblclick', () => {
        if (STATE.mode === 'sculpt') {
            sendAction('spawn', { x: STATE.mouse.x, y: STATE.mouse.y });
        } else {
            // drop food
            spawnFood(STATE.mouse.x, STATE.mouse.y);
            sendAction('feed_all');
        }
    });

    document.querySelectorAll('[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            STATE.mode = btn.dataset.mode;
            ML.textContent = btn.dataset.mode;
            log('mode: ' + btn.dataset.mode);
            if (btn.dataset.mode === 'analyze') sendAction('analyze');
        });
    });

    ['intensity', 'entropy', 'cohesion', 'decay'].forEach(p => {
        const el = document.getElementById('s_' + p);
        el.addEventListener('input', () => { STATE.params[p] = parseInt(el.value); });
    });

    document.getElementById('btn_pulse').addEventListener('click', () => { sendAction('pulse'); log('wave sent'); });
    document.getElementById('btn_scatter').addEventListener('click', () => { sendAction('scatter'); log('fish scattered'); });
    document.getElementById('btn_collapse').addEventListener('click', () => { sendAction('collapse'); log('schooling'); });
    document.getElementById('btn_evolve').addEventListener('click', () => { sendAction('evolve'); log('evolution cycle'); });
    document.getElementById('btn_reset').addEventListener('click', () => { sendAction('reset'); STATE.history = []; prevAlive = new Set(); log('tank restocked'); });

    const feedBtn = document.getElementById('btn_feed');
    if (feedBtn) feedBtn.addEventListener('click', () => {
        spawnFood(W / 2, 30);
        sendAction('feed_all');
        log('feeding time');
    });

    function autoTick() {
        sendAction('tick');
        // ambient bubbles
        if (Math.random() < 0.1) spawnBubble(Math.random() * W, H - 40);
        setTimeout(autoTick, 800);
    }

    resize();
    fetchState();
    setTimeout(autoTick, 1000);
    render();
    log('aquarium initialized');
})();