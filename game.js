// ============================================================================
// game.js — Studio Edition Game Logic.
// Refactored: Fixed-Timestep, CSS-Variables, Central State, Error Handling.
// ============================================================================

// --- Constants & Config -----------------------------------------------------
const FIXED_STEP = 1 / 60;
const STORAGE_KEY = 'doodle_studio_highscore';

const STATES = {
    START: 'START',
    PLAYING: 'PLAYING',
    GAMEOVER: 'GAMEOVER'
};

// --- UI Elements ------------------------------------------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('game-container');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('gameover-screen');
const scoreDisplay = document.getElementById('score-display');
const hudHighscore = document.getElementById('hud-highscore');
const finalScoreDisplay = document.getElementById('final-score');
const highScoreDisplay = document.getElementById('high-score');
const gameOverReason = document.getElementById('gameover-reason');
const powerupHud = document.getElementById('powerup-hud');
const powerupIcon = document.getElementById('powerup-icon');
const powerupTimerDisplay = document.getElementById('powerup-timer');
const soundToggle = document.getElementById('sound-toggle');
const tiltToggle = document.getElementById('tilt-toggle');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

// --- State Management -------------------------------------------------------
let gameState = STATES.START;
let score = 0;
let highScore = 0;
try {
    highScore = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
} catch (e) {
    console.warn('[Storage] Access denied:', e);
}
let runStartHighScore = highScore;
let recordBeatenShown = false;
let cameraY = 0;
let screenShake = 0;
let globalFrame = 0;
let viewW = 0;
let viewH = 0;

// --- Input State ------------------------------------------------------------
const keys = { left: false, right: false };
let touchSteer = 0;
let tiltGamma = 0;
let tiltEnabled = false;
let activePointerId = null;

// --- Entities ---------------------------------------------------------------
const player = {
    x: 0, y: 0, width: 46, height: 46, vx: 0, vy: 0,
    gravity: 0.37, jumpStrength: -12.4, facing: 'right',
    scaleX: 1, scaleY: 1, spinAngle: 0, shootAnim: 0,
    powerup: null, powerupTime: 0, hasShield: false, shootCooldown: 0
};

let platforms = [], springs = [], trampolines = [], items = [], monsters = [],
    blackHoles = [], bullets = [], particles = [], floatingTexts = [], brokenPieces = [];

// --- Audio ------------------------------------------------------------------
let audioCtx = null;
let soundEnabled = true;

function initAudio() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.error('[Audio] Init failed:', e);
    }
}

