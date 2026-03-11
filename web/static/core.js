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

    // ---- DNA-DRIVEN FISH RENDERING ----

    function dnaColor(dna, energy) {
        const vitality = Math.min(1, energy / 100);
        const r = Math.floor((dna.hue_r || 0.5) * 200 * vitality + 30);
        const g = Math.floor((dna.hue_g || 0.7) * 220 * vitality + 30);
        const b = Math.floor((dna.hue_b || 0.8) * 230 * vitality + 40);
        const br = dna.belly_brightness || 0.6;
        return {
            body: `rgb(${r},${g},${b})`,
            belly: `rgba(${Math.min(255, r + Math.floor(br * 80))},${Math.min(255, g + Math.floor(br * 60))},${Math.min(255, b + Math.floor(br * 40))},0.55)`,
            fin: `rgba(${Math.max(0, r - 20)},${Math.min(255, g + 30)},${Math.min(255, b + 50)},0.65)`,
            pattern: `rgba(${Math.max(0, r - 40)},${Math.max(0, g - 30)},${Math.max(0, b - 20)},${(dna.pattern_contrast || 0.3) * 0.6})`
        };
    }

    function drawFish(n, i) {
        if (!n.alive) return;
        const x = n.x, y = n.y;
        const dna = n.dna || {};
        const baseSize = Math.max(8, Math.min(28, (n.r || 8) * 1.8));

        const bodyLen = (dna.body_length || 1) * baseSize * 0.55;
        const bodyWid = (dna.body_width || 1) * baseSize * 0.3;
        const tailLen = (dna.tail_length || 1) * baseSize * 0.6;
        const tailWid = (dna.tail_width || 1) * baseSize * 0.5;
        const tailFreq = (dna.tail_freq || 1) * 0.15;
        const dorsalH = (dna.dorsal_height || 1) * baseSize * 0.35;
        const dorsalOff = (dna.dorsal_offset || 0.5);
        const pecSize = (dna.pec_size || 1) * baseSize * 0.2;
        const eyeSize = (dna.eye_size || 1) * baseSize * 0.09;
        const eyeOff = (dna.eye_offset || 0.7);
        const mouthSize = (dna.mouth_size || 0.5) * baseSize * 0.06;
        const patternType = dna.pattern_type || 0;
        const patternDensity = dna.pattern_density || 0.5;
        const stripeCount = Math.floor((dna.stripe_count || 0.3) * 5) + 1;

        const colors = dnaColor(dna, n.energy);

        let angle = 0;
        if (n.trail && n.trail.length >= 2) {
            const last = n.trail[n.trail.length - 1];
            const prev = n.trail[n.trail.length - 2];
            angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        }

        const tailWag = Math.sin(tick * tailFreq + i * 2) * 0.35;
        const bodyWobble = Math.sin(tick * 0.08 + i * 1.5) * 1.5;

        CTX.save();
        CTX.translate(x, y + bodyWobble);
        CTX.rotate(angle);

        // tail
        CTX.beginPath();
        CTX.moveTo(-bodyLen * 0.7, 0);
        const ty1 = tailWid * Math.sin(tick * tailFreq * 0.8 + i + tailWag);
        const ty2 = tailWid * 1.3 * Math.sin(tick * tailFreq * 0.8 + i + tailWag + 0.5);
        CTX.quadraticCurveTo(-bodyLen * 0.7 - tailLen * 0.6, ty1, -bodyLen * 0.7 - tailLen, ty2);
        CTX.quadraticCurveTo(-bodyLen * 0.7 - tailLen * 0.6, -ty1 * 0.3, -bodyLen * 0.7, 0);
        CTX.fillStyle = colors.fin;
        CTX.fill();

        // body
        CTX.beginPath();
        CTX.ellipse(0, 0, bodyLen, bodyWid, 0, 0, Math.PI * 2);
        CTX.fillStyle = colors.body;
        CTX.globalAlpha = 0.9;
        CTX.fill();

        // patterns
        CTX.save();
        CTX.clip();
        CTX.globalAlpha = (dna.pattern_contrast || 0.3) * 0.5;

        if (patternType < 0.33) {
            // stripes
            for (let s = 0; s < stripeCount; s++) {
                const sx = -bodyLen + bodyLen * 2 * (s + 0.5) / stripeCount;
                CTX.beginPath();
                CTX.ellipse(sx, 0, bodyLen * 0.08 * patternDensity, bodyWid * 1.1, 0, 0, Math.PI * 2);
                CTX.fillStyle = colors.pattern;
                CTX.fill();
            }
        } else if (patternType < 0.66) {
            // spots
            const spotCount = Math.floor(patternDensity * 8) + 2;
            const rng = i * 137.5;
            for (let s = 0; s < spotCount; s++) {
                const sx = Math.cos(rng + s * 2.4) * bodyLen * 0.6;
                const sy = Math.sin(rng + s * 3.1) * bodyWid * 0.5;
                const sr = bodyLen * 0.06 + bodyLen * 0.04 * Math.sin(s * 1.7);
                CTX.beginPath();
                CTX.arc(sx, sy, sr, 0, Math.PI * 2);
                CTX.fillStyle = colors.pattern;
                CTX.fill();
            }
        } else {
            // gradient band
            const bandGrad = CTX.createLinearGradient(0, -bodyWid, 0, bodyWid);
            bandGrad.addColorStop(0, 'transparent');
            bandGrad.addColorStop(0.3, colors.pattern);
            bandGrad.addColorStop(0.5, colors.pattern);
            bandGrad.addColorStop(0.7, 'transparent');
            CTX.fillStyle = bandGrad;
            CTX.fillRect(-bodyLen, -bodyWid, bodyLen * 2, bodyWid * 2);
        }

        CTX.restore();

        // belly
        CTX.beginPath();
        CTX.ellipse(bodyLen * 0.05, bodyWid * 0.15, bodyLen * 0.6, bodyWid * 0.45, 0.1, 0, Math.PI * 2);
        CTX.fillStyle = colors.belly;
        CTX.globalAlpha = 0.5;
        CTX.fill();
        CTX.globalAlpha = 1;

        // dorsal fin
        const dorsalX = bodyLen * (dorsalOff - 0.5) * 0.8;
        const dorsalWag = Math.sin(tick * 0.1 + i) * 0.15;
        CTX.beginPath();
        CTX.moveTo(dorsalX + bodyLen * 0.15, -bodyWid * 0.85);
        CTX.quadraticCurveTo(dorsalX, -bodyWid * 0.85 - dorsalH + dorsalWag * baseSize, dorsalX - bodyLen * 0.2, -bodyWid * 0.85);
        CTX.fillStyle = colors.fin;
        CTX.globalAlpha = 0.6;
        CTX.fill();

        // pectoral fin
        const pecWag = Math.sin(tick * 0.13 + i * 3) * 0.25;
        CTX.beginPath();
        CTX.moveTo(bodyLen * 0.05, bodyWid * 0.6);
        CTX.quadraticCurveTo(bodyLen * 0.0, bodyWid * 0.6 + pecSize + pecWag * pecSize, -bodyLen * 0.15, bodyWid * 0.65);
        CTX.fillStyle = colors.fin;
        CTX.globalAlpha = 0.5;
        CTX.fill();

        // second pectoral (smaller, behind)
        CTX.beginPath();
        CTX.moveTo(-bodyLen * 0.15, bodyWid * 0.55);
        CTX.quadraticCurveTo(-bodyLen * 0.2, bodyWid * 0.55 + pecSize * 0.7 - pecWag * pecSize * 0.5, -bodyLen * 0.35, bodyWid * 0.55);
        CTX.fillStyle = colors.fin;
        CTX.globalAlpha = 0.35;
        CTX.fill();

        CTX.globalAlpha = 1;

        // eye
        const eyeX = bodyLen * eyeOff;
        const eyeY = -bodyWid * 0.15;
        CTX.beginPath();
        CTX.arc(eyeX, eyeY, eyeSize, 0, Math.PI * 2);
        CTX.fillStyle = '#e8e8e0';
        CTX.fill();
        // iris
        CTX.beginPath();
        CTX.arc(eyeX + eyeSize * 0.2, eyeY, eyeSize * 0.6, 0, Math.PI * 2);
        CTX.fillStyle = `rgb(${Math.floor(30 + (dna.hue_r || 0.5) * 40)},${Math.floor(20 + (dna.hue_g || 0.5) * 30)},${Math.floor(10 + (dna.hue_b || 0.5) * 20)})`;
        CTX.fill();
        // pupil
        CTX.beginPath();
        CTX.arc(eyeX + eyeSize * 0.25, eyeY, eyeSize * 0.35, 0, Math.PI * 2);
        CTX.fillStyle = '#111';
        CTX.fill();
        // glint
        CTX.beginPath();
        CTX.arc(eyeX + eyeSize * 0.4, eyeY - eyeSize * 0.2, eyeSize * 0.18, 0, Math.PI * 2);
        CTX.fillStyle = '#fff';
        CTX.fill();

        // mouth
        CTX.beginPath();
        CTX.arc(bodyLen * 0.9, bodyWid * 0.05, mouthSize, 0, Math.PI);
        CTX.strokeStyle = 'rgba(0,0,0,0.3)';
        CTX.lineWidth = 0.8;
        CTX.stroke();

        CTX.restore();

        // energy bar
        if (STATE.selected === i || n.energy < 40) {
            const barW = baseSize * 1.2;
            const barH = 2;
            const barX = x - barW / 2;
            const barY = y - baseSize * 0.5 - 10;
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
            CTX.fillText('g' + n.gen, x + baseSize * 0.6, y - baseSize * 0.4);
            CTX.globalAlpha = 1;
        }

        // selected ring
        if (STATE.selected === i) {
            CTX.beginPath();
            CTX.arc(x, y, baseSize * 0.9, 0, Math.PI * 2);
            CTX.strokeStyle = 'rgba(100,200,255,0.35)';
            CTX.lineWidth = 1.5;
            CTX.setLineDash([3, 3]);
            CTX.stroke();
            CTX.setLineDash([]);
        }

        // ambient bubbles
        if (Math.random() < 0.003 && n.alive) {
            spawnBubble(x + bodyLen * Math.cos(angle), y + bodyLen * Math.sin(angle));
        }
    }

    // ---- ENVIRONMENT ----

    function drawWater() {
        const grad = CTX.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#061828');
        grad.addColorStop(0.3, '#082038');
        grad.addColorStop(0.7, '#0a2848');
        grad.addColorStop(1, '#061525');
        CTX.fillStyle = grad;
        CTX.fillRect(0, 0, W, H);

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
        CTX.fillStyle = 'rgba(40,60,35,0.3)';
        for (let i = 0; i < W; i += 3) {
            const sh = Math.sin(i * 0.05) * 3 + Math.sin(i * 0.13) * 2;
            CTX.fillRect(i, H - sandH + sh, 2, 1);
        }
        CTX.globalAlpha = 0.2;
        for (let i = 0; i < 20; i++) {
            const px = (i * W / 20 + 15) % W;
            const pr = 2 + Math.sin(i * 7) * 2;
            CTX.beginPath();
            CTX.ellipse(px, H - 12 + Math.sin(px) * 3, pr, pr * 0.6, 0, 0, Math.PI * 2);
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
                const cp1x = baseX + sway * 0.4, cp1y = H - 35 - bladeH * 0.4;
                const cp2x = baseX + sway, cp2y = H - 35 - bladeH * 0.7;
                const tipX = baseX + sway * 1.2, tipY = H - 35 - bladeH;
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
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + Math.sin(tick * 0.03) * 5;
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

    function dnaDescription(dna) {
        if (!dna) return '';
        let traits = [];
        if (dna.body_length > 1.3) traits.push('long');
        else if (dna.body_length < 0.7) traits.push('compact');
        if (dna.body_width > 1.3) traits.push('wide');
        else if (dna.body_width < 0.7) traits.push('slim');
        if (dna.tail_length > 1.3) traits.push('long-tailed');
        else if (dna.tail_length < 0.7) traits.push('stub-tailed');
        if (dna.dorsal_height > 1.3) traits.push('tall dorsal');
        else if (dna.dorsal_height < 0.5) traits.push('flat dorsal');
        if (dna.eye_size > 1.3) traits.push('big-eyed');
        else if (dna.eye_size < 0.7) traits.push('small-eyed');
        if (dna.pattern_type < 0.33) traits.push('striped');
        else if (dna.pattern_type < 0.66) traits.push('spotted');
        else traits.push('banded');
        if (dna.consume_rate < 0.35) traits.push('efficient');
        else if (dna.consume_rate > 0.7) traits.push('hungry');
        return traits.join(', ');
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
            const traits = dnaDescription(n.dna);
            TT.style.display = 'block';
            TT.style.left = (STATE.mouse.x + 15) + 'px';
            TT.style.top = (STATE.mouse.y + 15) + 'px';
            TT.innerHTML = `<div style="color:#66ccff;font-weight:bold">${n.label}</div>`
                + `<div>vitality: ${n.energy.toFixed(1)}</div>`
                + `<div>age: ${n.age} · gen ${n.gen}</div>`
                + (traits ? `<div style="color:#88aacc;margin-top:3px">${traits}</div>` : '');
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
            const traits = dnaDescription(n.dna);
            SEL.innerHTML = `<div style="color:#66ccff;font-weight:bold;margin-bottom:4px">${n.label}</div>`
                + `<div>vitality: ${n.energy.toFixed(1)}</div>`
                + `<div>age: ${n.age}</div>`
                + `<div>generation: ${n.gen}</div>`
                + `<div>position: ${n.x.toFixed(0)}, ${n.y.toFixed(0)}</div>`
                + (traits ? `<div style="color:#88aacc;margin-top:4px;border-top:1px solid #15305a;padding-top:4px">traits: ${traits}</div>` : '');
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
        if (Math.random() < 0.1) spawnBubble(Math.random() * W, H - 40);
        setTimeout(autoTick, 800);
    }

    resize();
    fetchState();
    setTimeout(autoTick, 1000);
    render();
    log('aquarium initialized');
})();