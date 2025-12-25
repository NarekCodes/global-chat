const socket = io();

// ============================================================
// DOM Elements
// ============================================================
const landingScreen = document.getElementById('landing-screen');
const mainInterface = document.getElementById('main-interface');

const mainForm = document.getElementById('main-form');
const joinView = document.getElementById('join-view');

const usernameInput = document.getElementById('username-input');
const avatarInput = document.getElementById('avatar-input');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');

const joinCodeInput = document.getElementById('join-code-input');
const confirmJoinBtn = document.getElementById('confirm-join-btn');
const backFromJoin = document.getElementById('back-from-join');

const messagesArea = document.getElementById('messages-area');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const voiceRecordBtn = document.getElementById('voice-record-btn');
const userList = document.getElementById('user-list');
const currentRoomCodeDisplay = document.getElementById('current-room-code');
const copyCodeBtn = document.getElementById('copy-code-btn');

const phaseIndicator = document.getElementById('phase-indicator');
const phaseText = document.getElementById('phase-text');
const roleDisplay = document.getElementById('role-display');
const roleText = document.getElementById('role-text');

// Modals
const errorModal = document.getElementById('error-modal');
const errorHeading = document.getElementById('error-heading');
const errorMessageText = document.getElementById('error-message-text');
const closeErrorBtn = document.getElementById('close-error-btn');

const roleModal = document.getElementById('role-modal');
const roleModalTitle = document.getElementById('role-modal-title');
const roleModalIcon = document.getElementById('role-modal-icon');
const roleModalRole = document.getElementById('role-modal-role');
const roleModalGoal = document.getElementById('role-modal-goal');
const roleModalClose = document.getElementById('role-modal-close');

const gameoverModal = document.getElementById('gameover-modal');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverIcon = document.getElementById('gameover-icon');
const gameoverMessage = document.getElementById('gameover-message');
const gameoverClose = document.getElementById('gameover-close');

const typingIndicator = document.getElementById('typing-indicator');

const contextMenu = document.getElementById('context-menu');
const contextCopy = document.getElementById('ctx-copy');

// Emoji picker elements
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');

// Attachment elements
const attachBtn = document.getElementById('attach-btn');
const attachMenu = document.getElementById('attach-menu');
const fileInput = document.getElementById('file-input');
const uploadImageBtn = document.getElementById('upload-image-btn');
const imageUrlBtn = document.getElementById('image-url-btn');

// Mobile menu elements
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMembersBtn = document.getElementById('mobile-members-btn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const onlineUsersContainer = document.getElementById('online-users');

// ============================================================
// State
// ============================================================
let username = '';
let currentRoom = '';
let isLeader = false;
let currentLeaderUsername = '';
let leaderActivated = false; // Track if leader has been activated via /getleader
let myRole = null;
let myTeam = null;
let gameState = 'LOBBY';
let typingTimeout;
const typingUsers = new Map(); // Track users who are typing
const recordingUsers = new Map(); // Track users who are recording

// Voice Recording State
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let stream = null;
let recordingStartTime = null;
const MIN_RECORDING_DURATION = 300; // Minimum 300ms to send

const ROLE_ICONS = {
    'Don': '🎩',
    'Mafia': '🔪',
    'Sheriff': '🕵️',
    'Villager': '👤'
};

const ROLE_COLORS = {
    'Don': '#dc2626',
    'Mafia': '#ef4444',
    'Sheriff': '#3b82f6',
    'Villager': '#22c55e'
};

const getFallbackAvatar = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;

// ============================================================
// Error Modal
// ============================================================
function showError(title, message) {
    errorHeading.textContent = title;
    errorMessageText.textContent = message;
    errorModal.style.display = 'flex';
}

closeErrorBtn.addEventListener('click', () => errorModal.style.display = 'none');

// ============================================================
// Landing Page
// ============================================================
function showMainForm() {
    mainForm.style.display = 'block';
    joinView.style.display = 'none';
}

function showJoinView() {
    const name = usernameInput.value.trim();
    if (!name) {
        showError('Username Required', 'Please enter a username.');
        return;
    }
    if (name.includes(' ')) {
        showError('Invalid Username', 'No spaces allowed.');
        return;
    }
    mainForm.style.display = 'none';
    joinView.style.display = 'block';
    joinCodeInput.focus();
}

joinRoomBtn.addEventListener('click', showJoinView);
backFromJoin.addEventListener('click', showMainForm);

createRoomBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    const avatarUrl = avatarInput.value.trim();

    if (!name) {
        showError('Username Required', 'Please enter a username.');
        return;
    }
    if (name.includes(' ')) {
        showError('Invalid Username', 'No spaces allowed.');
        return;
    }

    createRoomBtn.disabled = true;
    createRoomBtn.textContent = 'Creating...';

    socket.emit('host_room', {
        username: name,
        avatarUrl: avatarUrl || getFallbackAvatar(name)
    });
});

confirmJoinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    const avatarUrl = avatarInput.value.trim();
    const code = joinCodeInput.value.trim().toUpperCase();

    if (!code) {
        showError('Invalid Code', 'Please enter a room code.');
        return;
    }

    confirmJoinBtn.disabled = true;
    confirmJoinBtn.textContent = 'Joining...';

    socket.emit('join_room', {
        username: name,
        avatarUrl: avatarUrl || getFallbackAvatar(name),
        roomCode: code
    });
});

joinCodeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
});

joinCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmJoinBtn.click();
});

// ============================================================
// Socket Events - Room
// ============================================================
let isMafiaRoom = false;

// Get DOM elements for mode switching
const standardCommands = document.getElementById('standard-commands');
const gameCommands = document.getElementById('game-commands');
const roomNameDisplay = document.getElementById('room-name-display');
const membersTitle = document.getElementById('members-title');

socket.on('roomJoined', (data) => {
    username = usernameInput.value.trim();
    currentRoom = data.roomCode;
    isLeader = false; // Leader status only set via /getleader
    isMafiaRoom = data.isMafiaRoom || false;
    gameState = 'LOBBY';
    myRole = null;
    leaderActivated = false; // Reset leader activation on room join

    // Clear typing and recording users when joining a new room
    typingUsers.clear();
    recordingUsers.clear();
    isCurrentlyTyping = false;
    isRecording = false;
    clearTimeout(typingTimeout);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    if (voiceRecordBtn) {
        voiceRecordBtn.classList.remove('recording');
    }
    updateTypingIndicator(); // Hide indicator

    // Initialize leader info from server
    if (data.currentLeaderId && data.currentLeaderUsername) {
        currentLeaderUsername = data.currentLeaderUsername;
        leaderActivated = true;
        if (data.currentLeaderUsername === username) {
            isLeader = true;
        }
        // Update UI immediately
        setTimeout(() => updateLeaderStyling(), 100);
    } else {
        currentLeaderUsername = '';
    }

    // Track spectator status
    const isSpectator = data.isSpectator || false;

    currentRoomCodeDisplay.textContent = data.roomCode;

    // Mode-specific UI rendering
    const mobileRoleBadge = document.getElementById('mobile-role-badge');
    const mobileGameActions = document.getElementById('mobile-game-actions');
    const isMobile = window.innerWidth <= 768;

    if (isMafiaRoom) {
        // MAFIA Room: Show game UI
        if (roleDisplay) roleDisplay.style.display = 'none';
        if (phaseIndicator) phaseIndicator.style.display = 'block';
        if (standardCommands) standardCommands.style.display = 'none';
        if (gameCommands) gameCommands.style.display = 'block';
        if (roomNameDisplay) roomNameDisplay.textContent = isSpectator ? 'Mafia Game 👁️' : 'Mafia Game';
        if (membersTitle) membersTitle.textContent = 'Players';
        updatePhaseUI('LOBBY');

        // Show mobile role badge and game actions (only on mobile)
        if (isMobile) {
            if (mobileRoleBadge) {
                mobileRoleBadge.style.display = 'block';
                const mobileRoleText = document.getElementById('mobile-role-text');
                if (mobileRoleText && myRole) {
                    mobileRoleText.textContent = `${ROLE_ICONS[myRole]} ${myRole}`;
                    mobileRoleText.style.color = ROLE_COLORS[myRole] || '#333';
                }
            }
            if (mobileGameActions) {
                mobileGameActions.style.display = 'flex';
            }
        } else {
            if (mobileRoleBadge) mobileRoleBadge.style.display = 'none';
            if (mobileGameActions) mobileGameActions.style.display = 'none';
        }
    } else {
        // Standard Room: Hide ALL game UI elements
        roleDisplay.style.display = 'none';
        phaseIndicator.style.display = 'none';
        standardCommands.style.display = 'block';
        gameCommands.style.display = 'none';
        roomNameDisplay.textContent = 'Chat Room';
        membersTitle.textContent = 'Members';
        // Hide timer display in standard mode
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) timerDisplay.style.display = 'none';

        // Hide mobile game UI
        if (mobileRoleBadge) mobileRoleBadge.style.display = 'none';
        if (mobileGameActions) mobileGameActions.style.display = 'none';
    }

    landingScreen.style.display = 'none';
    mainInterface.style.display = 'flex';

    createRoomBtn.disabled = false;
    createRoomBtn.textContent = 'Create New Room';
    confirmJoinBtn.disabled = false;
    confirmJoinBtn.textContent = 'Join Room';
});

socket.on('loginError', ({ title, message }) => {
    showError(title, message);
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = 'Create New Room';
    confirmJoinBtn.disabled = false;
    confirmJoinBtn.textContent = 'Join Room';
});

socket.on('roomLeft', () => {
    resetToLanding();
});

socket.on('kicked', ({ message }) => {
    showError('Kicked', message);
    resetToLanding();
});

function resetToLanding() {
    currentRoom = '';
    isLeader = false;
    myRole = null;
    gameState = 'LOBBY';
    messagesArea.innerHTML = '';
    userList.innerHTML = '';
    mainInterface.style.display = 'none';
    landingScreen.style.display = 'flex';
    showMainForm();
}