function playSound(type) {
    if (!soundEnabled || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    try {
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        const presets = {
            jump: { type: 'sine', f: [195, 550], g: [0.18, 0.001], d: 0.11 },
            spring: { type: 'triangle', f: [240, 920], g: [0.24, 0.001], d: 0.25 },
            trampoline: { type: 'sine', f: [220, 780], g: [0.24, 0.001], d: 0.3 },
            shoot: { type: 'sine', f: [760, 210], g: [0.15, 0.001], d: 0.07 },
            break: { type: 'sawtooth', f: [160, 65], g: [0.2, 0.001], d: 0.14, linear: true },
            monster_hit: { type: 'square', f: [360, 90], g: [0.2, 0.001], d: 0.22 },
            shield_break: { type: 'triangle', f: [520, 180], g: [0.22, 0.001], d: 0.2 },
            jetpack: { type: 'sawtooth', f: [110 + Math.random() * 40, 110], g: [0.07, 0.001], d: 0.08 },
            fall: { type: 'sine', f: [420, 75], g: [0.25, 0.001], d: 0.55 }
        };

        const p = presets[type];
        if (!p) return;

        osc.type = p.type;
        osc.frequency.setValueAtTime(p.f[0], now);
        if (p.linear) osc.frequency.linearRampToValueAtTime(p.f[1], now + p.d);
        else osc.frequency.exponentialRampToValueAtTime(p.f[1], now + p.d);
        
        gain.gain.setValueAtTime(p.g[0], now);
        gain.gain.exponentialRampToValueAtTime(p.g[1], now + p.d);
        
        osc.start(now);
        osc.stop(now + p.d);
    } catch (e) {
        console.warn('[Audio] Play failed:', type, e);
    }
}

// --- Theme Management -------------------------------------------------------
let themeColors = {};
function updateThemeColors() {
    const style = getComputedStyle(container);
    const vars = [
        'bg', 'grid', 'margin-line', 'plat-standard', 'plat-standard-top',
        'plat-moving', 'plat-moving-top', 'plat-break', 'plat-break-top',
        'outline', 'player-body', 'player-pants'
    ];
    themeColors = {};
    vars.forEach(v => themeColors[v] = style.getPropertyValue('--' + v).trim());
}

// --- Spawning Logic ---------------------------------------------------------
function createPlatform(x, y, type = 'standard') {
    return {
        x, y, width: 68, height: 16, type,
        vx: type === 'moving' ? (Math.random() > 0.5 ? 1.85 : -1.85) : 0,
        broken: false, bounceOffset: 0
    };
}

function spawnNextRow(lastY) {
    const difficulty = Math.min(score / 8000, 1);
    const gap = 44 + Math.random() * (42 + difficulty * 28);
    const newY = lastY - gap;
    const platX = 12 + Math.random() * (viewW - 92);

    let type = 'standard';
    const r = Math.random();
    if (score > 400 && r < 0.16 + difficulty * 0.2) type = 'moving';
    else if (score > 900 && r < 0.28 + difficulty * 0.22) type = 'breaking';
    else if (score > 1800 && r < 0.36 + difficulty * 0.15) type = 'disappear';

    const plat = createPlatform(platX, newY, type);
    platforms.push(plat);

    if (type === 'breaking') {
        platforms.push(createPlatform((platX + viewW / 2) % (viewW - 80), newY - 18, 'standard'));
    }

    if (type === 'standard' && newY < viewH - 140) {
        const gadgetRoll = Math.random();
        if (gadgetRoll < 0.11) {
            springs.push({ x: platX + 12 + Math.random() * 30, y: newY - 12, width: 18, height: 12, extended: 0, platform: plat });
        } else if (gadgetRoll < 0.155 && score > 300) {
            trampolines.push({ x: platX + 14, y: newY - 10, width: 40, height: 10, dip: 0, platform: plat });
        } else if (gadgetRoll < 0.205 && newY < viewH - 300) {
            const itemRoll = Math.random(), itemType = itemRoll < 0.38 ? 'jetpack' : (itemRoll < 0.75 ? 'propeller' : 'shield');
            items.push({ x: platX + 19, y: newY - 30, width: 30, height: 30, type: itemType, platform: plat });
        }
    }

    if (score > 850 && Math.random() < 0.08 + difficulty * 0.06 && newY < cameraY - 100) {
        monsters.push({ x: Math.max(20, Math.min(viewW - 75, platX)), y: newY - 46, width: 52, height: 44, alive: true, vx: (Math.random() > 0.5 ? 1 : -1) * (1.2 + difficulty), variant: Math.floor(Math.random() * 3), wingPhase: Math.random() * Math.PI * 2 });
    }

    if (score > 2400 && Math.random() < 0.045 && newY < cameraY - 160) {
        blackHoles.push({ x: 45 + Math.random() * (viewW - 90), y: newY - 55, radius: 28, angle: 0 });
    }
    return newY;
}

// --- Helper Functions ------------------------------------------------------
function spawnParticles(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2, speed = 1.5 + Math.random() * 4.5;
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: 2.5 + Math.random() * 3.5, color, life: 24 + Math.random() * 10 });
    }
}

function addFloatingText(x, y, text, color = '#16a34a') {
    floatingTexts.push({ x, y, text, color, life: 45, vy: -1.4 });
}

function shootBullet(targetX = null) {
    if (player.shootCooldown > 0 || player.powerup) return;
    let vx = 0;
    if (targetX !== null) {
        const centerX = player.x + player.width / 2;
        vx = Math.max(-5.2, Math.min(5.2, (targetX - centerX) * 0.036));
    }
    bullets.push({ x: player.x + player.width / 2, y: player.y - 6, vx: vx, vy: -14.8, radius: 5.5 });
    player.shootCooldown = 9; player.shootAnim = 8; playSound('shoot');
}

