const MOBILE_BREAKPOINT = 760;
const STORAGE_KEY = 'palm-brick-breaker-local-scores';
const MAX_LEADERBOARD_ENTRIES = 10;
const TRACKING_SAMPLE_RATE = 1000 / 30;
const LEVEL_SPEED_MULTIPLIER = 1.1;
const LEVEL_PADDLE_MULTIPLIER = 0.92;
const MAX_PADDLE_OVERSCAN = 48;

const dimensions = createDimensions();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const video = document.getElementById('videoElement');

const scoreElement = document.getElementById('scoreElement');
const levelElement = document.getElementById('levelElement');
const livesElement = document.getElementById('livesElement');
const trackingStatus = document.getElementById('trackingStatus');
const tutorialStatus = document.getElementById('tutorialStatus');
const palmIndicator = document.getElementById('palmIndicator');
const pauseOverlay = document.getElementById('pauseOverlay');

const startButton = document.getElementById('startButton');
const restartButton = document.getElementById('restartButton');
const toggleLeaderboardButton = document.getElementById('toggleLeaderboardButton');
const leaderboardPanel = document.getElementById('leaderboardPanel');
const leaderboardContent = document.getElementById('leaderboardContent');

const gameOverDialog = document.getElementById('gameOverDialog');
const saveScoreForm = document.getElementById('saveScoreForm');
const skipScoreButton = document.getElementById('skipScoreButton');
const playerNameInput = document.getElementById('playerNameInput');
const finalLevel = document.getElementById('finalLevel');
const finalScore = document.getElementById('finalScore');

canvas.width = dimensions.canvas;
canvas.height = dimensions.canvas;
video.width = dimensions.videoWidth;
video.height = dimensions.videoHeight;

const BRICK_ROWS_MAX = 4;
const BRICK_COLUMNS = 8;
const BRICK_DATA_SIZE = 3;
const bricks = new Float32Array(BRICK_ROWS_MAX * BRICK_COLUMNS * BRICK_DATA_SIZE);

const state = {
    running: false,
    gameOver: false,
    awaitingLaunch: true,
    modalDismissed: false,
    handReady: false,
    trackingReady: false,
    trackingLost: false,
    noHandFrames: 0,
    trackingLastTick: 0,
    paddleNormalizedX: 0.5,
    leaderboard: loadLeaderboard(),
    animationFrame: null,
    hands: null,
    videoStream: null,
    lastFrameTime: 0,
    notification: {
        text: '',
        until: 0,
        tone: 'accent'
    },
    stats: {
        level: 1,
        lives: 3,
        score: 0,
        bricksRemaining: 0
    },
    paddle: {
        width: dimensions.initialPaddleWidth,
        height: dimensions.paddleHeight,
        x: dimensions.canvas / 2 - dimensions.initialPaddleWidth / 2,
        y: dimensions.canvas - dimensions.paddleBottomOffset
    },
    ball: {
        x: dimensions.canvas / 2,
        y: dimensions.canvas - dimensions.ballBottomOffset,
        radius: dimensions.ballRadius,
        dx: dimensions.initialBallSpeed,
        dy: -dimensions.initialBallSpeed,
        speed: dimensions.initialBallSpeed,
        active: true
    }
};

function createDimensions() {
    const isCompact = window.innerWidth < MOBILE_BREAKPOINT;
    const canvasSize = isCompact ? 360 : 720;
    return {
        compact: isCompact,
        canvas: canvasSize,
        videoWidth: isCompact ? 96 : 176,
        videoHeight: isCompact ? 72 : 132,
        initialPaddleWidth: isCompact ? 88 : 160,
        paddleHeight: isCompact ? 9 : 16,
        ballRadius: isCompact ? 6 : 9,
        initialBallSpeed: isCompact ? 5.2 : 6.4,
        brickWidth: isCompact ? 37 : 76,
        brickHeight: isCompact ? 12 : 24,
        brickPadding: isCompact ? 5 : 10,
        brickOffsetTop: isCompact ? 72 : 108,
        brickOffsetLeft: isCompact ? 17 : 31,
        paddleBottomOffset: isCompact ? 24 : 36,
        ballBottomOffset: isCompact ? 34 : 50
    };
}

function getVisibleBrickRows(level) {
    if (level === 1) return 2;
    if (level === 2) return 3;
    return 4;
}