// Copy room code
copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom).then(() => {
        copyCodeBtn.textContent = '✓';
        setTimeout(() => copyCodeBtn.textContent = '📋', 1500);
    });
});

// ============================================================
// Game Events
// ============================================================
const timerDisplay = document.getElementById('timer-display');
const timerText = document.getElementById('timer-text');

socket.on('roleAssigned', (data) => {
    myRole = data.role;
    myTeam = data.team;

    roleModalIcon.textContent = ROLE_ICONS[data.role] || '🎭';
    roleModalRole.textContent = data.role;
    roleModalRole.style.color = ROLE_COLORS[data.role] || '#333';
    roleModalGoal.textContent = data.goal;
    roleModal.style.display = 'flex';

    roleDisplay.style.display = 'block';
    roleText.textContent = `${ROLE_ICONS[data.role]} ${data.role}`;
    roleText.style.color = ROLE_COLORS[data.role];

    // Update mobile role badge (only on mobile)
    const mobileRoleBadge = document.getElementById('mobile-role-badge');
    const mobileRoleText = document.getElementById('mobile-role-text');
    if (mobileRoleBadge && mobileRoleText && window.innerWidth <= 768) {
        mobileRoleBadge.style.display = 'block';
        mobileRoleText.textContent = `${ROLE_ICONS[data.role]} ${data.role}`;
        mobileRoleText.style.color = ROLE_COLORS[data.role];
    }
});

roleModalClose.addEventListener('click', () => {
    roleModal.style.display = 'none';
});

socket.on('phaseChange', (data) => {
    gameState = data.phase;
    updatePhaseUI(data.phase, data.round);
});

// Timer updates
socket.on('timer_update', (data) => {
    if (data.active && data.seconds > 0) {
        timerDisplay.style.display = 'block';
        timerText.textContent = `⏱️ ${data.seconds}s`;

        // Color coding based on time remaining
        if (data.seconds <= 10) {
            timerText.classList.add('timer-urgent');
        } else {
            timerText.classList.remove('timer-urgent');
        }
    } else {
        timerDisplay.style.display = 'none';
    }
});

function updatePhaseUI(phase, round) {
    gameState = phase;

    if (phase === 'LOBBY') {
        phaseText.textContent = 'LOBBY';
        phaseIndicator.className = 'phase-indicator phase-lobby';
    } else if (phase === 'DAY_1') {
        phaseText.textContent = '☀️ Day 1 (Intro)';
        phaseIndicator.className = 'phase-indicator phase-day';
    } else if (phase === 'NIGHT') {
        phaseText.textContent = `🌙 Night ${round || ''}`;
        phaseIndicator.className = 'phase-indicator phase-night';
    } else if (phase === 'DAY') {
        phaseText.textContent = `☀️ Day ${round || ''}`;
        phaseIndicator.className = 'phase-indicator phase-day';
    }
}

socket.on('gameOver', (data) => {
    gameState = 'LOBBY';
    updatePhaseUI('LOBBY');
    roleDisplay.style.display = 'none';
    myRole = null;

    gameoverIcon.textContent = data.winner === 'TOWN' ? '🎉' : '😈';
    gameoverMessage.textContent = data.message;
    gameoverModal.style.display = 'flex';
});

gameoverClose.addEventListener('click', () => {
    gameoverModal.style.display = 'none';
});

// ============================================================
// Clear Chat on Mafia Win
// ============================================================
function clearChatOnMafiaWin() {
    const chatBox = document.getElementById('messages-area');
    if (!chatBox) return;

    // Remove all child elements
    while (chatBox.firstChild) {
        chatBox.removeChild(chatBox.firstChild);
    }

    // Add victory message using proper structure
    const victoryMsg = {
        id: Date.now(),
        username: 'SYSTEM',
        text: 'Mafia Wins! Chat cleared.',
        type: 'victory'
    };
    renderMessage(victoryMsg);
}

// ============================================================
// Messages
// ============================================================
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// High-fidelity Telegram-style emoji layout detection
// Returns: { isOnly: boolean, count: number, hasText: boolean, size: string }
function getEmojiLayout(text) {
    if (!text || text.trim().length === 0) {
        return { isOnly: false, count: 0, hasText: false, size: 'inline' };
    }

    const trimmed = text.trim();

    // Comprehensive Unicode emoji regex pattern
    // Covers: Emoticons, Symbols, Pictographs, Transport, Flags, Modifiers, etc.
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2190}-\u{21FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}-\u{2B55}]|[\u{3030}-\u{303F}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]|[\u{20E3}]|[\u{FE0F}]/gu;

    // Find all emoji sequences (handles multi-character emojis like flags, skin tones)
    const emojiMatches = trimmed.match(emojiPattern);

    // Remove all emojis and whitespace to check for remaining text
    const textWithoutEmojis = trimmed.replace(emojiPattern, '').replace(/\s/g, '');
    const hasText = textWithoutEmojis.length > 0;

    if (!emojiMatches) {
        return { isOnly: false, count: 0, hasText: hasText, size: 'inline' };
    }

    // Count distinct emoji sequences (handles zero-width joiners, variation selectors)
    const emojiCount = countEmojiSequences(trimmed);

    // Determine size based on Telegram's exact scaling rules
    let size = 'inline';
    if (!hasText && emojiCount > 0) {
        if (emojiCount === 1) {
            size = 'jumbo-single'; // 128px (5rem)
        } else if (emojiCount === 2) {
            size = 'jumbo-double'; // 80px (3rem)
        } else if (emojiCount === 3) {
            size = 'jumbo-triple'; // 64px (2.5rem)
        } else {
            size = 'inline'; // 4+ emojis or with text: 1.2rem
        }
    }

    return {
        isOnly: !hasText && emojiCount > 0,
        count: emojiCount,
        hasText: hasText,
        size: size
    };
}

// Count emoji sequences properly (handles multi-character emojis)
function countEmojiSequences(text) {
    // Split by spaces first
    const parts = text.trim().split(/\s+/);
    let count = 0;

    for (const part of parts) {
        // Use regex to find emoji sequences
        // This handles flags (2 regional indicators), skin tones, zero-width joiners
        const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2B50}-\u{2B55}\u{3030}-\u{303F}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{FE0F}]+/gu;
        const matches = part.match(emojiRegex);
        if (matches) {
            count += matches.length;
        }
    }

    return count;
}

// Map Unicode emojis to high-quality asset sets
// Returns the emoji code point for asset mapping
function getEmojiAssetCode(emoji) {
    // Convert emoji to code point(s)
    const codePoints = [];
    for (let i = 0; i < emoji.length; i++) {
        const code = emoji.codePointAt(i);
        if (code > 0xFFFF) {
            codePoints.push(code.toString(16).toUpperCase());
            i++; // Skip the surrogate pair
        } else if (code >= 0x1F300) {
            codePoints.push(code.toString(16).toUpperCase());
        }
    }
    return codePoints.join('-');
}

// Lottie-web integration for animated emoji support (Telegram TGS style)
function renderAnimatedEmoji(emojiCode, targetElement) {
    // Placeholder for Lottie-web integration
    // Supports top 50 most common emojis with .json animations
    if (typeof lottie !== 'undefined') {
        // Check if this emoji has an animation file
        const hasAnimation = checkEmojiHasAnimation(emojiCode);

        if (hasAnimation) {
            try {
                // Create container for animation
                const container = document.createElement('div');
                container.classList.add('lottie-emoji-container');
                container.style.position = 'absolute';
                container.style.width = targetElement.offsetWidth + 'px';
                container.style.height = targetElement.offsetHeight + 'px';
                container.style.pointerEvents = 'none';

                // Load animation
                const animation = lottie.loadAnimation({
                    container: container,
                    renderer: 'svg',
                    loop: true,
                    autoplay: true,
                    path: `https://cdn.jsdelivr.net/npm/telegram-animated-emojis@latest/${emojiCode}.json`
                });

                // Position container over emoji
                const rect = targetElement.getBoundingClientRect();
                container.style.left = rect.left + 'px';
                container.style.top = rect.top + 'px';
                document.body.appendChild(container);

                // Clean up after animation
                setTimeout(() => {
                    animation.destroy();
                    container.remove();
                }, 2000);

                return animation;
            } catch (error) {
                console.warn(`[Lottie] Failed to load animation for ${emojiCode}:`, error);
            }
        }
    }

    console.log(`[Lottie] Animation placeholder for emoji: ${emojiCode}`);
    return null;
}

// Check if emoji has animation support (top 50 most common)
function checkEmojiHasAnimation(emojiCode) {
    // Top 50 most common emojis that support animations
    const animatedEmojis = [
        '1F600', '1F601', '1F602', '1F603', '1F604', '1F605', '1F606', '1F607',
        '1F608', '1F609', '1F60A', '1F60B', '1F60C', '1F60D', '1F60E', '1F60F',
        '1F610', '1F611', '1F612', '1F613', '1F614', '1F615', '1F616', '1F617',
        '1F618', '1F619', '1F61A', '1F61B', '1F61C', '1F61D', '1F61E', '1F61F',
        '1F620', '1F621', '1F622', '1F623', '1F624', '1F625', '1F626', '1F627',
        '1F628', '1F629', '1F62A', '1F62B', '1F62C', '1F62D', '1F62E', '1F62F',
        '1F630', '1F631', '1F632', '1F633'
    ];

    return animatedEmojis.includes(emojiCode.toUpperCase());
}

