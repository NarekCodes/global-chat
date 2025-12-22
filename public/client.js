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
const typingText = document.getElementById('typing-text');

const contextMenu = document.getElementById('context-menu');
const contextCopy = document.getElementById('ctx-copy');

// ============================================================
// State
// ============================================================
let username = '';
let currentRoom = '';
let isLeader = false;
let myRole = null;
let myTeam = null;
let gameState = 'LOBBY';
let typingUsers = new Set();
let typingTimeout;
let isTyping = false;

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
    isLeader = data.isLeader;
    isMafiaRoom = data.isMafiaRoom || false;
    gameState = 'LOBBY';
    myRole = null;

    currentRoomCodeDisplay.textContent = data.roomCode;

    // Mode-specific UI rendering
    if (isMafiaRoom) {
        // MAFIA Room: Show game UI
        roleDisplay.style.display = 'none';
        phaseIndicator.style.display = 'block';
        standardCommands.style.display = 'none';
        gameCommands.style.display = 'block';
        roomNameDisplay.textContent = 'Mafia Game';
        membersTitle.textContent = 'Players';
        updatePhaseUI('LOBBY');
    } else {
        // Standard Room: Hide game UI
        roleDisplay.style.display = 'none';
        phaseIndicator.style.display = 'none';
        standardCommands.style.display = 'block';
        gameCommands.style.display = 'none';
        roomNameDisplay.textContent = 'Chat Room';
        membersTitle.textContent = 'Members';
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
});

roleModalClose.addEventListener('click', () => {
    roleModal.style.display = 'none';
});

socket.on('phaseChange', (data) => {
    gameState = data.phase;
    updatePhaseUI(data.phase, data.round);
});

function updatePhaseUI(phase, round) {
    gameState = phase;

    if (phase === 'LOBBY') {
        phaseText.textContent = 'LOBBY';
        phaseIndicator.className = 'phase-indicator phase-lobby';
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
// Messages
// ============================================================
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMessage(data) {
    if (!data.id) data.id = Date.now() + Math.random().toString(36).substr(2, 9);

    const container = document.createElement('div');
    container.classList.add('message-container');
    container.id = `msg-${data.id}`;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');

    // System messages
    if (data.username === 'SYSTEM') {
        messageDiv.classList.add('system');
        if (data.type === 'death') messageDiv.classList.add('death-message');
        if (data.type === 'phase') messageDiv.classList.add('phase-message');
        if (data.type === 'victory') messageDiv.classList.add('victory-message');
        if (data.type === 'private') messageDiv.classList.add('private-message');
        if (data.type === 'error') messageDiv.classList.add('error-message');

        messageDiv.innerHTML = escapeHtml(data.text);
    } else {
        const isMe = data.username === username || data.username.includes(username);
        messageDiv.classList.add(isMe ? 'self' : 'other');

        if (data.isSecret) {
            messageDiv.classList.add('mafia-message');
        }

        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('username');
        usernameSpan.textContent = data.username;
        messageDiv.appendChild(usernameSpan);

        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = escapeHtml(data.text);
        messageDiv.appendChild(contentDiv);
    }

    // Context menu
    messageDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, data.text);
    });

    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');

    if (data.username !== 'SYSTEM' && data.avatarUrl) {
        const avatarContainer = document.createElement('div');
        avatarContainer.classList.add('avatar-container');
        const avatarImg = document.createElement('img');
        avatarImg.src = data.avatarUrl;
        avatarImg.classList.add('avatar-img');
        avatarImg.onerror = function () { this.src = getFallbackAvatar(data.username); };
        avatarContainer.appendChild(avatarImg);
        wrapper.appendChild(avatarContainer);
    }

    const messageContent = document.createElement('div');
    messageContent.classList.add('message-content');
    messageContent.appendChild(messageDiv);
    wrapper.appendChild(messageContent);

    container.appendChild(wrapper);
    messagesArea.appendChild(container);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

socket.on('loadHistory', (history) => {
    messagesArea.innerHTML = '';
    history.forEach(msg => renderMessage(msg));
});

socket.on('chat message', (msg) => {
    renderMessage(msg);
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
        avatarImg.onerror = function () { this.src = getFallbackAvatar(user.username); };
        li.appendChild(avatarImg);

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('player-name');
        nameSpan.textContent = user.username;

        // MAFIA Room only: Show crown for leader
        if (isMafiaRoom && user.isLeader) nameSpan.textContent += ' 👑';
        if (user.username === username) nameSpan.textContent += ' (You)';
        li.appendChild(nameSpan);

        // MAFIA Room only: Show hearts/skulls
        if (isMafiaRoom) {
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

document.addEventListener('click', () => contextMenu.style.display = 'none');

contextCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(selectedText);
    contextMenu.style.display = 'none';
});

// ============================================================
// Send Message
// ============================================================
function sendMessage() {
    const text = messageInput.value.trim();
    if (text) {
        socket.emit('chat message', { text });
        messageInput.value = '';
        messageInput.focus();
    }
}

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// ============================================================
// Typing
// ============================================================
messageInput.addEventListener('input', () => {
    if (!isTyping && username) {
        isTyping = true;
        socket.emit('typing');
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        socket.emit('stopTyping');
    }, 2000);
});

socket.on('userTyping', (user) => {
    if (user !== username) {
        typingUsers.add(user);
        updateTypingUI();
    }
});

socket.on('userStopTyping', (user) => {
    typingUsers.delete(user);
    updateTypingUI();
});

function updateTypingUI() {
    const users = Array.from(typingUsers);
    if (users.length === 0) {
        typingIndicator.classList.remove('visible');
    } else {
        typingText.textContent = users.length === 1
            ? `${users[0]} is typing...`
            : 'Multiple people typing...';
        typingIndicator.classList.add('visible');
    }
}

// ============================================================
// Emoji Picker
// ============================================================
const actionBtn = document.getElementById('action-btn');
const floatingMenu = document.getElementById('floating-menu');
const menuEmoji = document.getElementById('menu-emoji');
const emojiPicker = document.getElementById('emoji-picker');

actionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingMenu.style.display = floatingMenu.style.display === 'flex' ? 'none' : 'flex';
});

menuEmoji.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingMenu.style.display = 'none';
    emojiPicker.style.display = 'grid';
});

document.addEventListener('click', () => {
    floatingMenu.style.display = 'none';
    emojiPicker.style.display = 'none';
});

emojiPicker.querySelectorAll('span').forEach(span => {
    span.addEventListener('click', (e) => {
        e.stopPropagation();
        messageInput.value += span.textContent;
        messageInput.focus();
    });
});