function resetBall() {
    state.awaitingLaunch = true;
    state.ball.active = true;
    state.ball.x = state.paddle.x + state.paddle.width / 2;
    state.ball.y = state.paddle.y - state.ball.radius - 2;
    state.ball.dx = state.ball.speed * (Math.random() > 0.5 ? 1 : -1);
    state.ball.dy = -state.ball.speed;
}

function initBricks() {
    bricks.fill(0);
    const rows = getVisibleBrickRows(state.stats.level);
    state.stats.bricksRemaining = rows * BRICK_COLUMNS;

    for (let column = 0; column < BRICK_COLUMNS; column += 1) {
        for (let row = 0; row < rows; row += 1) {
            const index = (column * BRICK_ROWS_MAX + row) * BRICK_DATA_SIZE;
            bricks[index] = column * (dimensions.brickWidth + dimensions.brickPadding) + dimensions.brickOffsetLeft;
            bricks[index + 1] = row * (dimensions.brickHeight + dimensions.brickPadding) + dimensions.brickOffsetTop;
            bricks[index + 2] = 1;
        }
    }
}

function updateHud() {
    scoreElement.textContent = String(state.stats.score);
    levelElement.textContent = String(state.stats.level);
    livesElement.textContent = Array.from({ length: state.stats.lives }, () => '[*]').join(' ');
}

function setTrackingState(mode, message) {
    trackingStatus.textContent = message;
    trackingStatus.className = `status-pill ${mode}`;
    tutorialStatus.textContent = message;
}

function setNotification(text, tone = 'accent', duration = 1500) {
    state.notification.text = text;
    state.notification.tone = tone;
    state.notification.until = performance.now() + duration;
}

function syncPaddleWithTracking() {
    const targetX = state.paddleNormalizedX * dimensions.canvas - state.paddle.width / 2;
    state.paddle.x = clamp(targetX, -MAX_PADDLE_OVERSCAN, dimensions.canvas - state.paddle.width + MAX_PADDLE_OVERSCAN);
}

function beginGame() {
    state.running = true;
    state.awaitingLaunch = false;
    state.modalDismissed = true;
    startButton.textContent = 'Tracking active';
    startButton.disabled = true;
    setNotification('Go!', 'accent', 900);
}

function pauseForTrackingLoss() {
    if (!state.running || state.gameOver) return;
    state.running = false;
    state.trackingLost = true;
    pauseOverlay.classList.remove('hidden');
    setTrackingState('status-lost', 'Hand lost');
}

function resumeAfterTrackingRecovery() {
    if (!state.modalDismissed || state.gameOver || !state.trackingLost) return;
    state.running = true;
    state.trackingLost = false;
    pauseOverlay.classList.add('hidden');
    setTrackingState('status-ready', 'Ready');
}

function loseLife() {
    state.stats.lives -= 1;
    updateHud();

    if (state.stats.lives <= 0) {
        finishGame();
        return;
    }

    resetBall();
    setNotification(`${state.stats.lives} lives left`, 'warn');
}

function levelUp() {
    state.stats.level += 1;
    state.ball.speed *= LEVEL_SPEED_MULTIPLIER;
    state.paddle.width = Math.max(dimensions.compact ? 56 : 96, state.paddle.width * LEVEL_PADDLE_MULTIPLIER);
    updateHud();
    initBricks();
    resetBall();
    setNotification(`Level ${state.stats.level}`, 'accent', 1800);
}

function finishGame() {
    state.running = false;
    state.gameOver = true;
    state.ball.active = false;
    finalLevel.textContent = String(state.stats.level);
    finalScore.textContent = String(state.stats.score);
    playerNameInput.value = '';
    if (typeof gameOverDialog.showModal === 'function' && !gameOverDialog.open) {
        gameOverDialog.showModal();
    }
}

function restartGame() {
    state.running = false;
    state.gameOver = false;
    state.awaitingLaunch = true;
    state.stats.level = 1;
    state.stats.lives = 3;
    state.stats.score = 0;
    state.paddle.width = dimensions.initialPaddleWidth;
    state.ball.speed = dimensions.initialBallSpeed;
    state.trackingLost = false;
    pauseOverlay.classList.add('hidden');
    updateHud();
    initBricks();
    syncPaddleWithTracking();
    resetBall();

    if (gameOverDialog.open) {
        gameOverDialog.close();
    }

    if (state.handReady) {
        startButton.textContent = 'Start game';
        startButton.disabled = false;
        setTrackingState('status-ready', 'Ready');
    } else {
        startButton.textContent = 'Finding your hand...';
        startButton.disabled = true;
        setTrackingState('status-loading', 'Loading');
    }
}

