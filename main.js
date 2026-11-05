'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// ---- 設定 ----
const PADDLE_W = 80;
const PADDLE_H = 12;
const PADDLE_SPEED = 7;
const BALL_R = 7;
const BALL_SPEED = 5;
const BRICK_ROWS = 6;
const BRICK_COLS = 8;
const BRICK_GAP = 6;
const BRICK_TOP = 70;
const BRICK_SIDE = 20;
const BRICK_H = 20;
const BRICK_W = (W - BRICK_SIDE * 2 - BRICK_GAP * (BRICK_COLS - 1)) / BRICK_COLS;
const ROW_COLORS = ['#ff595e', '#ff924c', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'];
const INITIAL_LIVES = 3;
const MAX_LIVES = 6;

// ---- アイテム設定 ----
const ITEM_DROP_RATE = 0.18;   // ブロック破壊時のドロップ確率
const ITEM_W = 36;
const ITEM_H = 16;
const ITEM_SPEED = 2.5;
const ITEM_SCORE = 50;
const EFFECT_FRAMES = 600;     // 拡大・スローの持続(約10秒)
const PIERCE_FRAMES = 360;     // 貫通の持続(約6秒)
const WIDE_SCALE = 1.6;
const SLOW_SCALE = 0.6;
const MAX_BALLS = 12;
const MULTI_ANGLE = 0.35;      // マルチボールの分裂角(ラジアン)
const ITEM_TYPES = {
  wide:   { label: 'W', name: '拡大',   color: '#1982c4', weight: 3 },
  multi:  { label: 'M', name: 'マルチ', color: '#8ac926', weight: 3 },
  slow:   { label: 'S', name: 'スロー', color: '#ffca3a', weight: 3 },
  pierce: { label: 'P', name: '貫通',   color: '#ff924c', weight: 2 },
  life:   { label: '♥', name: '1UP',    color: '#ff6fb5', weight: 1 },
};

// ---- 保存(localStorage) ----
// 読み書きはプライベートモード等で失敗することがあるので try/catch で囲む
const HIGH_SCORE_KEY = 'breakout.highScore';
const SOUND_KEY = 'breakout.sound';
function loadStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function saveStorage(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* 保存できなくても遊べるようにする */ }
}

// ---- 状態 ----
let paddle, balls, bricks, items, popups, effects, score, lives, level, state;
let highScore = Math.max(0, parseInt(loadStorage(HIGH_SCORE_KEY), 10) || 0);
let newRecord = false;   // 今回のゲームでハイスコアを更新したか
let soundOn = loadStorage(SOUND_KEY) !== 'off';   // 既定は ON
// state: 'ready' | 'playing' | 'paused' | 'gameover' | 'clear'
const keys = { left: false, right: false };

// ---- 効果音(Web Audio API で音を合成。音声ファイルは使わない) ----
let audioCtx = null;
// ブラウザの自動再生制限のため、AudioContext は最初の操作時に作る
function getAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
// 1音鳴らす。freq: 開始周波数, to: 終了周波数, dur: 長さ(秒), delay: 開始までの遅れ(秒)
function tone(freq, dur, { type = 'square', to = freq, vol = 0.08, delay = 0 } = {}) {
  const ac = getAudio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}
const SOUNDS = {
  launch:   () => tone(440, 0.08, { to: 660 }),
  paddle:   () => tone(300, 0.06, { type: 'triangle', vol: 0.15 }),
  wall:     () => tone(220, 0.03, { type: 'triangle', vol: 0.08 }),
  brick:    () => tone(660 + Math.random() * 120, 0.07),
  item:     () => { tone(660, 0.08); tone(990, 0.12, { delay: 0.08 }); },
  lose:     () => tone(400, 0.4, { type: 'sawtooth', to: 80 }),
  gameover: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.15, delay: i * 0.2 })),
  clear:    () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { vol: 0.07, delay: i * 0.12 })),
};
function playSound(name) {
  if (soundOn) SOUNDS[name]();
}

const soundButton = document.getElementById('sound-toggle');
function updateSoundButton() {
  if (!soundButton) return;
  soundButton.textContent = soundOn ? '🔊 効果音: ON' : '🔇 効果音: OFF';
  soundButton.setAttribute('aria-pressed', String(soundOn));
}
function toggleSound() {
  soundOn = !soundOn;
  saveStorage(SOUND_KEY, soundOn ? 'on' : 'off');
  updateSoundButton();
  if (soundOn) playSound('item');   // ON にしたことが分かるように鳴らす
}
if (soundButton) {
  soundButton.addEventListener('click', () => {
    toggleSound();
    soundButton.blur();   // フォーカスが残るとスペースキーでボタンが反応してしまうため外す
  });
}
updateSoundButton();