// --- Collision Detection ----------------------------------------------------
function checkCollisions() {
    if (player.vy <= 0 || player.powerup) return;

    const footY = player.y + player.height;
    const pLeft = player.x + 11, pRight = player.x + player.width - 11;

    for (let plat of platforms) {
        if (plat.broken) continue;
        if (pRight > plat.x && pLeft < plat.x + plat.width && footY >= plat.y && footY <= plat.y + 14 + player.vy) {
            if (plat.type === 'breaking') {
                plat.broken = true;
                playSound('break');
                brokenPieces.push(
                    { x: plat.x, y: plat.y, w: plat.width / 2, h: plat.height, vx: -1.5, vy: 2, rot: -0.05 },
                    { x: plat.x + plat.width / 2, y: plat.y, w: plat.width / 2, h: plat.height, vx: 1.5, vy: 2, rot: 0.05 }
                );
            } else {
                player.y = plat.y - player.height;
                player.vy = player.jumpStrength;
                player.scaleX = 1.28; player.scaleY = 0.72;
                plat.bounceOffset = 6;
                playSound('jump');
                spawnParticles(player.x + player.width / 2, plat.y, themeColors['plat-standard-top'], 5);
                if (plat.type === 'disappear') {
                    plat.broken = true;
                    spawnParticles(plat.x + plat.width / 2, plat.y + 8, '#38bdf8', 10);
                }
            }
            return;
        }
    }

    for (let s of springs) {
        if (pRight + 3 > s.x && pLeft - 3 < s.x + s.width && footY >= s.y - 4 && footY <= s.y + s.height + player.vy) {
            player.vy = player.jumpStrength * 1.82;
            player.scaleX = 0.75; player.scaleY = 1.35;
            s.extended = 14;
            playSound('spring');
            addFloatingText(s.x, s.y - 10, 'BOING!', '#e11d48');
            return;
        }
    }

    for (let t of trampolines) {
        if (pRight + 3 > t.x && pLeft - 3 < t.x + t.width && footY >= t.y - 4 && footY <= t.y + t.height + player.vy) {
            player.vy = player.jumpStrength * 2.15;
            player.spinAngle = 0.05;
            t.dip = 6;
            playSound('trampoline');
            addFloatingText(t.x + 20, t.y - 14, 'SALTO!', '#0284c7');
            return;
        }
    }
}

