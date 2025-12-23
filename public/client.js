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
    isLeader = false; // Leader status only set via /getleader
    isMafiaRoom = data.isMafiaRoom || false;
    gameState = 'LOBBY';
    myRole = null;
    leaderActivated = false; // Reset leader activation on room join
    
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
        roleDisplay.style.display = 'none';
        phaseIndicator.style.display = 'block';
        standardCommands.style.display = 'none';
        gameCommands.style.display = 'block';
        roomNameDisplay.textContent = isSpectator ? 'Mafia Game 👁️' : 'Mafia Game';
        membersTitle.textContent = 'Players';
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

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-text');
        contentDiv.innerHTML = escapeHtml(data.text);
        messageDiv.appendChild(contentDiv);

        // Check if message author is leader
        const messageAuthorIsLeader = data.username === currentLeaderUsername;
        const canDeleteForEveryone = isMe || isLeader;

        // Remove hover actions menu - only context menu on right-click

        // Context menu for right-click on message bubble
        messageDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMessageContextMenu(e.clientX, e.clientY, data.text, data.username);
        });
        
        // Long-press support for mobile (0.5s hold)
        let longPressTimer;
        messageDiv.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => {
                e.preventDefault();
                const touch = e.touches[0] || e.changedTouches[0];
                showMessageContextMenu(touch.clientX, touch.clientY, data.text, data.username);
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
    if (window.innerWidth <= 768 && isMafiaRoom) {
        if (mobileRoleBadge && myRole) {
            mobileRoleBadge.style.display = 'block';
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