function renderMessage(data) {
    if (!data.id) data.id = Date.now() + Math.random().toString(36).substr(2, 9);

    const container = document.createElement('div');
    container.classList.add('message-container');
    container.id = `msg-${data.id}`;
    container.dataset.messageId = data.id;
    container.dataset.messageAuthor = data.username;

    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');

    // Add alignment class to container
    if (data.username !== 'SYSTEM') {
        const isMe = data.username === username || data.username.includes(username);
        container.classList.add(isMe ? 'self' : 'other');
    }

    // System messages
    if (data.username === 'SYSTEM') {
        container.classList.add('system-message-container');
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'system');
        if (data.type === 'death') messageDiv.classList.add('death-message');
        if (data.type === 'phase') messageDiv.classList.add('phase-message');
        if (data.type === 'victory') messageDiv.classList.add('victory-message');
        if (data.type === 'private') messageDiv.classList.add('private-message');
        if (data.type === 'error') messageDiv.classList.add('error-message');

        messageDiv.innerHTML = escapeHtml(data.text);
        wrapper.appendChild(messageDiv);
    } else {
        const isMe = data.username === username || data.username.includes(username);
        wrapper.classList.add(isMe ? 'self' : 'other');

        // Create username row with avatar
        const usernameRow = document.createElement('div');
        usernameRow.classList.add('message-username-row');

        // Avatar next to username
        if (data.avatarUrl) {
            const avatarImg = document.createElement('img');
            avatarImg.src = data.avatarUrl;
            avatarImg.classList.add('message-avatar');
            avatarImg.onerror = function () { this.src = getFallbackAvatar(data.username); };

            // Check if user is leader for golden styling
            if (data.username === currentLeaderUsername && leaderActivated) {
                avatarImg.classList.add('leader-avatar');
            }

            usernameRow.appendChild(avatarImg);
        }

        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('username');
        // Add golden styling if user is leader and leader is activated
        if (data.username === currentLeaderUsername && leaderActivated) {
            usernameSpan.classList.add('leader-username', 'is-leader');
            usernameSpan.textContent = `${data.username} (Leader)`;
        } else {
            usernameSpan.textContent = data.username;
        }
        usernameRow.appendChild(usernameSpan);

        // Message bubble
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message-bubble');
        if (isMe) {
            messageDiv.classList.add('self');
        } else {
            messageDiv.classList.add('other');
        }

        if (data.isSecret) {
            messageDiv.classList.add('mafia-message');
        }

        // Handle voice messages vs regular text messages
        if (data.type === 'voice' && data.audioData) {
            // Create Telegram-style voice message UI
            const voiceDiv = document.createElement('div');
            voiceDiv.classList.add('voice-message');
            voiceDiv.classList.add(isMe ? 'voice-self' : 'voice-other');
            voiceDiv.dataset.messageId = data.id;

            // Hidden audio element
            const audio = document.createElement('audio');
            audio.src = data.audioData;
            audio.preload = 'metadata';
            audio.style.display = 'none';
            audio.hidden = true;
            voiceDiv.audioElement = audio;
            voiceDiv.appendChild(audio);

            // Circular Play/Pause button with SVG icons
            const playButton = document.createElement('button');
            playButton.classList.add('voice-play-btn');
            playButton.setAttribute('aria-label', 'Play voice message');
            playButton.innerHTML = `
                <svg class="play-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3 2l10 6-10 6V2z"/>
                </svg>
                <svg class="pause-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display: none;">
                    <path d="M4 2h3v12H4V2zm5 0h3v12H9V2z"/>
                </svg>
            `;

            // Canvas waveform
            const waveformContainer = document.createElement('div');
            waveformContainer.classList.add('voice-waveform-container');

            const canvas = document.createElement('canvas');
            canvas.classList.add('voice-waveform-canvas');
            canvas.width = 200;
            canvas.height = 32;
            canvas.style.cursor = 'pointer';

            waveformContainer.appendChild(canvas);

            // Timer label
            const timerLabel = document.createElement('span');
            timerLabel.classList.add('voice-timer');
            timerLabel.textContent = '0:00';

            // Speed control button (optional)
            const speedBtn = document.createElement('button');
            speedBtn.classList.add('voice-speed-btn');
            speedBtn.textContent = '1x';
            speedBtn.setAttribute('aria-label', 'Playback speed');
            let playbackSpeed = 1;

            // Assemble the UI
            voiceDiv.appendChild(playButton);
            voiceDiv.appendChild(waveformContainer);
            voiceDiv.appendChild(timerLabel);
            voiceDiv.appendChild(speedBtn);

            // Generate fake frequency data (20-30 bars, heights 20-80%)
            const barCount = 25;
            const frequencies = Array.from({ length: barCount }, () =>
                Math.random() * 0.6 + 0.2 // Random between 20% and 80%
            );
            voiceDiv.frequencies = frequencies;

            // Draw waveform function
            const drawWaveform = (progress = 0) => {
                const ctx = canvas.getContext('2d');
                const barWidth = 3;
                const barGap = 2;
                const totalBarWidth = barWidth + barGap;
                const maxBarHeight = canvas.height - 4;
                const startX = 2;
                const activeColor = isMe ? '#ffffff' : '#0088cc';
                const inactiveColor = isMe ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)';

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const activeBarIndex = Math.floor((progress / 100) * barCount);

                frequencies.forEach((freq, index) => {
                    const x = startX + index * totalBarWidth;
                    const barHeight = freq * maxBarHeight;
                    const y = (canvas.height - barHeight) / 2;

                    ctx.fillStyle = index <= activeBarIndex ? activeColor : inactiveColor;
                    ctx.fillRect(x, y, barWidth, barHeight);
                });
            };

            // Initial waveform draw
            drawWaveform(0);

            // Get duration when metadata loads
            audio.addEventListener('loadedmetadata', () => {
                const duration = Math.floor(audio.duration);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                timerLabel.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            });

            // Update timer and waveform during playback
            const updatePlayback = () => {
                if (!audio.paused && audio.duration) {
                    const current = Math.floor(audio.currentTime);
                    const minutes = Math.floor(current / 60);
                    const seconds = current % 60;
                    timerLabel.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                    const progress = (audio.currentTime / audio.duration) * 100;
                    drawWaveform(progress);

                    voiceDiv.animationFrameId = requestAnimationFrame(updatePlayback);
                } else {
                    voiceDiv.animationFrameId = null;
                }
            };

            // Play/Pause button click handler
            playButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (audio.paused) {
                    // Stop all other voice messages
                    document.querySelectorAll('.voice-message audio').forEach(a => {
                        if (a !== audio && !a.paused) {
                            a.pause();
                            a.currentTime = 0;
                            const msgDiv = a.closest('.voice-message');
                            if (msgDiv) {
                                const btn = msgDiv.querySelector('.voice-play-btn');
                                const playIcon = btn?.querySelector('.play-icon');
                                const pauseIcon = btn?.querySelector('.pause-icon');
                                const timer = msgDiv.querySelector('.voice-timer');
                                const canvas = msgDiv.querySelector('.voice-waveform-canvas');
                                if (playIcon) playIcon.style.display = 'block';
                                if (pauseIcon) pauseIcon.style.display = 'none';
                                if (timer) timer.textContent = '0:00';
                                if (msgDiv.animationFrameId) {
                                    cancelAnimationFrame(msgDiv.animationFrameId);
                                    msgDiv.animationFrameId = null;
                                }
                                // Reset waveform
                                if (canvas && msgDiv.frequencies) {
                                    const ctx = canvas.getContext('2d');
                                    const barWidth = 3;
                                    const barGap = 2;
                                    const totalBarWidth = barWidth + barGap;
                                    const maxBarHeight = canvas.height - 4;
                                    const startX = 2;
                                    const isOther = msgDiv.classList.contains('voice-other');
                                    const inactiveColor = isOther ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.3)';

                                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                                    msgDiv.frequencies.forEach((freq, index) => {
                                        const x = startX + index * totalBarWidth;
                                        const barHeight = freq * maxBarHeight;
                                        const y = (canvas.height - barHeight) / 2;
                                        ctx.fillStyle = inactiveColor;
                                        ctx.fillRect(x, y, barWidth, barHeight);
                                    });
                                }
                            }
                        }
                    });

                    audio.playbackRate = playbackSpeed;
                    audio.play();
                    playButton.querySelector('.play-icon').style.display = 'none';
                    playButton.querySelector('.pause-icon').style.display = 'block';
                    voiceDiv.animationFrameId = requestAnimationFrame(updatePlayback);
                } else {
                    audio.pause();
                    playButton.querySelector('.play-icon').style.display = 'block';
                    playButton.querySelector('.pause-icon').style.display = 'none';
                    if (voiceDiv.animationFrameId) {
                        cancelAnimationFrame(voiceDiv.animationFrameId);
                        voiceDiv.animationFrameId = null;
                    }
                }
            });

            // Seekable waveform - click to jump to position
            canvas.addEventListener('click', (e) => {
                if (audio.duration) {
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const percent = Math.max(0, Math.min(1, x / canvas.width));
                    audio.currentTime = percent * audio.duration;

                    // Update display immediately
                    const current = Math.floor(audio.currentTime);
                    const minutes = Math.floor(current / 60);
                    const seconds = current % 60;
                    timerLabel.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                    drawWaveform(percent * 100);
                }
            });

            // Speed control toggle
            speedBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playbackSpeed = playbackSpeed === 1 ? 2 : 1;
                speedBtn.textContent = `${playbackSpeed}x`;
                if (!audio.paused) {
                    audio.playbackRate = playbackSpeed;
                }
            });

            // Auto-reset when audio ends
            audio.addEventListener('ended', () => {
                playButton.querySelector('.play-icon').style.display = 'block';
                playButton.querySelector('.pause-icon').style.display = 'none';
                drawWaveform(0);
                audio.currentTime = 0;
                timerLabel.textContent = '0:00';
                if (voiceDiv.animationFrameId) {
                    cancelAnimationFrame(voiceDiv.animationFrameId);
                    voiceDiv.animationFrameId = null;
                }
            });

            // Initialize animation frame ID
            voiceDiv.animationFrameId = null;

            messageDiv.appendChild(voiceDiv);
        } else if (data.type === 'image' && data.data) {
            // Image message from Base64
            const imageContainer = document.createElement('div');
            imageContainer.classList.add('message-image-container');

            // Loading skeleton
            const skeleton = document.createElement('div');
            skeleton.classList.add('image-skeleton');
            imageContainer.appendChild(skeleton);

            const img = document.createElement('img');
            img.classList.add('message-image');
            img.src = data.data;
            img.alt = 'Shared image';
            img.loading = 'lazy';

            img.onload = () => {
                skeleton.style.display = 'none';
                img.style.display = 'block';
            };

            img.onerror = () => {
                skeleton.style.display = 'none';
                const errorDiv = document.createElement('div');
                errorDiv.classList.add('image-error');
                errorDiv.textContent = 'Failed to load image';
                imageContainer.appendChild(errorDiv);
            };

            imageContainer.appendChild(img);
            messageDiv.appendChild(imageContainer);
        } else if (data.type === 'image-url' && data.url) {
            // Image message from URL
            const imageContainer = document.createElement('div');
            imageContainer.classList.add('message-image-container');

            // Loading skeleton
            const skeleton = document.createElement('div');
            skeleton.classList.add('image-skeleton');
            imageContainer.appendChild(skeleton);

            const img = document.createElement('img');
            img.classList.add('message-image');
            img.src = data.url;
            img.alt = 'Shared image';
            img.loading = 'lazy';
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                skeleton.style.display = 'none';
                img.style.display = 'block';
            };

            img.onerror = () => {
                skeleton.style.display = 'none';
                const errorDiv = document.createElement('div');
                errorDiv.classList.add('image-error');
                errorDiv.textContent = 'Failed to load image';
                imageContainer.appendChild(errorDiv);
            };

            imageContainer.appendChild(img);
            messageDiv.appendChild(imageContainer);
        } else {
            // Regular text message
            const text = (data.text || '').trim();
            const contentDiv = document.createElement('div');
            contentDiv.classList.add('message-content');

            // Logic to detect if message is ONLY emojis (up to 3)
            const emojiRegex = /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|\s)+$/g;
            const isSystem = data.username === 'SYSTEM';
            const isEmojiOnly = !isSystem && emojiRegex.test(text);
            
            // Count emojis using the same pattern as detection
            const emojiCount = isEmojiOnly ? [...text.matchAll(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu)].length : 0;

            let emojiClass = '';
            if (isEmojiOnly && emojiCount > 0 && emojiCount <= 3) {
                if (emojiCount === 1) {
                    emojiClass = 'jumbo-emoji-1';
                    // Remove bubble background for single emoji (Telegram style)
                    messageDiv.classList.add('no-bubble');
                } else if (emojiCount === 2) {
                    emojiClass = 'jumbo-emoji-2';
                } else if (emojiCount === 3) {
                    emojiClass = 'jumbo-emoji-3';
                }
            }

            // Create message text div with emoji class
            const messageTextDiv = document.createElement('div');
            messageTextDiv.classList.add('message-text');
            if (emojiClass) {
                messageTextDiv.classList.add(emojiClass);
            }
            messageTextDiv.textContent = text; // Use textContent, not innerHTML (no Twemoji)

            contentDiv.appendChild(messageTextDiv);
            messageDiv.appendChild(contentDiv);
        }

        // Check if message author is leader
        const messageAuthorIsLeader = data.username === currentLeaderUsername;
        const canDeleteForEveryone = isMe || isLeader;

        // Remove hover actions menu - only context menu on right-click

        // Context menu for right-click on message bubble
        messageDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMessageContextMenu(e.clientX, e.clientY, data.text || '[Voice Message]', data.username);
        });

        // Long-press support for mobile (0.5s hold)
        let longPressTimer;
        messageDiv.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => {
                e.preventDefault();
                const touch = e.touches[0] || e.changedTouches[0];
                showMessageContextMenu(touch.clientX, touch.clientY, data.text || '[Voice Message]', data.username);
            }, 500);
        });

        messageDiv.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });

        messageDiv.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
        });

        wrapper.appendChild(usernameRow);
        wrapper.appendChild(messageDiv);
    }

    container.appendChild(wrapper);
    messagesArea.appendChild(container);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