// --- Game Loop --------------------------------------------------------------
function update() {
    globalFrame++;
    if (gameState === STATES.START) {
        player.scaleX += (1 - player.scaleX) * 0.18;
        player.scaleY += (1 - player.scaleY) * 0.18;
        player.vy += player.gravity;
        player.y += player.vy;
        const demoPlat = platforms[0];
        if (demoPlat) {
            demoPlat.x = viewW / 2 - 34; demoPlat.y = viewH * 0.56;
            if (demoPlat.bounceOffset > 0) demoPlat.bounceOffset *= 0.75;
            if (player.vy > 0 && player.y + player.height >= demoPlat.y) {
                player.y = demoPlat.y - player.height; player.vy = player.jumpStrength * 0.92;
                player.scaleX = 1.28; player.scaleY = 0.72; demoPlat.bounceOffset = 6;
            }
        }
        return;
    }

    if (gameState !== STATES.PLAYING) return;

    if (screenShake > 0) screenShake *= 0.85;
    if (player.shootCooldown > 0) player.shootCooldown--;
    if (player.shootAnim > 0) player.shootAnim--;
    player.scaleX += (1 - player.scaleX) * 0.18;
    player.scaleY += (1 - player.scaleY) * 0.18;
    if (player.spinAngle !== 0) {
        player.spinAngle += 0.24;
        if (player.spinAngle >= Math.PI * 2) player.spinAngle = 0;
    }

    const maxSpeed = 7.2;
    let inputAxis = 0;
    if (keys.left) inputAxis = -1;
    else if (keys.right) inputAxis = 1;
    else if (touchSteer !== 0) inputAxis = touchSteer;
    else if (tiltEnabled && Math.abs(tiltGamma) > 2.5) inputAxis = Math.max(-1.2, Math.min(1.2, tiltGamma / 18));

    if (inputAxis !== 0) {
        player.vx += (inputAxis * maxSpeed - player.vx) * 0.26;
        player.facing = inputAxis < 0 ? 'left' : 'right';
    } else player.vx *= 0.83;

    player.x += player.vx;
    if (player.x + player.width / 2 < 0) player.x = viewW - player.width / 2;
    if (player.x + player.width / 2 > viewW) player.x = -player.width / 2;

    if (player.powerup === 'jetpack') {
        player.vy = -16.8; player.powerupTime -= FIXED_STEP;
        powerupTimerDisplay.textContent = Math.max(0, player.powerupTime).toFixed(1) + 's';
        if (globalFrame % 4 === 0) playSound('jetpack');
        particles.push({ x: player.x + (player.facing === 'right' ? 8 : player.width - 8) + (Math.random() - 0.5) * 6, y: player.y + player.height - 4, vx: (Math.random() - 0.5) * 2, vy: 5 + Math.random() * 4, radius: 4 + Math.random() * 4, color: Math.random() > 0.4 ? '#f97316' : '#facc15', life: 14 });
        if (player.powerupTime <= 0) { player.powerup = null; powerupHud.classList.add('hidden'); }
    } else if (player.powerup === 'propeller') {
        player.vy = -13.0; player.powerupTime -= FIXED_STEP;
        powerupTimerDisplay.textContent = Math.max(0, player.powerupTime).toFixed(1) + 's';
        if (player.powerupTime <= 0) { player.powerup = null; powerupHud.classList.add('hidden'); }
    } else player.vy += player.gravity;

    player.y += player.vy;
    const targetCamY = player.y - viewH * 0.44;
    if (targetCamY < cameraY) {
        cameraY = targetCamY;
        const newScore = Math.floor(-cameraY / 2.2);
        if (newScore > score) {
            score = newScore; scoreDisplay.textContent = score;
            if (score > highScore) {
                highScore = score; hudHighscore.textContent = '🏆 ' + highScore;
                if (!recordBeatenShown && runStartHighScore > 0) { recordBeatenShown = true; addFloatingText(viewW / 2, cameraY + 120, 'NEUER REKORD! 🏆', '#d97706'); }
            }
        }
    }

    platforms.forEach(p => {
        if (p.bounceOffset > 0) p.bounceOffset *= 0.75;
        if (p.type === 'moving') { p.x += p.vx; if (p.x <= 6 || p.x + p.width >= viewW - 6) p.vx *= -1; }
    });

    checkCollisions();

    springs.forEach(s => { if (s.platform) s.x += s.platform.vx; if (s.extended > 0) s.extended *= 0.9; });
    trampolines.forEach(t => { if (t.platform) t.x += t.platform.vx; if (t.dip > 0) t.dip *= 0.85; });

    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]; if (item.platform) item.x += item.platform.vx;
        if (player.x + player.width > item.x && player.x < item.x + item.width && player.y + player.height > item.y && player.y < item.y + item.height) {
            if (item.type === 'shield') { player.hasShield = true; playSound('spring'); addFloatingText(item.x, item.y, 'SCHILD!', '#0284c7'); }
            else { player.powerup = item.type; player.powerupTime = item.type === 'jetpack' ? 4.2 : 3.2; powerupIcon.textContent = item.type === 'jetpack' ? '🚀' : '🚁'; powerupTimerDisplay.textContent = player.powerupTime.toFixed(1) + 's'; powerupHud.classList.remove('hidden'); playSound('spring'); addFloatingText(item.x, item.y, item.type === 'jetpack' ? 'JETPACK!' : 'PROPELLER!', '#d97706'); }
            items.splice(i, 1);
        }
    }

    blackHoles.forEach(bh => {
        bh.angle += 0.06; const dx = (player.x + player.width / 2) - bh.x, dy = (player.y + player.height / 2) - bh.y, dist = Math.hypot(dx, dy);
        if (dist < 115 && !player.powerup) { player.vx -= dx * 0.012; player.vy -= dy * 0.012; }
        if (dist < bh.radius + 6 && !player.powerup) { screenShake = 12; triggerGameOver('Vom Schwarzen Loch verschluckt!'); }
    });

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]; b.x += b.vx; b.y += b.vy;
        if (b.y < cameraY - 60) { bullets.splice(i, 1); continue; }
        for (let m of monsters) {
            if (m.alive && b.x + b.radius > m.x && b.x - b.radius < m.x + m.width && b.y + b.radius > m.y && b.y - b.radius < m.y + m.height) {
                m.alive = false; bullets.splice(i, 1); screenShake = 8; score += 200; scoreDisplay.textContent = score; playSound('monster_hit'); spawnParticles(m.x + m.width / 2, m.y + m.height / 2, '#f43f5e', 16); addFloatingText(m.x + m.width / 2, m.y, '+200', '#e11d48'); break;
            }
        }
    }

    for (let m of monsters) {
        if (!m.alive) continue; m.wingPhase += 0.18; m.x += m.vx; if (m.x <= 10 || m.x + m.width >= viewW - 10) m.vx *= -1;
        if (player.x + player.width - 9 > m.x && player.x + 9 < m.x + m.width && player.y + player.height - 6 > m.y && player.y + 8 < m.y + m.height) {
            if (player.vy > 0 && player.y + player.height - 16 < m.y + 18) { m.alive = false; player.vy = player.jumpStrength * 1.25; player.scaleX = 1.3; player.scaleY = 0.7; screenShake = 8; score += 250; scoreDisplay.textContent = score; playSound('monster_hit'); spawnParticles(m.x + m.width / 2, m.y + m.height / 2, '#f43f5e', 16); addFloatingText(m.x + m.width / 2, m.y, 'STOMP +250!', '#16a34a'); }
            else if (player.hasShield) { player.hasShield = false; m.alive = false; screenShake = 10; playSound('shield_break'); spawnParticles(m.x + m.width / 2, m.y + m.height / 2, '#38bdf8', 18); addFloatingText(player.x + 20, player.y, 'SCHILD GERETTET!', '#0284c7'); }
            else if (!player.powerup) { screenShake = 14; playSound('monster_hit'); triggerGameOver('Ein Monster hat dich erwischt!'); }
        }
    }

    while (platforms[platforms.length - 1].y > cameraY - viewH) spawnNextRow(platforms[platforms.length - 1].y);

    const cutoffY = cameraY + viewH + 100;
    platforms = platforms.filter(p => p.y < cutoffY); springs = springs.filter(s => s.y < cutoffY); trampolines = trampolines.filter(t => t.y < cutoffY);
    items = items.filter(i => i.y < cutoffY); monsters = monsters.filter(m => m.y < cutoffY && m.alive); blackHoles = blackHoles.filter(bh => bh.y < cutoffY);

    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.life--; if (p.life <= 0) particles.splice(i, 1); }
    for (let i = brokenPieces.length - 1; i >= 0; i--) { const bp = brokenPieces[i]; bp.x += bp.vx; bp.y += bp.vy; bp.vy += 0.35; bp.rot += bp.vx * 0.04; if (bp.y > cutoffY) brokenPieces.splice(i, 1); }
    for (let i = floatingTexts.length - 1; i >= 0; i--) { const ft = floatingTexts[i]; ft.y += ft.vy; ft.life--; if (ft.life <= 0) floatingTexts.splice(i, 1); }

    if (player.y > cameraY + viewH + 40) { playSound('fall'); triggerGameOver('Du bist ins Leere gestürzt!'); }
}