function drawBackground() {
    ctx.fillStyle = '#061018';
    ctx.fillRect(0, 0, dimensions.canvas, dimensions.canvas);

    ctx.strokeStyle = 'rgba(100, 190, 255, 0.08)';
    ctx.lineWidth = 1;

    for (let x = 0; x < dimensions.canvas; x += dimensions.compact ? 24 : 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, dimensions.canvas);
        ctx.stroke();
    }

    for (let y = 0; y < dimensions.canvas; y += dimensions.compact ? 24 : 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(dimensions.canvas, y);
        ctx.stroke();
    }
}

function drawBricks() {
    for (let index = 0; index < bricks.length; index += BRICK_DATA_SIZE) {
        if (bricks[index + 2] !== 1) continue;

        const x = bricks[index];
        const y = bricks[index + 1];
        const gradient = ctx.createLinearGradient(x, y, x + dimensions.brickWidth, y + dimensions.brickHeight);
        gradient.addColorStop(0, '#ffba49');
        gradient.addColorStop(1, '#ff6b57');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, dimensions.brickWidth, dimensions.brickHeight);
        ctx.strokeStyle = 'rgba(8, 20, 29, 0.4)';
        ctx.strokeRect(x + 0.5, y + 0.5, dimensions.brickWidth - 1, dimensions.brickHeight - 1);
    }
}

function drawPaddleAndBall() {
    const paddleGradient = ctx.createLinearGradient(state.paddle.x, state.paddle.y, state.paddle.x + state.paddle.width, state.paddle.y);
    paddleGradient.addColorStop(0, '#52d1ff');
    paddleGradient.addColorStop(1, '#8cff9d');
    ctx.fillStyle = paddleGradient;
    ctx.fillRect(state.paddle.x, state.paddle.y, state.paddle.width, state.paddle.height);

    if (!state.ball.active) return;

    ctx.fillStyle = '#f1fff5';
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, state.ball.radius, 0, Math.PI * 2);
    ctx.fill();
}