socket.on('loadHistory', (history) => {
    messagesArea.innerHTML = '';
    history.forEach(msg => renderMessage(msg));
});

socket.on('chat message', (msg) => {
    // Leader updates are now handled via leader_updated event, not chat messages
    renderMessage(msg);
});

function removeAllLeaderStyling() {
    // Remove leader styling from all message usernames
    const containers = document.querySelectorAll('.message-container');
    containers.forEach(container => {
        const usernameSpan = container.querySelector('.username');
        if (usernameSpan) {
            usernameSpan.classList.remove('leader-username', 'is-leader');
            usernameSpan.textContent = usernameSpan.textContent.replace(' (Leader)', '');
        }
    });

    // Remove leader styling from all sidebar usernames
    const playerNames = document.querySelectorAll('.player-name');
    playerNames.forEach(nameSpan => {
        nameSpan.classList.remove('leader-username', 'is-leader');
        nameSpan.textContent = nameSpan.textContent.replace(' (Leader)', '');
    });

    // Remove leader styling from avatars
    const avatars = document.querySelectorAll('.message-avatar, .user-list-avatar');
    avatars.forEach(avatar => {
        avatar.classList.remove('leader-avatar');
    });
}

function applyLeaderStyling(leaderUsername) {
    if (!leaderUsername || !leaderActivated) return;

    // Apply to message usernames
    const containers = document.querySelectorAll('.message-container');
    containers.forEach(container => {
        const author = container.dataset.messageAuthor;
        const usernameSpan = container.querySelector('.username');
        if (usernameSpan && author === leaderUsername) {
            usernameSpan.classList.add('leader-username', 'is-leader');
            if (!usernameSpan.textContent.includes('(Leader)')) {
                usernameSpan.textContent = `${author} (Leader)`;
            }
        }
    });

    // Apply to sidebar usernames
    const playerNames = document.querySelectorAll('.player-name');
    playerNames.forEach(nameSpan => {
        const nameText = nameSpan.textContent.replace(' (Leader)', '').replace(' (You)', '').trim();
        if (nameText === leaderUsername) {
            nameSpan.classList.add('leader-username', 'is-leader');
            if (!nameSpan.textContent.includes('(Leader)')) {
                const youText = nameSpan.textContent.includes('(You)') ? ' (You)' : '';
                nameSpan.textContent = `${nameText} (Leader)${youText}`;
            }
        }
    });

    // Apply to avatars
    const containersWithAvatar = document.querySelectorAll('.message-container');
    containersWithAvatar.forEach(container => {
        const author = container.dataset.messageAuthor;
        const avatar = container.querySelector('.message-avatar');
        if (avatar && author === leaderUsername) {
            avatar.classList.add('leader-avatar');
        }
    });

    const sidebarItems = document.querySelectorAll('.player-item');
    sidebarItems.forEach(item => {
        const nameSpan = item.querySelector('.player-name');
        if (nameSpan) {
            const nameText = nameSpan.textContent.replace(' (Leader)', '').replace(' (You)', '').trim();
            if (nameText === leaderUsername) {
                const avatar = item.querySelector('.user-list-avatar');
                if (avatar) avatar.classList.add('leader-avatar');
            }
        }
    });
}

function updateLeaderStyling() {
    if (currentLeaderUsername && leaderActivated) {
        removeAllLeaderStyling();
        applyLeaderStyling(currentLeaderUsername);
    } else {
        removeAllLeaderStyling();
    }
}

socket.on('message_deleted', (data) => {
    const container = document.getElementById(`msg-${data.messageId}`);
    if (container) {
        container.style.opacity = '0';
        container.style.transform = 'translateX(-20px)';
        setTimeout(() => container.remove(), 200);
    }
});

socket.on('leader_updated', (data) => {
    // Remove leader styling from everyone first
    removeAllLeaderStyling();

    if (data.leaderId && data.leaderUsername) {
        // Set new leader
        currentLeaderUsername = data.leaderUsername;
        leaderActivated = true;

        // Update isLeader status if this user is the leader
        if (data.leaderUsername === username) {
            isLeader = true;
        } else {
            isLeader = false;
        }

        // Apply leader styling to the new leader
        applyLeaderStyling(data.leaderUsername);
    } else {
        // No leader - clear everything
        currentLeaderUsername = '';
        leaderActivated = false;
        isLeader = false;
    }
});

socket.on('system message', (data) => {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'system', 'command-list');

    const title = document.createElement('strong');
    title.textContent = data.title;
    msgDiv.appendChild(title);

    const list = document.createElement('ul');
    data.commands.forEach(cmd => {
        const li = document.createElement('li');
        li.textContent = cmd;
        list.appendChild(li);
    });
    msgDiv.appendChild(list);

    messagesArea.appendChild(msgDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
});