// ---- ハイスコア ----
// スコアがハイスコアを超えたら更新して保存する
function updateHighScore() {
  if (score > highScore) {
    highScore = score;
    newRecord = true;
    saveStorage(HIGH_SCORE_KEY, highScore);
  }
}

function createBricks() {
  const list = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    for (let c = 0; c < BRICK_COLS; c++) {
      list.push({
        x: BRICK_SIDE + c * (BRICK_W + BRICK_GAP),
        y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
        color: ROW_COLORS[r % ROW_COLORS.length],
        points: (BRICK_ROWS - r) * 10,
        alive: true,
      });
    }
  }
  return list;
}

// ---- 速度 ----
function currentSpeed() {
  const base = BALL_SPEED + (level - 1) * 0.7;
  return effects.slow > 0 ? base * SLOW_SCALE : base;
}
function applySpeedToAll() {
  const s = currentSpeed();
  for (const b of balls) {
    const m = Math.hypot(b.vx, b.vy);
    if (m > 0) { b.vx *= s / m; b.vy *= s / m; }
  }
}

// ---- パドル ----
function clampPaddle() {
  paddle.x = Math.max(0, Math.min(W - paddle.w, paddle.x));
}
// 中心を保ったまま幅を変える
function setPaddleWidth(w) {
  const cx = paddle.x + paddle.w / 2;
  paddle.w = w;
  paddle.x = cx - w / 2;
  clampPaddle();
}

function resetEffects() {
  effects = { wide: 0, slow: 0, pierce: 0 };
  setPaddleWidth(PADDLE_W);
}

function resetBall() {
  balls = [{ x: paddle.x + paddle.w / 2, y: paddle.y - BALL_R - 1, vx: 0, vy: 0 }];
  state = 'ready';
}

function newGame() {
  score = 0;
  newRecord = false;
  lives = INITIAL_LIVES;
  level = 1;
  startLevel();
}

function startLevel() {
  paddle = { x: (W - PADDLE_W) / 2, y: H - 40, w: PADDLE_W, h: PADDLE_H };
  bricks = createBricks();
  items = [];
  popups = [];
  resetEffects();
  resetBall();
}

function loseLife() {
  lives--;
  items = [];
  resetEffects();
  if (lives <= 0) {
    state = 'gameover';
    updateHighScore();
    playSound('gameover');
  } else {
    playSound('lose');
    resetBall();
  }
}

function launch() {
  if (state === 'ready') {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * (Math.PI / 3);
    balls[0].vx = Math.cos(angle) * currentSpeed();
    balls[0].vy = Math.sin(angle) * currentSpeed();
    state = 'playing';
    playSound('launch');
  } else if (state === 'gameover') {
    newGame();
  } else if (state === 'clear') {
    level++;
    startLevel();
  }
}

// ---- アイテム ----
function pickItemType() {
  const entries = Object.entries(ITEM_TYPES);
  const total = entries.reduce((sum, [, t]) => sum + t.weight, 0);
  let r = Math.random() * total;
  for (const [type, t] of entries) {
    r -= t.weight;
    if (r < 0) return type;
  }
  return entries[0][0];
}

function destroyBrick(b) {
  b.alive = false;
  score += b.points;
  updateHighScore();
  playSound('brick');
  if (Math.random() < ITEM_DROP_RATE) {
    items.push({ x: b.x + BRICK_W / 2, y: b.y + BRICK_H / 2, type: pickItemType() });
  }
}

function applyItem(item) {
  switch (item.type) {
    case 'wide':
      effects.wide = EFFECT_FRAMES;
      setPaddleWidth(PADDLE_W * WIDE_SCALE);
      break;
    case 'slow':
      effects.slow = EFFECT_FRAMES;
      applySpeedToAll();
      break;
    case 'pierce':
      effects.pierce = PIERCE_FRAMES;
      break;
    case 'multi': {
      // 各ボールを左右に分裂させる
      const added = [];
      for (const b of balls) {
        for (const sign of [-1, 1]) {
          if (balls.length + added.length >= MAX_BALLS) break;
          const a = MULTI_ANGLE * sign;
          added.push({
            x: b.x,
            y: b.y,
            vx: b.vx * Math.cos(a) - b.vy * Math.sin(a),
            vy: b.vx * Math.sin(a) + b.vy * Math.cos(a),
          });
        }
      }
      balls.push(...added);
      break;
    }
    case 'life':
      lives = Math.min(MAX_LIVES, lives + 1);
      break;
  }
  score += ITEM_SCORE;
  updateHighScore();
  playSound('item');
  popups.push({ text: ITEM_TYPES[item.type].name, x: item.x, y: paddle.y - 10, life: 45 });
}