function drawCenterMessage() {
    if (!state.notification.text || performance.now() > state.notification.until) return;

    const opacity = Math.max(0, (state.notification.until - performance.now()) / 500);
    ctx.save();
    ctx.globalAlpha = Math.min(1, opacity + 0.2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = dimensions.compact ? 'bold 26px monospace' : 'bold 42px monospace';
    ctx.fillStyle = state.notification.tone === 'warn' ? '#ffb1a8' : '#8cff9d';
    ctx.fillText(state.notification.text, dimensions.canvas / 2, dimensions.canvas / 2);
    ctx.restore();
}

function drawAwaitingLaunchHint() {
    if (!state.awaitingLaunch || state.gameOver || state.running) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = dimensions.compact ? '16px monospace' : '20px monospace';
    ctx.fillStyle = 'rgba(232, 251, 255, 0.8)';
    ctx.fillText('Warm up with your palm, then press Start', dimensions.canvas / 2, dimensions.canvas - 28);
    ctx.restore();
}

function updateBall(dt) {
    if (!state.running || state.awaitingLaunch || !state.ball.active) {
        state.ball.x = state.paddle.x + state.paddle.width / 2;
        state.ball.y = state.paddle.y - state.ball.radius - 2;
        return;
    }

    state.ball.x += state.ball.dx * dt;
    state.ball.y += state.ball.dy * dt;

    if (state.ball.x >= dimensions.canvas - state.ball.radius || state.ball.x <= state.ball.radius) {
        state.ball.dx *= -1;
        state.ball.x = clamp(state.ball.x, state.ball.radius, dimensions.canvas - state.ball.radius);
    }

    if (state.ball.y <= state.ball.radius) {
        state.ball.dy *= -1;
        state.ball.y = state.ball.radius;
    }

    const paddleTop = state.paddle.y;
    const paddleBottom = state.paddle.y + state.paddle.height;
    const nextBallBottom = state.ball.y + state.ball.radius;

    if (
        state.ball.dy > 0 &&
        nextBallBottom >= paddleTop &&
        state.ball.y <= paddleBottom &&
        state.ball.x >= state.paddle.x &&
        state.ball.x <= state.paddle.x + state.paddle.width
    ) {
        const relativeHit = (state.ball.x - state.paddle.x) / state.paddle.width;
        const maxAngle = Math.PI / 3;
        const angle = (relativeHit * 2 - 1) * maxAngle;
        state.ball.dx = Math.sin(angle) * state.ball.speed;
        state.ball.dy = -Math.cos(angle) * state.ball.speed;
        state.ball.y = paddleTop - state.ball.radius - 1;
    }

    if (state.ball.y - state.ball.radius > dimensions.canvas + 4) {
        loseLife();
    }
}

function detectBrickCollision() {
    if (!state.ball.active || state.awaitingLaunch) return;

    const gridX = Math.floor((state.ball.x - dimensions.brickOffsetLeft) / (dimensions.brickWidth + dimensions.brickPadding));
    const gridY = Math.floor((state.ball.y - dimensions.brickOffsetTop) / (dimensions.brickHeight + dimensions.brickPadding));

    for (let column = Math.max(0, gridX - 1); column <= Math.min(BRICK_COLUMNS - 1, gridX + 1); column += 1) {
        for (let row = Math.max(0, gridY - 1); row <= Math.min(BRICK_ROWS_MAX - 1, gridY + 1); row += 1) {
            const index = (column * BRICK_ROWS_MAX + row) * BRICK_DATA_SIZE;
            if (bricks[index + 2] !== 1) continue;

            const x = bricks[index];
            const y = bricks[index + 1];

            const hit =
                state.ball.x + state.ball.radius > x &&
                state.ball.x - state.ball.radius < x + dimensions.brickWidth &&
                state.ball.y + state.ball.radius > y &&
                state.ball.y - state.ball.radius < y + dimensions.brickHeight;

            if (!hit) continue;

            bricks[index + 2] = 0;
            state.stats.score += 1;
            state.stats.bricksRemaining -= 1;
            scoreElement.textContent = String(state.stats.score);
            state.ball.dy *= -1;

            if (state.stats.bricksRemaining <= 0) {
                levelUp();
            }
            return;
        }
    }
}

function gameLoop(timestamp) {
    if (!state.lastFrameTime) {
        state.lastFrameTime = timestamp;
    }

    const dt = Math.min((timestamp - state.lastFrameTime) / (1000 / 60), 1.4);
    state.lastFrameTime = timestamp;

    drawBackground();
    syncPaddleWithTracking();
    updateBall(dt);
    detectBrickCollision();
    drawBricks();
    drawPaddleAndBall();
    drawCenterMessage();
    drawAwaitingLaunchHint();

    state.animationFrame = requestAnimationFrame(gameLoop);
}

function renderLeaderboard(highlight = null) {
    if (!state.leaderboard.length) {
        leaderboardContent.innerHTML = '<p class="empty-state">No local scores yet. Finish a run to seed the board.</p>';
        return;
    }

    const rows = state.leaderboard
        .map((entry, index) => {
            const isHighlighted = highlight && entry.id === highlight;
            return `
                <div class="leaderboard-row${isHighlighted ? ' leaderboard-row-highlight' : ''}">
                    <span class="leaderboard-rank">#${index + 1}</span>
                    <strong>${escapeHtml(entry.name)}</strong>
                    <span>${entry.score}</span>
                    <span class="leaderboard-meta">Level ${entry.level}</span>
                </div>
            `;
        })
        .join('');

    leaderboardContent.innerHTML = `<div class="leaderboard-list">${rows}</div>`;
}

function loadLeaderboard() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('Unable to load leaderboard from localStorage.', error);
        return [];
    }
}

function saveLeaderboard() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.leaderboard));
}

function submitLocalScore(name) {
    const entry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: name.trim() || 'Player',
        score: state.stats.score,
        level: state.stats.level
    };

    state.leaderboard = [...state.leaderboard, entry]
        .sort((a, b) => (b.score - a.score) || (b.level - a.level))
        .slice(0, MAX_LEADERBOARD_ENTRIES);

    saveLeaderboard();
    renderLeaderboard(entry.id);
}