// ============================================================
// Online Users - Mode-Specific Rendering
// ============================================================
socket.on('online users', (data) => {
    const users = data.users || [];

    userList.innerHTML = '';

    // Track current leader username and update if changed
    const leaderUser = users.find(u => u.isLeader);
    const newLeaderUsername = leaderUser ? leaderUser.username : '';

    // If leader changed, update all message usernames
    if (newLeaderUsername !== currentLeaderUsername) {
        currentLeaderUsername = newLeaderUsername;
        // Re-render messages to update leader styling
        const containers = document.querySelectorAll('.message-container');
        containers.forEach(container => {
            const author = container.dataset.messageAuthor;
            const usernameSpan = container.querySelector('.username');
            if (usernameSpan) {
                if (author === currentLeaderUsername) {
                    usernameSpan.classList.add('leader-username');
                } else {
                    usernameSpan.classList.remove('leader-username');
                }
            }
        });
    }

    users.forEach(user => {
        const li = document.createElement('li');
        li.classList.add('player-item');

        // MAFIA Room: Show alive/dead status
        if (isMafiaRoom && !user.isAlive) {
            li.classList.add('dead');
        }

        // MAFIA Room: Sheriff color coding
        if (isMafiaRoom && user.colorCode === 'MAFIA') {
            li.classList.add('discovered-mafia');
        } else if (isMafiaRoom && user.colorCode === 'TOWN') {
            li.classList.add('discovered-town');
        }

        // Standard Room: Muted indicator
        if (!isMafiaRoom && user.isMuted) {
            li.classList.add('muted');
        }

        const avatarImg = document.createElement('img');
        avatarImg.src = user.avatarUrl || getFallbackAvatar(user.username);
        avatarImg.classList.add('user-list-avatar');
        // Add golden leader styling
        if (user.username === currentLeaderUsername && leaderActivated) {
            avatarImg.classList.add('leader-avatar');
        }
        avatarImg.onerror = function () { this.src = getFallbackAvatar(user.username); };
        li.appendChild(avatarImg);

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('player-name');
        // Add golden styling if user is leader and leader is activated
        if (user.username === currentLeaderUsername && leaderActivated) {
            nameSpan.classList.add('leader-username', 'is-leader');
            nameSpan.textContent = `${user.username} (Leader)`;
        } else {
            nameSpan.textContent = user.username;
        }

        // Add context menu for leaders (non-MAFIA rooms only)
        if (!isMafiaRoom && isLeader && user.username !== username) {
            nameSpan.style.cursor = 'pointer';
            nameSpan.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showUserContextMenu(e.clientX, e.clientY, user.username);
            });
        }

        // MAFIA Room: Show spectator icon
        if (isMafiaRoom && user.isSpectator) {
            nameSpan.textContent += ' 👁️';
            li.classList.add('spectator');
        }

        // MAFIA Room only: Show crown for leader
        if (isMafiaRoom && user.isLeader && !user.isSpectator) nameSpan.textContent += ' 👑';
        if (user.username === username) nameSpan.textContent += ' (You)';

        // Show voted status (not for spectators)
        if (isMafiaRoom && user.hasVoted && user.isAlive && !user.isSpectator) {
            const votedSpan = document.createElement('span');
            votedSpan.classList.add('voted-indicator');
            votedSpan.textContent = ' ✅';
            nameSpan.appendChild(votedSpan);
        }
        li.appendChild(nameSpan);

        // MAFIA Room only: Show hearts/skulls (not for spectators)
        // Hide in standard mode
        if (isMafiaRoom && !user.isSpectator) {
            const statusSpan = document.createElement('span');
            statusSpan.classList.add('player-status');
            statusSpan.textContent = user.isAlive ? '❤️' : '💀';
            li.appendChild(statusSpan);
        }

        userList.appendChild(li);
    });
});

// ============================================================
// Context Menu
// ============================================================
let selectedText = '';

function showContextMenu(x, y, text) {
    selectedText = text;
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
}

function showMessageContextMenu(x, y, text, messageAuthor) {
    const messageContextMenu = document.getElementById('message-context-menu');
    if (!messageContextMenu) return;

    selectedText = text;
    messageContextMenu.dataset.messageAuthor = messageAuthor;

    // Find the message container to get message ID
    const messageContainer = document.elementFromPoint(x, y)?.closest('.message-container');
    if (messageContainer) {
        messageContextMenu.dataset.messageId = messageContainer.id.replace('msg-', '');
    }

    // Show/hide options based on permissions
    const copyBtn = document.getElementById('ctx-msg-copy');
    const deleteMeBtn = document.getElementById('ctx-msg-delete-me');
    const deleteAllBtn = document.getElementById('ctx-msg-delete-all');
    const muteBtn = document.getElementById('ctx-msg-mute');
    const unmuteBtn = document.getElementById('ctx-msg-unmute');
    const kickBtn = document.getElementById('ctx-msg-kick');
    const divider1 = document.getElementById('ctx-msg-divider-1');
    const divider2 = document.getElementById('ctx-msg-divider-2');

    // Always show copy and delete for me
    if (copyBtn) copyBtn.style.display = 'flex';
    if (deleteMeBtn) deleteMeBtn.style.display = 'flex';

    // Show delete for everyone only if user is author or leader
    const canDeleteForEveryone = (messageAuthor === username) || (isLeader && leaderActivated);
    if (deleteAllBtn) {
        deleteAllBtn.style.display = canDeleteForEveryone ? 'flex' : 'none';
    }

    // Show leader actions only if user is leader and activated, and not clicking own message
    if (isLeader && leaderActivated && !isMafiaRoom && messageAuthor !== username) {
        if (muteBtn) muteBtn.style.display = 'flex';
        if (unmuteBtn) unmuteBtn.style.display = 'flex';
        if (kickBtn) kickBtn.style.display = 'flex';
        if (divider2) divider2.style.display = 'block';
    } else {
        if (muteBtn) muteBtn.style.display = 'none';
        if (unmuteBtn) unmuteBtn.style.display = 'none';
        if (kickBtn) kickBtn.style.display = 'none';
        if (divider2) divider2.style.display = 'none';
    }

    messageContextMenu.style.display = 'block';
    messageContextMenu.style.left = `${x}px`;
    messageContextMenu.style.top = `${y}px`;
}

function showUserContextMenu(x, y, targetUsername) {
    const userContextMenu = document.getElementById('user-context-menu');
    if (!userContextMenu) return;

    userContextMenu.dataset.targetUsername = targetUsername;
    userContextMenu.style.display = 'block';
    userContextMenu.style.left = `${x}px`;
    userContextMenu.style.top = `${y}px`;
}

document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
    const userContextMenu = document.getElementById('user-context-menu');
    if (userContextMenu) userContextMenu.style.display = 'none';
    const messageContextMenu = document.getElementById('message-context-menu');
    if (messageContextMenu) messageContextMenu.style.display = 'none';
});

contextCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(selectedText);
    contextMenu.style.display = 'none';
});

// User context menu handlers
const userContextMute = document.getElementById('ctx-mute');
const userContextUnmute = document.getElementById('ctx-unmute');
const userContextKick = document.getElementById('ctx-kick');

if (userContextMute) {
    userContextMute.addEventListener('click', () => {
        const menu = document.getElementById('user-context-menu');
        const targetUsername = menu?.dataset.targetUsername;
        if (targetUsername) {
            socket.emit('chat message', { text: `/mute ${targetUsername}` });
        }
        if (menu) menu.style.display = 'none';
    });
}

if (userContextUnmute) {
    userContextUnmute.addEventListener('click', () => {
        const menu = document.getElementById('user-context-menu');
        const targetUsername = menu?.dataset.targetUsername;
        if (targetUsername) {
            socket.emit('chat message', { text: `/unmute ${targetUsername}` });
        }
        if (menu) menu.style.display = 'none';
    });
}

if (userContextKick) {
    userContextKick.addEventListener('click', () => {
        const menu = document.getElementById('user-context-menu');
        const targetUsername = menu?.dataset.targetUsername;
        if (targetUsername) {
            socket.emit('chat message', { text: `/kick ${targetUsername}` });
        }
        if (menu) menu.style.display = 'none';
    });
}

// Message context menu handlers
const messageContextCopy = document.getElementById('ctx-msg-copy');
const messageContextDeleteMe = document.getElementById('ctx-msg-delete-me');
const messageContextDeleteAll = document.getElementById('ctx-msg-delete-all');
const messageContextMute = document.getElementById('ctx-msg-mute');
const messageContextUnmute = document.getElementById('ctx-msg-unmute');
const messageContextKick = document.getElementById('ctx-msg-kick');

if (messageContextCopy) {
    messageContextCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(selectedText);
        const menu = document.getElementById('message-context-menu');
        if (menu) menu.style.display = 'none';
    });
}

if (messageContextDeleteMe) {
    messageContextDeleteMe.addEventListener('click', () => {
        const menu = document.getElementById('message-context-menu');
        const messageId = menu?.dataset.messageId;
        if (messageId) {
            const container = document.getElementById(`msg-${messageId}`);
            if (container) {
                container.style.opacity = '0';
                container.style.transform = 'translateX(-20px)';
                setTimeout(() => container.remove(), 200);
            }
        }
        if (menu) menu.style.display = 'none';
    });
}

if (messageContextDeleteAll) {
    messageContextDeleteAll.addEventListener('click', () => {
        const menu = document.getElementById('message-context-menu');
        const messageId = menu?.dataset.messageId;
        if (messageId) {
            socket.emit('delete_message', { messageId, roomCode: currentRoom });
        }
        if (menu) menu.style.display = 'none';
    });
}

if (messageContextMute) {
    messageContextMute.addEventListener('click', () => {
        const menu = document.getElementById('message-context-menu');
        const targetUsername = menu?.dataset.messageAuthor;
        if (targetUsername && targetUsername !== username) {
            socket.emit('chat message', { text: `/mute ${targetUsername}` });
        }
        if (menu) menu.style.display = 'none';
    });
}

if (messageContextUnmute) {
    messageContextUnmute.addEventListener('click', () => {
        const menu = document.getElementById('message-context-menu');
        const targetUsername = menu?.dataset.messageAuthor;
        if (targetUsername && targetUsername !== username) {
            socket.emit('chat message', { text: `/unmute ${targetUsername}` });
        }
        if (menu) menu.style.display = 'none';
    });
}

if (messageContextKick) {
    messageContextKick.addEventListener('click', () => {
        const menu = document.getElementById('message-context-menu');
        const targetUsername = menu?.dataset.messageAuthor;
        if (targetUsername && targetUsername !== username) {
            socket.emit('chat message', { text: `/kick ${targetUsername}` });
        }
        if (menu) menu.style.display = 'none';
    });
}

// ============================================================
// Send Message
// ============================================================
function sendMessage() {
    const text = messageInput.value.trim();
    if (text) {
        // Clear typing status when sending a message
        if (isCurrentlyTyping) {
            isCurrentlyTyping = false;
            clearTimeout(typingTimeout);
            socket.emit('typing', { roomCode: currentRoom, isTyping: false });
        }

        socket.emit('chat message', { text });
        messageInput.value = '';
        messageInput.focus();
    }
}

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Auto-scroll to bottom when input is focused (mobile)
messageInput.addEventListener('focus', () => {
    setTimeout(() => {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }, 300); // Wait for keyboard animation
});