function updateItems() {
  for (const it of items) {
    it.y += ITEM_SPEED;
    if (
      it.x + ITEM_W / 2 > paddle.x &&
      it.x - ITEM_W / 2 < paddle.x + paddle.w &&
      it.y + ITEM_H / 2 >= paddle.y &&
      it.y - ITEM_H / 2 <= paddle.y + paddle.h
    ) {
      it.taken = true;
      applyItem(it);
    }
  }
  items = items.filter((it) => !it.taken && it.y - ITEM_H / 2 <= H);
}

function updateEffects() {
  if (effects.wide > 0 && --effects.wide === 0) setPaddleWidth(PADDLE_W);
  if (effects.slow > 0 && --effects.slow === 0) applySpeedToAll();
  if (effects.pierce > 0) effects.pierce--;
}

function updatePopups() {
  for (const p of popups) { p.y -= 0.6; p.life--; }
  popups = popups.filter((p) => p.life > 0);
}

// ---- 入力 ----
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
  if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); launch(); }
  if ((e.key === 'm' || e.key === 'M') && !e.repeat) toggleSound();
  if (e.key === 'p' || e.key === 'P') {
    if (state === 'playing') state = 'paused';
    else if (state === 'paused') state = 'playing';
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
});

function pointerToCanvasX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left) * (W / rect.width);
}
function movePaddleTo(x) {
  paddle.x = x - paddle.w / 2;
  clampPaddle();
}
canvas.addEventListener('mousemove', (e) => {
  if (state !== 'paused') movePaddleTo(pointerToCanvasX(e.clientX));
});
canvas.addEventListener('click', launch);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  movePaddleTo(pointerToCanvasX(e.touches[0].clientX));
  launch();
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (state !== 'paused') movePaddleTo(pointerToCanvasX(e.touches[0].clientX));
}, { passive: false });

// ---- 更新 ----
function update() {
  if (state === 'paused' || state === 'gameover' || state === 'clear') return;

  if (keys.left) paddle.x -= PADDLE_SPEED;
  if (keys.right) paddle.x += PADDLE_SPEED;
  clampPaddle();

  if (state === 'ready') {
    balls[0].x = paddle.x + paddle.w / 2;
    balls[0].y = paddle.y - BALL_R - 1;
    return;
  }

  updateEffects();
  updateItems();
  updatePopups();

  // 高速時のすり抜け防止のため分割して移動
  const steps = Math.ceil(currentSpeed() / 3);
  for (const b of balls) {
    for (let i = 0; i < steps; i++) {
      b.x += b.vx / steps;
      b.y += b.vy / steps;
      const result = stepCollisions(b);
      if (result === 'clear') return;
      if (result === 'lost') { b.lost = true; break; }
    }
  }
  balls = balls.filter((b) => !b.lost);
  if (balls.length === 0) loseLife();
}

// 1つのボールの衝突処理。落下なら 'lost'、全ブロック破壊なら 'clear' を返す
function stepCollisions(ball) {
  // 壁
  if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); playSound('wall'); }
  if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); playSound('wall'); }
  if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); playSound('wall'); }

  // 落下
  if (ball.y - BALL_R > H) return 'lost';

  // パドル
  if (
    ball.vy > 0 &&
    ball.y + BALL_R >= paddle.y &&
    ball.y - BALL_R <= paddle.y + paddle.h &&
    ball.x >= paddle.x - BALL_R &&
    ball.x <= paddle.x + paddle.w + BALL_R
  ) {
    // 当たった位置で反射角を変える(-1〜1)
    const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
    const angle = Math.max(-1, Math.min(1, hit)) * (Math.PI / 3); // 最大60度
    const speed = currentSpeed();
    ball.vx = speed * Math.sin(angle);
    ball.vy = -speed * Math.cos(angle);
    ball.y = paddle.y - BALL_R;
    playSound('paddle');
  }

  // ブロック
  for (const b of bricks) {
    if (!b.alive) continue;
    const nearestX = Math.max(b.x, Math.min(ball.x, b.x + BRICK_W));
    const nearestY = Math.max(b.y, Math.min(ball.y, b.y + BRICK_H));
    const dx = ball.x - nearestX;
    const dy = ball.y - nearestY;
    if (dx * dx + dy * dy <= BALL_R * BALL_R) {
      destroyBrick(b);
      // 貫通中は反射せずに突き抜ける
      if (effects.pierce <= 0) {
        // めり込みが浅い方向に反射
        const overlapX = BALL_R - Math.abs(dx);
        const overlapY = BALL_R - Math.abs(dy);
        if (dx !== 0 && (dy === 0 || overlapX < overlapY)) {
          ball.vx = Math.sign(dx) * Math.abs(ball.vx);
        } else {
          ball.vy = (dy !== 0 ? Math.sign(dy) : -Math.sign(ball.vy)) * Math.abs(ball.vy);
        }
      }
      if (bricks.every((br) => !br.alive)) {
        state = 'clear';
        playSound('clear');
        return 'clear';
      }
      break; // 1ステップで1ブロックまで
    }
  }
  return null;
}