function triggerGameOver(reason) {
    gameState = STATES.GAMEOVER;
    gameOverReason.textContent = reason;
    finalScoreDisplay.textContent = score;
    if (score >= highScore) {
        highScore = score;
        try { localStorage.setItem(STORAGE_KEY, highScore.toString()); } catch (e) {}
    }
    highScoreDisplay.textContent = highScore;
    powerupHud.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
}

// --- Rendering --------------------------------------------------------------
function draw() {
    drawBackground(viewW, viewH);
    ctx.save();
    const shakeX = screenShake > 0.2 ? (Math.random() - 0.5) * screenShake : 0;
    const shakeY = screenShake > 0.2 ? (Math.random() - 0.5) * screenShake : 0;
    ctx.translate(shakeX, -cameraY + shakeY);
    drawHighscoreLine(viewW);
    blackHoles.forEach(drawBlackHole);
    platforms.forEach(drawPlatform);
    brokenPieces.forEach(bp => {
        ctx.save(); ctx.translate(bp.x + bp.w / 2, bp.y + bp.h / 2); ctx.rotate(bp.rot);
        ctx.fillStyle = themeColors['plat-break']; ctx.strokeStyle = themeColors['outline']; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(-bp.w / 2, -bp.h / 2, bp.w, bp.h, 4); ctx.fill(); ctx.stroke(); ctx.restore();
    });
    springs.forEach(drawSpring); trampolines.forEach(drawTrampoline); items.forEach(drawItem); monsters.forEach(drawMonster);
    bullets.forEach(b => { ctx.fillStyle = '#f59e0b'; ctx.strokeStyle = themeColors['outline']; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    particles.forEach(p => { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill(); });
    drawPlayer();
    ctx.font = 'bold 20px "Fredoka", sans-serif'; ctx.textAlign = 'center';
    floatingTexts.forEach(ft => { ctx.globalAlpha = Math.min(1, ft.life / 15); ctx.fillStyle = ft.color; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeText(ft.text, ft.x, ft.y); ctx.fillText(ft.text, ft.x, ft.y); ctx.globalAlpha = 1; });
    ctx.restore();
}

function drawBackground(w, h) {
    ctx.fillStyle = themeColors['bg']; ctx.fillRect(0, 0, w, h);
    const gridSize = 26, offsetY = (-cameraY * 0.5) % gridSize;
    ctx.strokeStyle = themeColors['grid']; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = gridSize; x < w; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = offsetY; y < h; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.strokeStyle = themeColors['margin-line']; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(36, 0); ctx.lineTo(36, h); ctx.stroke();
    if (container.dataset.theme === 'space') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (let i = 0; i < 25; i++) {
            const sx = (i * 97) % w, sy = ((i * 151) - cameraY * 0.2) % h, drawY = sy < 0 ? sy + h : sy;
            ctx.beginPath(); ctx.arc(sx, drawY, (i % 2) + 1, 0, Math.PI * 2); ctx.fill();
        }
    }
}

function drawHighscoreLine(w) {
    if (runStartHighScore <= 0) return;
    const recordY = -runStartHighScore * 2.2 + viewH * 0.44;
    if (recordY > cameraY - 50 && recordY < cameraY + viewH + 50) {
        ctx.save(); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(w - 130, recordY); ctx.lineTo(w, recordY); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 12px "Fredoka", sans-serif'; ctx.textAlign = 'right'; ctx.fillText('REKORD ' + runStartHighScore, w - 8, recordY - 5); ctx.restore();
    }
}

function drawPlatform(plat) {
    if (plat.broken) return;
    const y = plat.y + plat.bounceOffset;
    ctx.save(); ctx.lineWidth = 2.5; ctx.strokeStyle = themeColors['outline'];
    const types = {
        standard: ['plat-standard', 'plat-standard-top'],
        moving: ['plat-moving', 'plat-moving-top'],
        breaking: ['plat-break', 'plat-break-top']
    };
    const colors = types[plat.type];
    if (colors) {
        ctx.fillStyle = themeColors[colors[0]]; ctx.beginPath(); ctx.roundRect(plat.x, y, plat.width, plat.height, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = themeColors[colors[1]]; ctx.beginPath(); ctx.roundRect(plat.x + 2, y + 1.5, plat.width - 4, 6, [6, 6, 2, 2]); ctx.fill();
        if (plat.type === 'breaking') {
            ctx.beginPath(); ctx.moveTo(plat.x + plat.width * 0.45, y); ctx.lineTo(plat.x + plat.width * 0.53, y + 6); ctx.lineTo(plat.x + plat.width * 0.46, y + 11); ctx.lineTo(plat.x + plat.width * 0.52, y + plat.height); ctx.stroke();
        }
    } else if (plat.type === 'disappear') {
        ctx.fillStyle = '#e0f2fe'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.roundRect(plat.x, y, plat.width, plat.height, 8); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
}

function drawSpring(s) {
    const topY = s.y - s.extended; ctx.save(); ctx.strokeStyle = themeColors['outline']; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(s.x + 3, s.y + s.height); ctx.lineTo(s.x + s.width - 3, topY + (s.height + s.extended) * 0.66); ctx.lineTo(s.x + 3, topY + (s.height + s.extended) * 0.33); ctx.lineTo(s.x + s.width - 3, topY + 4); ctx.stroke();
    ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.roundRect(s.x, topY, s.width, 5, 2); ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawTrampoline(t) {
    ctx.save(); ctx.strokeStyle = themeColors['outline']; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(t.x + 5, t.y + 3); ctx.lineTo(t.x + 2, t.y + t.height); ctx.moveTo(t.x + t.width - 5, t.y + 3); ctx.lineTo(t.x + t.width - 2, t.y + t.height); ctx.stroke();
    ctx.fillStyle = '#0ea5e9'; ctx.beginPath(); ctx.roundRect(t.x, t.y + t.dip * 0.5, t.width, 5, 3); ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawItem(item) {
    ctx.save(); ctx.translate(item.x + item.width / 2, item.y + item.height / 2); ctx.strokeStyle = themeColors['outline']; ctx.lineWidth = 2.4;
    if (item.type === 'jetpack') {
        ctx.fillStyle = '#e4e4e7'; ctx.beginPath(); ctx.roundRect(-11, -12, 9, 22, 4); ctx.roundRect(2, -12, 9, 22, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(-6.5, -11, 4.5, Math.PI, 0); ctx.arc(6.5, -11, 4.5, Math.PI, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f97316'; ctx.fillRect(-10, -2, 7, 5); ctx.fillRect(3, -2, 7, 5);
    } else if (item.type === 'propeller') {
        ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.arc(0, 6, 12, Math.PI, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.roundRect(-14, 4, 28, 4, 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, -12); ctx.stroke();
        const bladeW = 14 * Math.cos(globalFrame * 0.35); ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.ellipse(0, -12, Math.abs(bladeW) + 3, 2.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (item.type === 'shield') {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.35)'; ctx.strokeStyle = '#0284c7'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-4, -4, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

function drawMonster(m) {
    if (!m.alive) return;
    ctx.save(); ctx.translate(m.x + m.width / 2, m.y + m.height / 2); ctx.strokeStyle = themeColors['outline']; ctx.lineWidth = 2.6;
    const flap = Math.sin(m.wingPhase) * 6;
    ctx.fillStyle = '#fef08a'; ctx.beginPath(); ctx.ellipse(-24, -4 + flap, 9, 5, -0.4, 0, Math.PI * 2); ctx.ellipse(24, -4 + flap, 9, 5, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const colors = ['#a855f7', '#f43f5e', '#0ea5e9']; ctx.fillStyle = colors[m.variant % colors.length]; ctx.beginPath(); ctx.roundRect(-21, -18, 42, 34, [18, 18, 10, 10]); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.moveTo(-14, -17); ctx.lineTo(-18, -26); ctx.lineTo(-7, -18); ctx.moveTo(14, -17); ctx.lineTo(18, -26); ctx.lineTo(7, -18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-8, -4, 6.5, 0, Math.PI * 2); ctx.arc(8, -4, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#09090b'; ctx.beginPath(); ctx.arc(-7, -4, 2.5, 0, Math.PI * 2); ctx.arc(7, -4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-10, 8); ctx.lineTo(-5, 5); ctx.lineTo(0, 8); ctx.lineTo(5, 5); ctx.lineTo(10, 8); ctx.stroke();
    ctx.restore();
}

function drawBlackHole(bh) {
    ctx.save(); ctx.translate(bh.x, bh.y);
    const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, bh.radius + 14);
    grad.addColorStop(0, '#09090b'); grad.addColorStop(0.55, '#312e81'); grad.addColorStop(0.8, 'rgba(99, 102, 241, 0.35)'); grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, bh.radius + 14, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(bh.angle); ctx.strokeStyle = 'rgba(165, 180, 252, 0.6)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { ctx.rotate((Math.PI * 2) / 3); ctx.beginPath(); ctx.arc(6, 0, 12, 0, Math.PI); ctx.stroke(); }
    ctx.fillStyle = '#09090b'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawPlayer() {
    ctx.save(); const centerX = player.x + player.width / 2, bottomY = player.y + player.height;
    if (player.spinAngle !== 0) { ctx.translate(centerX, player.y + player.height / 2); ctx.rotate(player.facing === 'left' ? -player.spinAngle : player.spinAngle); ctx.translate(0, player.height / 2); }
    else ctx.translate(centerX, bottomY);
    ctx.scale(player.scaleX, player.scaleY);
    if (player.facing === 'left' && player.shootAnim === 0) ctx.scale(-1, 1);
    ctx.strokeStyle = themeColors['outline']; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (player.powerup === 'jetpack') { ctx.fillStyle = '#e4e4e7'; ctx.beginPath(); ctx.roundRect(-24, -36, 11, 24, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(-18.5, -36, 5.5, Math.PI, 0); ctx.fill(); ctx.stroke(); }
    const legKick = Math.max(-4, Math.min(4, player.vy * 0.35));
    ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(-10, -1 + legKick); ctx.lineTo(-6, -1 + legKick); ctx.moveTo(-3, -8); ctx.lineTo(-3, -1 - legKick); ctx.lineTo(1, -1 - legKick); ctx.moveTo(4, -8); ctx.lineTo(4, -1 + legKick); ctx.lineTo(8, -1 + legKick); ctx.moveTo(11, -8); ctx.lineTo(11, -1 - legKick); ctx.lineTo(15, -1 - legKick); ctx.stroke();
    ctx.fillStyle = themeColors['player-body']; ctx.beginPath(); ctx.moveTo(-16, -8); ctx.lineTo(-16, -26); ctx.arc(0, -26, 16, Math.PI, 0); ctx.lineTo(16, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = themeColors['player-pants']; ctx.beginPath(); ctx.rect(-16, -16, 32, 8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, -16); ctx.lineTo(-8, -8); ctx.moveTo(0, -16); ctx.lineTo(0, -8); ctx.moveTo(8, -16); ctx.lineTo(8, -8); ctx.stroke();
    if (player.shootAnim > 0) { ctx.fillStyle = themeColors['player-body']; ctx.beginPath(); ctx.roundRect(-6, -54, 12, 16, 5); ctx.fill(); ctx.stroke(); ctx.fillStyle = themeColors['outline']; ctx.beginPath(); ctx.ellipse(0, -53, 4.5, 2, 0, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = themeColors['player-body']; ctx.beginPath(); ctx.roundRect(10, -28, 15, 10, 5); ctx.fill(); ctx.stroke(); ctx.fillStyle = themeColors['outline']; ctx.beginPath(); ctx.ellipse(24, -23, 2, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#09090b';
    if (player.shootAnim > 0) { ctx.beginPath(); ctx.arc(-6, -32, 2.3, 0, Math.PI * 2); ctx.arc(6, -32, 2.3, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(2, -31, 2.2, 0, Math.PI * 2); ctx.arc(9, -31, 2.2, 0, Math.PI * 2); ctx.fill(); }
    if (player.powerup === 'propeller') { ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.arc(0, -41, 10, Math.PI, 0); ctx.fill(); ctx.stroke(); const bladeW = 16 * Math.cos(globalFrame * 0.6); ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.ellipse(0, -54, Math.abs(bladeW) + 3, 2.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    if (player.hasShield) { ctx.fillStyle = 'rgba(56, 189, 248, 0.22)'; ctx.strokeStyle = '#0284c7'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, -24, 33 + Math.sin(globalFrame * 0.15) * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
}

// --- Initialization & Loop --------------------------------------------------
function resizeCanvas() {
    viewW = container.clientWidth; viewH = container.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = viewW * dpr; canvas.height = viewH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

let lastTime = 0, accumulator = 0;
function loop(now) {
    requestAnimationFrame(loop);
    if (!lastTime) lastTime = now;
    let frameTime = (now - lastTime) / 1000; lastTime = now;
    if (frameTime > 0.25) frameTime = 0.25;
    accumulator += frameTime;
    while (accumulator >= FIXED_STEP) { update(); accumulator -= FIXED_STEP; }
    draw();
}

function initGame() {
    score = 0; runStartHighScore = highScore; recordBeatenShown = false; cameraY = 0; screenShake = 0; scoreDisplay.textContent = '0'; hudHighscore.textContent = '🏆 ' + highScore;
    platforms = []; springs = []; trampolines = []; items = []; monsters = []; blackHoles = []; bullets = []; particles = []; floatingTexts = []; brokenPieces = [];
    player.x = viewW / 2 - player.width / 2; player.y = viewH - 160; player.vx = 0; player.vy = player.jumpStrength; player.scaleX = 0.85; player.scaleY = 1.2; player.spinAngle = 0; player.powerup = null; player.powerupTime = 0; player.hasShield = false; powerupHud.classList.add('hidden');
    let currentY = viewH - 55; platforms.push(createPlatform(viewW / 2 - 34, currentY, 'standard'));
    while (currentY > -viewH * 2) currentY = spawnNextRow(currentY);
}

// --- Event Listeners --------------------------------------------------------
window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', e => { initAudio(); if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true; if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true; if ((e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') && gameState === STATES.PLAYING) shootBullet(); });
window.addEventListener('keyup', e => { if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false; if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false; });

canvas.addEventListener('pointerdown', e => {
    if (gameState !== STATES.PLAYING) return; initAudio(); activePointerId = e.pointerId;
    const rect = canvas.getBoundingClientRect(), relX = e.clientX - rect.left;
    shootBullet(relX); if (!tiltEnabled) touchSteer = relX < rect.width / 2 ? -1 : 1;
});
canvas.addEventListener('pointermove', e => { if (gameState !== STATES.PLAYING || e.pointerId !== activePointerId || tiltEnabled) return; const rect = canvas.getBoundingClientRect(), relX = e.clientX - rect.left; touchSteer = relX < rect.width / 2 ? -1 : 1; });
const clearTouchSteer = e => { if (e.pointerId === activePointerId) { touchSteer = 0; activePointerId = null; } };
canvas.addEventListener('pointerup', clearTouchSteer); canvas.addEventListener('pointercancel', clearTouchSteer);

tiltToggle.addEventListener('click', async e => {
    e.stopPropagation();
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const res = await DeviceOrientationEvent.requestPermission();
            if (res === 'granted') { tiltEnabled = true; tiltToggle.classList.add('bg-emerald-300'); }
            else alert('Neigungssteuerung wurde abgelehnt.');
        } catch (e) { console.error('[Tilt] Permission failed:', e); }
    } else if ('DeviceOrientationEvent' in window) { tiltEnabled = !tiltEnabled; tiltToggle.classList.toggle('bg-emerald-300', tiltEnabled); }
});
window.addEventListener('deviceorientation', e => { if (e.gamma !== null) tiltGamma = Math.max(-30, Math.min(30, e.gamma)); });

soundToggle.addEventListener('click', () => { soundEnabled = !soundEnabled; soundToggle.textContent = soundEnabled ? '🔊' : '🔇'; });

document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('ring-2', 'ring-emerald-500'));
        btn.classList.add('ring-2', 'ring-emerald-500');
        container.dataset.theme = btn.dataset.theme;
        updateThemeColors();
    });
});

startBtn.addEventListener('click', () => { initAudio(); startScreen.classList.add('hidden'); gameState = STATES.PLAYING; initGame(); });
restartBtn.addEventListener('click', () => { initAudio(); gameOverScreen.classList.add('hidden'); gameState = STATES.PLAYING; initGame(); });

// --- Start -----------------------------------------------------------------
resizeCanvas();
updateThemeColors();
initGame();
gameState = STATES.START;
requestAnimationFrame(loop);