// ============================================================
// Typing
// ============================================================
// ============================================================
// Typing
// ============================================================
let isCurrentlyTyping = false;

messageInput.addEventListener('input', () => {
    if (!currentRoom || !username) return;

    // Only send typing event once when user starts typing
    if (!isCurrentlyTyping) {
        isCurrentlyTyping = true;
        socket.emit('typing', { roomCode: currentRoom, isTyping: true });
    }

    // Clear existing timeout
    clearTimeout(typingTimeout);

    // Set timeout to stop typing after 2 seconds of inactivity
    typingTimeout = setTimeout(() => {
        if (isCurrentlyTyping) {
            isCurrentlyTyping = false;
            socket.emit('typing', { roomCode: currentRoom, isTyping: false });
        }
    }, 2000);
});

// Receive typing event from others
socket.on('user typing', (data) => {
    if (data.username === username) return; // Don't show own typing

    const typingIndicator = document.getElementById('typing-indicator');
    const typingText = document.getElementById('typing-text');

    if (!typingIndicator || !typingText) return;

    // Update the typing users map
    if (data.isTyping) {
        typingUsers.set(data.username, Date.now());
    } else {
        typingUsers.delete(data.username);
    }

    // Update the UI
    updateTypingIndicator();
});

// Receive recording event from others
socket.on('user recording', (data) => {
    if (data.username === username) return; // Don't show own recording

    // Update the recording users map
    if (data.isRecording) {
        recordingUsers.set(data.username, Date.now());
    } else {
        recordingUsers.delete(data.username);
    }

    // Update the UI
    updateTypingIndicator();
});

function updateTypingIndicator() {
    const typingIndicator = document.getElementById('typing-indicator');
    const typingText = document.getElementById('typing-text');

    if (!typingIndicator || !typingText) {
        console.warn('Typing indicator elements not found');
        return;
    }

    // Remove users who haven't typed in 3 seconds (cleanup)
    const now = Date.now();
    for (const [user, timestamp] of typingUsers.entries()) {
        if (now - timestamp > 3000) {
            typingUsers.delete(user);
        }
    }

    // Remove users who haven't recorded in 3 seconds (cleanup)
    for (const [user, timestamp] of recordingUsers.entries()) {
        if (now - timestamp > 3000) {
            recordingUsers.delete(user);
        }
    }

    // Priority: Show recording status first, then typing
    let text = '';
    let isRecordingStatus = false;
    if (recordingUsers.size > 0) {
        isRecordingStatus = true;
        const users = Array.from(recordingUsers.keys());
        if (users.length === 1) {
            text = `${users[0]} is recording... 🎤`;
        } else if (users.length === 2) {
            text = `${users[0]} and ${users[1]} are recording... 🎤`;
        } else {
            text = `${users.length} people are recording... 🎤`;
        }
    } else if (typingUsers.size > 0) {
        const users = Array.from(typingUsers.keys());
        if (users.length === 1) {
            text = `${users[0]} is typing...`;
        } else if (users.length === 2) {
            text = `${users[0]} and ${users[1]} are typing...`;
        } else {
            text = `${users.length} people are typing...`;
        }
    }

    // Update display
    if (text) {
        // Set text content - use multiple methods to ensure it works
        typingText.textContent = text;
        typingText.innerText = text;
        typingText.innerHTML = text;

        // Show indicator with multiple methods to ensure visibility
        typingIndicator.style.display = 'block';
        typingIndicator.style.visibility = 'visible';
        typingIndicator.style.opacity = '1';
        typingIndicator.style.height = 'auto';
        typingIndicator.style.minHeight = '28px';
        typingIndicator.classList.add('visible');

        // Force text visibility
        typingText.style.display = 'block';
        typingText.style.visibility = 'visible';
        typingText.style.opacity = '1';

        // Show recording status in red, typing in gray
        if (isRecordingStatus) {
            typingText.style.color = '#ff4444';
            typingIndicator.style.borderTop = '1px solid rgba(255, 68, 68, 0.2)';
        } else {
            typingText.style.color = '#666';
            typingIndicator.style.borderTop = '1px solid rgba(0, 0, 0, 0.05)';
        }
    } else {
        // Hide indicator
        typingIndicator.style.display = 'none';
        typingIndicator.style.visibility = 'hidden';
        typingIndicator.style.opacity = '0';
        typingIndicator.style.height = '0';
        typingIndicator.classList.remove('visible');
        typingText.textContent = '';
        typingText.innerText = '';
        typingText.innerHTML = '';
    }
}

// ============================================================
// Voice Recording
// ============================================================
async function startRecording() {
    if (isRecording || !currentRoom) return;

    try {
        // Request microphone access
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Create MediaRecorder
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onerror = (error) => {
            console.error('MediaRecorder error:', error);
            stopRecording();
            showError('Recording Error', 'Failed to record audio. Please try again.');
        };

        mediaRecorder.onstop = async () => {
            const recordingDuration = Date.now() - (recordingStartTime || Date.now());

            // Only send if recording is long enough and has audio data
            if (recordingDuration >= MIN_RECORDING_DURATION && audioChunks.length > 0) {
                try {
                    // Convert audio chunks to blob
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

                    // Only send if blob has content
                    if (audioBlob.size > 0) {
                        // Convert to Base64 DataURL
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            try {
                                // Send voice message with full DataURL (data:audio/webm;base64,...)
                                if (reader.result) {
                                    socket.emit('chat message', {
                                        type: 'voice',
                                        audioData: reader.result, // Full DataURL
                                        mimeType: 'audio/webm'
                                    });
                                }
                            } catch (error) {
                                console.error('Error processing audio:', error);
                            }
                        };
                        reader.onerror = () => {
                            console.error('FileReader error');
                        };
                        reader.readAsDataURL(audioBlob);
                    }
                } catch (error) {
                    console.error('Error creating audio blob:', error);
                }
            }

            // Stop all tracks
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
            }

            // Reset state
            audioChunks = [];
            recordingStartTime = null;
        };

        // Start recording
        mediaRecorder.start();
        isRecording = true;
        recordingStartTime = Date.now();

        // Update UI
        if (voiceRecordBtn) {
            voiceRecordBtn.classList.add('recording');
        }

        // Emit recording status
        socket.emit('recording status', {
            roomCode: currentRoom,
            isRecording: true
        });

    } catch (error) {
        console.error('Error accessing microphone:', error);
        showError('Microphone Access', 'Could not access microphone. Please check permissions.');
    }
}

function stopRecording() {
    if (!isRecording || !mediaRecorder) return;

    // Stop recording (this will trigger onstop which sends the message)
    if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }

    isRecording = false;

    // Update UI immediately
    if (voiceRecordBtn) {
        voiceRecordBtn.classList.remove('recording');
    }

    // Emit recording status
    socket.emit('recording status', {
        roomCode: currentRoom,
        isRecording: false
    });
}

// Voice record button handlers
if (voiceRecordBtn) {
    voiceRecordBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startRecording();
    });

    voiceRecordBtn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        stopRecording();
    });

    voiceRecordBtn.addEventListener('mouseleave', (e) => {
        e.preventDefault();
        stopRecording();
    });

    // Touch events for mobile
    voiceRecordBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startRecording();
    });

    voiceRecordBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        stopRecording();
    });

    voiceRecordBtn.addEventListener('touchcancel', (e) => {
        if (e.cancelable) {
            e.preventDefault();
        }
        stopRecording();
    });
}

// ============================================================
// Emoji Picker
// ============================================================
// ============================================================
// Emoji Picker & Action Menu
// ============================================================
const actionBtn = document.getElementById('action-btn');
const floatingMenu = document.getElementById('floating-menu');
const menuEmoji = document.getElementById('menu-emoji');
const menuUpload = document.getElementById('menu-upload');
const menuUrl = document.getElementById('menu-url');

// Emoji picker functionality
let isEmojiPickerOpen = false;

// 1. Toggle Action Menu
if (actionBtn && floatingMenu) {
    actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        floatingMenu.classList.toggle('active');
        // Close emoji picker if opening menu
        if (floatingMenu.classList.contains('active') && emojiPicker) {
            emojiPicker.style.display = 'none';
            isEmojiPickerOpen = false;
        }
    });
}

// ============================================================
// Image Upload Modal (Unified for File Upload & URL)
// ============================================================
const uploadModal = document.getElementById('image-upload-modal');
const modalTitle = document.getElementById('modal-title');
const urlSection = document.getElementById('url-input-section');
const externalUrlInput = document.getElementById('external-url-input');
const previewImg = document.getElementById('upload-preview');
const placeholder = document.getElementById('preview-placeholder');
const captionInput = document.getElementById('image-caption-input');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelUploadBtn = document.getElementById('cancel-upload-btn');
const confirmUploadBtn = document.getElementById('confirm-upload-btn');

// Utility function to close the image upload modal
function closeImageModal() {
    if (uploadModal) {
        uploadModal.style.display = 'none';
    }
    if (fileInput) {
        fileInput.value = ''; // Reset file input
    }
    if (captionInput) {
        captionInput.value = '';
    }
    if (previewImg) {
        previewImg.src = '';
        previewImg.style.display = 'none';
    }
    if (placeholder) {
        placeholder.style.display = 'flex';
        placeholder.textContent = 'No image selected';
    }
    if (urlSection) {
        urlSection.style.display = 'none';
    }
    if (externalUrlInput) {
        externalUrlInput.value = '';
    }
    if (modalTitle) {
        modalTitle.textContent = 'Send Image';
    }
}