// ---- 描画 ----
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawText(text, y, size = 28, color = '#fff') {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, y);
}

function drawEffectsHud() {
  const active = [
    ['wide', effects.wide],
    ['slow', effects.slow],
    ['pierce', effects.pierce],
  ].filter(([, t]) => t > 0);
  if (active.length === 0) return;
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  let x = 16;
  for (const [type, t] of active) {
    const label = `${ITEM_TYPES[type].name} ${Math.ceil(t / 60)}s`;
    ctx.fillStyle = ITEM_TYPES[type].color;
    ctx.fillText(label, x, 52);
    x += ctx.measureText(label).width + 14;
  }
}

function drawItems() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px system-ui, sans-serif';
  for (const it of items) {
    const t = ITEM_TYPES[it.type];
    ctx.fillStyle = t.color;
    roundRect(it.x - ITEM_W / 2, it.y - ITEM_H / 2, ITEM_W, ITEM_H, ITEM_H / 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillText(t.label, it.x, it.y + 1);
  }
  ctx.textBaseline = 'alphabetic';
}

function drawPopups() {
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px system-ui, sans-serif';
  for (const p of popups) {
    ctx.globalAlpha = p.life / 45;
    ctx.fillStyle = '#fff';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // HUD
  ctx.fillStyle = '#ddd';
  ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${score}`, 16, 30);
  ctx.textAlign = 'center';
  ctx.fillText(`LEVEL ${level}`, W / 2, 30);
  ctx.textAlign = 'right';
  ctx.fillText('♥'.repeat(Math.max(0, lives)), W - 16, 30);
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText(`HI: ${highScore}`, W - 16, 52);
  drawEffectsHud();

  // ブロック
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.fillStyle = b.color;
    roundRect(b.x, b.y, BRICK_W, BRICK_H, 4);
    ctx.fill();
  }

  drawItems();

  // パドル
  ctx.fillStyle = effects.wide > 0 ? '#9fd3ff' : '#e0e0e0';
  roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 6);
  ctx.fill();

  // ボール
  if (state !== 'gameover') {
    const piercing = effects.pierce > 0;
    ctx.fillStyle = piercing ? '#ff924c' : '#ff2a2a';
    if (piercing) { ctx.shadowColor = '#ffca3a'; ctx.shadowBlur = 12; }
    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  drawPopups();

  // オーバーレイ
  if (state !== 'playing') {
    if (state !== 'ready') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, W, H);
    }
    if (state === 'ready') {
      drawText('スペース / クリックで発射', H / 2 + 80, 20, '#ccc');
    } else if (state === 'paused') {
      drawText('一時停止中', H / 2, 32);
      drawText('P で再開', H / 2 + 40, 18, '#ccc');
    } else if (state === 'gameover') {
      drawText('GAME OVER', H / 2 - 10, 40, '#ff595e');
      drawText(`SCORE: ${score}`, H / 2 + 30, 22);
      if (newRecord) drawText('ハイスコア更新!', H / 2 + 60, 20, '#ffca3a');
      else drawText(`HI: ${highScore}`, H / 2 + 60, 18, '#aaa');
      drawText('スペース / クリックでリトライ', H / 2 + 100, 18, '#ccc');
    } else if (state === 'clear') {
      drawText('STAGE CLEAR!', H / 2 - 10, 40, '#8ac926');
      drawText(`SCORE: ${score}`, H / 2 + 30, 22);
      drawText('スペース / クリックで次のレベルへ', H / 2 + 70, 18, '#ccc');
    }
  }
}

// ---- ループ ----
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

newGame();
loop();