async function initCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is not supported in this browser.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: 'user',
            width: { ideal: 960 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 }
        },
        audio: false
    });

    state.videoStream = stream;
    video.srcObject = stream;
    await video.play();
}

function applyTrackingPosition(rawX) {
    const normalized = clamp(1.26 - rawX * 1.52, 0, 1);
    state.paddleNormalizedX = normalized;
    palmIndicator.style.transform = `translateX(${(normalized - 0.5) * 100}%)`;
}

async function setupHandTracking() {
    if (typeof window.Hands !== 'function') {
        throw new Error('MediaPipe Hands failed to load from the local vendor folder.');
    }

    setTrackingState('status-loading', 'Loading hand tracking');
    await initCamera();

    state.hands = new window.Hands({
        locateFile: (file) => `vendor/mediapipe/${file}`
    });

    state.hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55
    });

    state.hands.onResults((results) => {
        const now = performance.now();
        if (now - state.trackingLastTick < TRACKING_SAMPLE_RATE) return;
        state.trackingLastTick = now;

        const hand = results.multiHandLandmarks?.[0];
        if (!hand) {
            state.noHandFrames += 1;
            if (state.noHandFrames > 24) {
                if (state.running) {
                    pauseForTrackingLoss();
                } else {
                    state.handReady = false;
                    startButton.disabled = true;
                    startButton.textContent = 'Show your hand to start';
                    setTrackingState('status-lost', 'Show your hand');
                }
            }
            return;
        }

        state.noHandFrames = 0;
        state.handReady = true;
        applyTrackingPosition(hand[0].x);

        if (!state.trackingReady) {
            state.trackingReady = true;
            startButton.disabled = false;
            startButton.textContent = 'Start game';
            setTrackingState('status-ready', 'Ready');
        } else if (state.trackingLost) {
            resumeAfterTrackingRecovery();
        } else {
            setTrackingState('status-ready', 'Ready');
        }
    });

    const processVideo = async () => {
        if (!state.hands || video.readyState < 2) {
            requestAnimationFrame(processVideo);
            return;
        }

        try {
            await state.hands.send({ image: video });
        } catch (error) {
            console.error('Hand tracking frame failed.', error);
            setTrackingState('status-lost', 'Tracking error');
        }

        requestAnimationFrame(processVideo);
    };

    requestAnimationFrame(processVideo);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

startButton.addEventListener('click', () => {
    if (!state.handReady || state.gameOver) return;
    beginGame();
});

restartButton.addEventListener('click', restartGame);

toggleLeaderboardButton.addEventListener('click', () => {
    const willShow = leaderboardPanel.classList.contains('hidden');
    leaderboardPanel.classList.toggle('hidden', !willShow);
    toggleLeaderboardButton.textContent = willShow ? 'Hide Leaderboard' : 'Show Leaderboard';
    toggleLeaderboardButton.setAttribute('aria-expanded', String(willShow));
});

saveScoreForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitLocalScore(playerNameInput.value);
    if (gameOverDialog.open) {
        gameOverDialog.close();
    }
    leaderboardPanel.classList.remove('hidden');
    toggleLeaderboardButton.textContent = 'Hide Leaderboard';
    toggleLeaderboardButton.setAttribute('aria-expanded', 'true');
    restartGame();
});

skipScoreButton.addEventListener('click', () => {
    if (gameOverDialog.open) {
        gameOverDialog.close();
    }
    restartGame();
});

window.addEventListener('beforeunload', () => {
    state.videoStream?.getTracks().forEach((track) => track.stop());
    if (state.animationFrame) {
        cancelAnimationFrame(state.animationFrame);
    }
});

updateHud();
initBricks();
resetBall();
renderLeaderboard();
requestAnimationFrame(gameLoop);

setupHandTracking().catch((error) => {
    console.error(error);
    setTrackingState('status-lost', 'Camera unavailable');
    tutorialStatus.textContent = error.message;
    startButton.textContent = 'Camera unavailable';
    pauseOverlay.classList.remove('hidden');
    pauseOverlay.innerHTML = `
        <h2>Camera unavailable</h2>
        <p>${escapeHtml(error.message)}</p>
        <p>Serve the app locally, allow webcam access, and make sure the MediaPipe vendor files exist.</p>
    `;
});