// --- 1. Handle "Image URL" Button Click ---
if (menuUrl) {
    menuUrl.addEventListener('click', (e) => {
        e.stopPropagation();
        floatingMenu.classList.remove('active');
        
        // Reset and show URL mode
        if (uploadModal) {
            uploadModal.style.display = 'flex';
        }
        if (urlSection) {
            urlSection.style.display = 'block';
        }
        if (previewImg) {
            previewImg.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = 'flex';
            placeholder.textContent = 'Enter a URL to preview';
        }
        if (externalUrlInput) {
            externalUrlInput.value = '';
            setTimeout(() => externalUrlInput.focus(), 100);
        }
        if (modalTitle) {
            modalTitle.textContent = 'Send Image from URL';
        }
    });
}

// --- 2. Live Preview for URL ---
if (externalUrlInput && previewImg && placeholder) {
    externalUrlInput.addEventListener('input', (e) => {
        const url = e.target.value.trim();
        // Check if URL looks like an image (ends with image extension or is data URL)
        if (url.match(/\.(jpeg|jpg|gif|png|webp|svg|bmp)$/i) || url.startsWith('data:image') || url.startsWith('http')) {
            previewImg.src = url;
            previewImg.onload = () => {
                previewImg.style.display = 'block';
                placeholder.style.display = 'none';
            };
            previewImg.onerror = () => {
                previewImg.style.display = 'none';
                placeholder.style.display = 'flex';
                placeholder.textContent = 'Invalid image URL';
            };
        } else if (url.length === 0) {
            previewImg.style.display = 'none';
            placeholder.style.display = 'flex';
            placeholder.textContent = 'Enter a URL to preview';
        }
    });
}

// --- 3. Handle "Upload File" Button Click ---
if (menuUpload && fileInput) {
    menuUpload.addEventListener('click', (e) => {
        e.stopPropagation();
        floatingMenu.classList.remove('active');
        fileInput.click(); // Open hidden system file selector
    });
}

// Handle file selection and show modal
if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                // Setup Modal for File mode
                if (uploadModal) {
                    uploadModal.style.display = 'flex';
                }
                if (urlSection) {
                    urlSection.style.display = 'none'; // Hide URL box
                }
                if (previewImg) {
                    previewImg.src = event.target.result;
                    previewImg.style.display = 'block';
                }
                if (placeholder) {
                    placeholder.style.display = 'none';
                }
                if (modalTitle) {
                    modalTitle.textContent = 'Send Image';
                }
                // Focus caption input after a short delay to ensure modal is visible
                setTimeout(() => {
                    if (captionInput) {
                        captionInput.focus();
                    }
                }, 100);
            };
            reader.onerror = () => {
                showError('Upload Error', 'Failed to read image file. Please try again.');
                closeImageModal();
            };
            reader.readAsDataURL(file);
        } else if (file) {
            showError('Invalid File', 'Please select an image file.');
            closeImageModal();
        }
    });
}

// --- 4. Unified Send Logic ---
if (confirmUploadBtn) {
    confirmUploadBtn.addEventListener('click', () => {
        // Determine if we're in URL mode or file mode
        const isUrlMode = urlSection && urlSection.style.display === 'block';
        let finalImageUrl = '';
        
        if (isUrlMode) {
            finalImageUrl = externalUrlInput ? externalUrlInput.value.trim() : '';
        } else {
            finalImageUrl = previewImg ? previewImg.src : '';
        }
        
        if (!finalImageUrl) {
            showError('No Image', 'Please select or paste an image.');
            return;
        }
        
        const caption = captionInput ? captionInput.value.trim() : '';
        
        // Emit to server - use 'image-url' type for URLs, 'image' for file uploads
        if (isUrlMode) {
            socket.emit('chat message', {
                type: 'image-url',
                url: finalImageUrl,
                text: caption || undefined
            });
        } else {
            socket.emit('chat message', {
                type: 'image',
                data: finalImageUrl, // Base64 data URL
                text: caption || undefined
            });
        }

        closeImageModal();
    });
}

// Close and Cancel buttons
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeImageModal);
}

if (cancelUploadBtn) {
    cancelUploadBtn.addEventListener('click', closeImageModal);
}

// Close modal when clicking outside
if (uploadModal) {
    uploadModal.addEventListener('click', (e) => {
        if (e.target === uploadModal) {
            closeImageModal();
        }
    });
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && uploadModal && uploadModal.style.display === 'flex') {
        closeImageModal();
    }
});

// ============================================================
// Drag and Drop Support (Telegram-style)
// ============================================================
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    // Optional: Add visual feedback when dragging over the chat area
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/')) {
            // Set the file to the input
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            if (fileInput) {
                fileInput.files = dataTransfer.files;
                // Trigger change event (this will show the modal in file mode)
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else {
            showError('Invalid File', 'Please drop an image file.');
        }
    }
});

// menuUrl handler is now in the Image Upload Modal section above

// --- Categorized Emoji Map (Telegram-style) ---
const emojiCategories = {
    'recent': {
        name: 'Recently Used',
        icon: '🕐',
        emojis: [] // Populated from localStorage
    },
    'smileys': {
        name: 'Smileys',
        icon: '😊',
        emojis: ['😊', '😂', '🤣', '😍', '😒', '😭', '🥺', '😎', '🤔', '🙄', '😴', '🤤', '😋', '😘', '🥰', '😇', '🤗', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '😯', '😦', '😧', '😮', '😲', '😵', '🤐', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '😈', '👿', '👹', '👺', '💀', '☠️', '💩', '🤡', '👻', '👽', '👾', '🤖']
    },
    'gestures': {
        name: 'Hand Gestures',
        icon: '👍',
        emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵']
    },
    'activities': {
        name: 'Activities',
        icon: '🔥',
        emojis: ['🔥', '✨', '🎉', '🚀', '💡', '💯', '⭐', '🌟', '💫', '⚡', '🌈', '🎈', '🎊', '🎁', '🏆', '🥇', '🥈', '🥉', '🎖️', '🏅', '🎗️', '🎫', '🎟️', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩', '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜', '🛴', '🚲', '🛵', '🏍️', '🛺', '✈️', '🛫', '🛬', '🛩️', '🚁', '🚟', '🚀', '🛸', '🚤', '⛵', '🛥️', '🛳️', '⛴️', '🚢']
    },
    'animals': {
        name: 'Animals',
        icon: '🐶',
        emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦗', '🕷️', '🦂', '🦟', '🦠', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦡', '🐾']
    },
    'food': {
        name: 'Food',
        icon: '🍕',
        emojis: ['🍕', '🍔', '🍟', '🌭', '🍿', '🧂', '🥓', '🥚', '🍳', '🥞', '🥐', '🥨', '🍞', '🥖', '🥯', '🧀', '🥗', '🥙', '🥪', '🌮', '🌯', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕️', '🍵', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧃', '🧉', '🧊', '🥢', '🍽️', '🍴', '🥄']
    },
    'flags': {
        name: 'Flags',
        icon: '🏳️',
        emojis: ['🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '🇺🇳', '🇺🇸', '🇬🇧', '🇨🇦', '🇦🇺', '🇩🇪', '🇫🇷', '🇮🇹', '🇪🇸', '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇧🇷', '🇷🇺', '🇲🇽', '🇦🇷', '🇨🇱', '🇨🇴', '🇵🇪', '🇻🇪', '🇿🇦', '🇪🇬', '🇳🇬', '🇰🇪', '🇪🇹', '🇲🇦', '🇹🇳', '🇩🇿', '🇸🇦', '🇦🇪', '🇮🇱', '🇹🇷', '🇮🇷', '🇮🇶', '🇸🇾', '🇯🇴', '🇱🇧', '🇵🇰', '🇦🇫', '🇮🇩', '🇹🇭', '🇻🇳', '🇵🇭', '🇲🇾', '🇸🇬', '🇳🇿', '🇫🇯', '🇵🇬', '🇵🇼', '🇳🇨', '🇻🇺', '🇳🇷', '🇰🇮', '🇹🇴', '🇼🇸', '🇦🇸', '🇬🇺', '🇲🇵', '🇵🇷', '🇻🇮', '🇬🇩', '🇧🇧', '🇧🇿', '🇯🇲', '🇭🇹', '🇨🇺', '🇩🇴', '🇭🇳', '🇬🇹', '🇳🇮', '🇨🇷', '🇵🇦', '🇧🇴', '🇵🇾', '🇺🇾', '🇧🇷', '🇪🇨', '🇬🇾', '🇸🇷', '🇬🇫', '🇬🇵', '🇲🇶', '🇲🇸', '🇦🇬', '🇧🇧', '🇧🇩', '🇧🇹', '🇧🇳', '🇰🇭', '🇱🇦', '🇲🇲', '🇲🇻', '🇲🇺', '🇳🇵', '🇵🇰', '🇱🇰', '🇹🇱', '🇹🇯', '🇹🇲', '🇺🇿', '🇰🇿', '🇰🇬', '🇹🇯', '🇲🇳', '🇧🇾', '🇲🇩', '🇺🇦', '🇷🇴', '🇧🇬', '🇬🇷', '🇦🇱', '🇲🇰', '🇷🇸', '🇧🇦', '🇭🇷', '🇸🇮', '🇸🇰', '🇨🇿', '🇵🇱', '🇱🇹', '🇱🇻', '🇪🇪', '🇫🇮', '🇸🇪', '🇳🇴', '🇩🇰', '🇮🇸', '🇮🇪', '🇬🇧', '🇵🇹', '🇪🇸', '🇫🇷', '🇧🇪', '🇳🇱', '🇱🇺', '🇨🇭', '🇦🇹', '🇱🇮', '🇲🇨', '🇻🇦', '🇸🇲', '🇮🇹', '🇲🇹', '🇨🇾']
    }
};

// 1. Initialize Picker with Categories
function initEmojiPicker() {
    if (!emojiPicker) return;
    
    // Load recent emojis from localStorage
    const recentEmojis = getRecentEmojis();
    emojiCategories.recent.emojis = recentEmojis.slice(0, 24).map(e => typeof e === 'string' ? e : e.emoji); // Max 24 recent emojis
    
    // Determine default active category (recent if has emojis, otherwise smileys)
    const defaultCategory = emojiCategories.recent.emojis.length > 0 ? 'recent' : 'smileys';
    
    // Build HTML structure
    let html = `
        <div class="emoji-picker-header">
            <div class="emoji-tabs">
    `;
    
    // Create tabs
    Object.keys(emojiCategories).forEach(categoryId => {
        const category = emojiCategories[categoryId];
        const isActive = categoryId === defaultCategory;
        html += `<button class="emoji-tab ${isActive ? 'active' : ''}" data-category="${categoryId}" title="${category.name}">${category.icon}</button>`;
    });
    
    html += `
            </div>
        </div>
        <div class="emoji-picker-content">
    `;
    
    // Create category sections
    Object.keys(emojiCategories).forEach(categoryId => {
        const category = emojiCategories[categoryId];
        const isActive = categoryId === defaultCategory;
        const shouldShow = categoryId !== 'recent' || category.emojis.length > 0;
        
        html += `
            <div class="emoji-category-section ${isActive ? 'active' : ''}" data-category="${categoryId}" id="category-${categoryId}" ${!shouldShow ? 'style="display: none;"' : ''}>
                <div class="emoji-category-header">${category.name.toUpperCase()}</div>
                <div class="emoji-grid">
        `;
        
        category.emojis.forEach(emoji => {
            html += `<span class="emoji-item" data-emoji="${emoji}">${emoji}</span>`;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    html += `</div>`;
    
    emojiPicker.innerHTML = html;
    
    // Setup category tab switching
    setupCategoryTabs();
}

// Setup category tab switching with smooth scrolling
function setupCategoryTabs() {
    const tabs = emojiPicker.querySelectorAll('.emoji-tab');
    const content = emojiPicker.querySelector('.emoji-picker-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            const categoryId = tab.dataset.category;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show/hide category sections
            const sections = emojiPicker.querySelectorAll('.emoji-category-section');
            sections.forEach(section => {
                section.classList.remove('active');
            });
            
            const targetSection = emojiPicker.querySelector(`#category-${categoryId}`);
            if (targetSection) {
                targetSection.classList.add('active');
                
                // Smooth scroll to category
                targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// 2. Click to Type in Input Bar (with selectionStart insertion)
if (emojiPicker) {
    emojiPicker.addEventListener('click', (e) => {
        const item = e.target.closest('.emoji-item');
        if (!item) return;
        
        e.stopPropagation(); // Prevent closing picker

        // Get emoji from data attribute or textContent
        const emojiToInsert = item.dataset.emoji || item.textContent.trim();

        if (emojiToInsert && messageInput) {
            // Insert at selectionStart (not just append)
            const start = messageInput.selectionStart || 0;
            const end = messageInput.selectionEnd || 0;
            const text = messageInput.value;

            messageInput.value = text.slice(0, start) + emojiToInsert + text.slice(end);
            messageInput.focus();
            
            // Set cursor position after inserted emoji
            const newPosition = start + emojiToInsert.length;
            messageInput.setSelectionRange(newPosition, newPosition);
            
            // Save to recent emojis
            addRecentEmoji(emojiToInsert);
            
            // Update recent category if visible
            updateRecentEmojisInPicker();
        }
    });
}

// Update recent emojis in picker
function updateRecentEmojisInPicker() {
    if (!emojiPicker) return;
    
    const recentSection = emojiPicker.querySelector('#category-recent .emoji-grid');
    if (!recentSection) return;
    
    const recentEmojis = getRecentEmojis().slice(0, 24);
    emojiCategories.recent.emojis = recentEmojis.map(e => typeof e === 'string' ? e : e.emoji);
    
    // Update the grid
    recentSection.innerHTML = emojiCategories.recent.emojis.map(emoji => {
        return `<span class="emoji-item" data-emoji="${emoji}">${emoji}</span>`;
    }).join('');
    
    // Show/hide recent section based on whether there are emojis
    const categorySection = emojiPicker.querySelector('#category-recent');
    if (categorySection) {
        if (emojiCategories.recent.emojis.length === 0) {
            categorySection.style.display = 'none';
        } else {
            categorySection.style.display = 'block';
        }
    }
}

// 3. Toggle Show/Hide
if (menuEmoji && emojiPicker) {
    menuEmoji.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = emojiPicker.style.display === 'flex';
        emojiPicker.style.display = isVisible ? 'none' : 'flex';
        
        // Close the floating + menu
        if (floatingMenu) floatingMenu.classList.remove('active');
    });
}

// 4. Click Anywhere Else to Disappear
document.addEventListener('click', (e) => {
    // Hide Floating Menu
    if (floatingMenu && floatingMenu.classList.contains('active')) {
        if (!floatingMenu.contains(e.target) && e.target !== actionBtn) {
            floatingMenu.classList.remove('active');
        }
    }

    // If user clicked outside picker AND outside the toggle button, hide it
    if (emojiPicker && !emojiPicker.contains(e.target) && e.target !== menuEmoji) {
        emojiPicker.style.display = 'none';
    }
});

// Run init on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEmojiPicker);
} else {
    initEmojiPicker();
}

// ============================================================
// Mobile Menu Toggle
// ============================================================
if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
        sidebarOverlay.classList.toggle('active');
    });
}

if (mobileMembersBtn) {
    mobileMembersBtn.addEventListener('click', () => {
        onlineUsersContainer.classList.toggle('mobile-open');
        sidebarOverlay.classList.toggle('active');
    });
}

if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        onlineUsersContainer.classList.remove('mobile-open');
        sidebarOverlay.classList.remove('active');
    });
}

// Close mobile menus on window resize
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        sidebar.classList.remove('mobile-open');
        onlineUsersContainer.classList.remove('mobile-open');
        sidebarOverlay.classList.remove('active');
    }

    // Update mobile game UI visibility
    const mobileRoleBadge = document.getElementById('mobile-role-badge');
    const mobileGameActions = document.getElementById('mobile-game-actions');
    if (window.innerWidth <= 768 && isMafiaRoom && myRole) {
        if (mobileRoleBadge) {
            mobileRoleBadge.style.display = 'block';
            const mobileRoleText = document.getElementById('mobile-role-text');
            if (mobileRoleText) {
                mobileRoleText.textContent = `${ROLE_ICONS[myRole] || '🎭'} ${myRole}`;
                mobileRoleText.style.color = ROLE_COLORS[myRole] || '#333';
            }
        }
        if (mobileGameActions) {
            mobileGameActions.style.display = 'flex';
        }
    } else {
        if (mobileRoleBadge) mobileRoleBadge.style.display = 'none';
        if (mobileGameActions) mobileGameActions.style.display = 'none';
    }
});

// Mobile game action buttons
const gameActionButtons = document.querySelectorAll('.game-action-btn');
gameActionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'vote') {
            const target = prompt('Enter player name to vote:');
            if (target) {
                socket.emit('chat message', { text: `/vote ${target}` });
            }
        } else if (action === 'skip') {
            socket.emit('chat message', { text: '/skip' });
        }
    });
});

// ============================================================
// Emoji Helpers (Restored)
// ============================================================

// Recent emojis management with frequency tracking (top 30)
const RECENT_EMOJIS_KEY = 'glchat_recent_emojis';
const MAX_RECENT_EMOJIS = 30;

function getRecentEmojis() {
    try {
        const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
        if (!stored) return [];

        const data = JSON.parse(stored);
        // Return array of { emoji, count } sorted by frequency
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
}

function addRecentEmoji(emoji) {
    try {
        let recent = getRecentEmojis();

        // Find existing emoji or create new entry
        const existingIndex = recent.findIndex(e => e.emoji === emoji);

        if (existingIndex >= 0) {
            // Increment frequency
            recent[existingIndex].count++;
            // Move to front (most recently used)
            const item = recent.splice(existingIndex, 1)[0];
            recent.unshift(item);
        } else {
            // Add new emoji with count 1
            recent.unshift({ emoji: emoji, count: 1 });
        }

        // Sort by frequency (count), then by recency
        recent.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return recent.indexOf(a) - recent.indexOf(b);
        });

        // Keep only top MAX_RECENT_EMOJIS
        recent = recent.slice(0, MAX_RECENT_EMOJIS);

        localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(recent));
        
        // Update both old and new UI
        updateRecentEmojisUI();
        updateRecentEmojisInPicker();
    } catch (e) {
        console.error('Failed to save recent emoji:', e);
    }
}

function updateRecentEmojisUI() {
    const recentContainer = document.getElementById('emoji-recent');
    if (!recentContainer) return;

    const recent = getRecentEmojis();
    if (recent.length === 0) {
        recentContainer.style.display = 'none';
        return;
    }

    recentContainer.style.display = 'grid';
    // Display emojis ordered by frequency
    recentContainer.innerHTML = recent.map(item => {
        const emoji = typeof item === 'string' ? item : item.emoji;
        return `<span class="emoji-item" data-emoji="${emoji}">${emoji}</span>`;
    }).join('');

    // Add click handlers
    recentContainer.querySelectorAll('.emoji-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const emoji = item.dataset.emoji;
            insertEmojiAtCursor(emoji);
            messageInput.focus();
        });
    });
}

// Zero-latency emoji insertion at cursor position
function insertEmojiAtCursor(emoji) {
    const input = messageInput;
    if (!input) return;

    // Get current cursor position
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const text = input.value;

    // Insert emoji at cursor position
    input.value = text.substring(0, start) + emoji + text.substring(end);

    // Set cursor position after inserted emoji (zero-latency)
    const newPosition = start + emoji.length;
    input.setSelectionRange(newPosition, newPosition);

    // Maintain focus for keyboard input
    input.focus();

    // Trigger input event for any listeners (typing indicator, etc.)
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Save to recent emojis
    addRecentEmoji(emoji);
}
