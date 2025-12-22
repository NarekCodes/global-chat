const socket = io();

const loginScreen = document.getElementById('login-screen');
// Note: ID changed in HTML from chat-screen to main-interface to include sidebar
const mainInterface = document.getElementById('main-interface');
const usernameInput = document.getElementById('username-input');
const avatarInput = document.getElementById('avatar-input');
const joinButton = document.getElementById('join-button');

const messagesArea = document.getElementById('messages-area');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

const userList = document.getElementById('user-list');

// Error Modal Elements
const errorModal = document.getElementById('error-modal');
const errorMessageText = document.getElementById('error-message-text');
const closeErrorBtn = document.getElementById('close-error-btn');

const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');

let currentLeaderId = null;
let username = '';
let currentRoom = 'global';
let typingUsers = new Set();
let typingTimeout;
let isTyping = false;
let partnerNames = {}; // roomID -> partnerName
let unreadCounts = {}; // roomID -> count
let mutedUsersList = []; // Array of usernames

let selectedMessageId = null;

// Notification Sound (High-end "pop")
const notificationSound = new Audio('https://raw.githubusercontent.com/rafaelreis-hotmart/Audio-Samples/master/notification.mp3');
notificationSound.volume = 0.5;

const getFallbackAvatar = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;

function validateAvatar(url, callback) {
    if (!url) return callback(true, getFallbackAvatar(usernameInput.value.trim()));

    // Regex Check
    const imageRegex = /\.(jpg|jpeg|png|webp|gif|svg)$/i;
    if (!imageRegex.test(url)) {
        return callback(false);
    }

    // Load Test
    const img = new Image();
    img.onload = () => callback(true, url);
    img.onerror = () => callback(false);
    img.src = url;
}

// Login logic
joinButton.addEventListener('click', () => {
    let name = usernameInput.value.trim();
    const avatarUrl = avatarInput.value.trim();

    if (!name) return;

    // Check 1: Username (Strictly NO spaces)
    if (name.includes(' ')) {
        showError('Invalid Username', 'Usernames cannot contain spaces. Please use underscores instead.');
        return;
    }

    // Check 2: Empty URL (allow fallback)
    if (!avatarUrl) {
        username = name;
        socket.emit('set username', { username, avatarUrl: getFallbackAvatar(name) });
        loginScreen.style.display = 'none';
        if (mainInterface) mainInterface.style.display = 'flex';
        return;
    }

    // Check 3: URL Regex Format
    const imageRegex = /\.(jpg|jpeg|png|webp|gif|svg)$/i;
    if (!imageRegex.test(avatarUrl)) {
        showError('Invalid URL', 'Please provide a direct link to an image file (e.g., .jpg, .png, .webp).');
        return;
    }

    // Check 4: URL Accessibility (Silent Load Test)
    const img = new Image();
    img.onload = () => {
        username = name;
        socket.emit('set username', { username, avatarUrl: avatarUrl });
        loginScreen.style.display = 'none';
        if (mainInterface) mainInterface.style.display = 'flex';
    };
    img.onerror = () => {
        showError('Image Not Found', 'This link is not working or is not a public image.');
    };
    img.src = avatarUrl;
});

// Handle Login Errors from Server
socket.on('loginError', ({ title, message }) => {
    showError(title, message);
});

// Also allow Enter key on login input
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinButton.click();
    }
});


// DM State
let currentRecipient = null; // { id, username }

const recipientIndicator = document.createElement('div');
recipientIndicator.id = 'recipient-indicator';
recipientIndicator.style.display = 'none';
recipientIndicator.style.backgroundColor = '#e0f7fa';
recipientIndicator.style.padding = '10px';
recipientIndicator.style.marginBottom = '10px';
recipientIndicator.style.borderRadius = '8px';
recipientIndicator.style.color = '#006064';
recipientIndicator.style.fontSize = '0.9rem';
recipientIndicator.style.cursor = 'pointer';
// Insert before input area
document.querySelector('.input-area').insertAdjacentElement('beforebegin', recipientIndicator);

recipientIndicator.addEventListener('click', () => {
    // Clear recipient on click
    currentRecipient = null;
    updateRecipientUI();
});

function updateRecipientUI() {
    // This legacy function for old DM system is now simplified 
    // since we use persistent rooms.
    if (currentRecipient) {
        recipientIndicator.style.display = 'block';
        recipientIndicator.innerHTML = `<strong>Quick DM To: ${currentRecipient.username}</strong> <span style="font-size:0.8em; margin-left:10px">(Click to clear)</span>`;
    } else {
        recipientIndicator.style.display = 'none';
    }
}

const contextMenu = document.getElementById('context-menu');
const contextReply = document.getElementById('ctx-reply');
const contextCopy = document.getElementById('ctx-copy');
const contextReport = document.getElementById('ctx-report');
const adminActions = document.getElementById('admin-actions');
const contextKick = document.getElementById('ctx-kick');
const contextBan = document.getElementById('ctx-ban');

const replyPreview = document.getElementById('reply-preview');
const replyTextDisplay = document.getElementById('reply-text');
const cancelReplyBtn = document.getElementById('cancel-reply');

// New Delete Buttons
const contextDeleteMe = document.getElementById('ctx-delete-me');
const contextDeleteAll = document.getElementById('ctx-delete-all');
const muteOption = document.getElementById('mute-option');

const MUTE_ICON = `<svg class="ctx-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
const UNMUTE_ICON = `<svg class="ctx-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;

let selectedContextData = null; // Store data for current context menu
let replyTargetData = null; // Store data for what we are replying to

function showContextMenu(x, y, data) {
    selectedContextData = data;
    selectedMessageId = data.id; // Store message ID for deletion

    // Admin Filter
    adminActions.style.display = data.isAdmin ? 'block' : 'none';

    // User vs Message context adjustment
    if (data.type === 'user') {
        contextReply.style.display = 'none';
        contextCopy.style.display = 'none';
        contextDeleteMe.style.display = 'none';
        contextDeleteAll.style.display = 'none';
    } else {
        contextReply.style.display = 'block';
        contextCopy.style.display = 'block';

        // Ownership / Permission Logic for Deletion
        const isMyMessage = data.user === username;
        contextDeleteMe.style.display = 'block'; // Always allow local delete for any message
        contextDeleteAll.style.display = (isMyMessage || data.isAdmin) ? 'block' : 'none';

        // Mute/Unmute Toggle logic
        if (data.isAdmin) {
            const targetUsername = data.user;
            const isMuted = mutedUsersList.includes(targetUsername);
            if (isMuted) {
                muteOption.innerHTML = `${UNMUTE_ICON} Unmute User`;
                muteOption.style.color = '#4ade80'; // Sleek green
                muteOption.onclick = (e) => {
                    e.stopPropagation();
                    unmuteUser(targetUsername);
                };
            } else {
                muteOption.innerHTML = `${MUTE_ICON} Mute User`;
                muteOption.style.color = '#f87171'; // Sleek red
                muteOption.onclick = (e) => {
                    e.stopPropagation();
                    muteUser(targetUsername);
                };
            }
        }
    }

    contextMenu.style.display = 'block';
    contextMenu.style.opacity = '0';
    contextMenu.style.transform = 'scale(0.95)';

    // Force Reflow
    void contextMenu.offsetWidth;

    // Edge Detection Logic
    const menuWidth = contextMenu.offsetWidth || 170;
    const menuHeight = contextMenu.offsetHeight || 200;
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    let finalX = x;
    let finalY = y;

    if (x + menuWidth > screenWidth) {
        finalX = x - menuWidth;
    }
    if (y + menuHeight > screenHeight) {
        finalY = y - menuHeight;
    }

    contextMenu.style.left = `${finalX}px`;
    contextMenu.style.top = `${finalY}px`;
    contextMenu.style.opacity = '1';
    contextMenu.style.transform = 'scale(1)';
}

function hideContextMenu() {
    contextMenu.style.display = 'none';
    selectedContextData = null;
}

// Global listeners for dismissal
document.addEventListener('click', () => hideContextMenu());
document.addEventListener('contextmenu', (e) => {
    // Hide menu if clicking outside of a message or user (where we didn't preventDefault)
    if (!e.defaultPrevented) hideContextMenu();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        hideContextMenu();
        cancelReply();
    }
});

// Functional Integration
contextReply.addEventListener('click', () => {
    if (!selectedContextData) return;
    replyTargetData = selectedContextData;
    replyTextDisplay.textContent = `Replying to ${selectedContextData.user}: "${selectedContextData.text.substring(0, 30)}${selectedContextData.text.length > 30 ? '...' : ''}"`;
    replyPreview.style.display = 'flex';
    messageInput.focus();
});

contextCopy.addEventListener('click', () => {
    if (!selectedContextData || !selectedContextData.text) return;
    navigator.clipboard.writeText(selectedContextData.text)
        .then(() => console.log('Copied to clipboard'))
        .catch(err => console.error('Copy failed', err));
});

function cancelReply() {
    replyPreview.style.display = 'none';
    replyTargetData = null;
}

cancelReplyBtn.addEventListener('click', cancelReply);

// Admin Action Redirection
contextKick.addEventListener('click', () => {
    if (selectedContextData) socket.emit('chat message', { text: `/kick ${selectedContextData.user}`, room: 'global' });
});
contextBan.addEventListener('click', () => {
    if (selectedContextData) socket.emit('chat message', { text: `/ban ${selectedContextData.user}`, room: 'global' });
});

// Delete Logic Implementation
contextDeleteMe.addEventListener('click', () => {
    if (selectedMessageId) {
        // Find by ID and remove
        const msgEl = document.getElementById(`msg-${selectedMessageId}`);
        if (msgEl) {
            msgEl.style.opacity = '0';
            msgEl.style.transform = 'translateX(20px)';
            setTimeout(() => msgEl.remove(), 200);
        }
    }
    hideContextMenu();
});

contextDeleteAll.addEventListener('click', () => {
    if (selectedMessageId) {
        socket.emit('chat message', { text: `/delete ${selectedMessageId}`, room: currentRoom });
    }
    hideContextMenu();
});

function muteUser(targetUsername) {
    socket.emit('chat message', { text: `/mute ${targetUsername}`, room: 'global' });
    hideContextMenu();
    // Local Leader Feedback
    renderMessage({
        id: Date.now(),
        username: 'SYSTEM',
        text: `User ${targetUsername} has been muted.`,
        timestamp: new Date().toLocaleTimeString()
    });
}

function unmuteUser(targetUsername) {
    socket.emit('chat message', { text: `/unmute ${targetUsername}`, room: 'global' });
    hideContextMenu();
    // Local Leader Feedback
    renderMessage({
        id: Date.now(),
        username: 'SYSTEM',
        text: `User ${targetUsername} has been unmuted.`,
        timestamp: new Date().toLocaleTimeString()
    });
}

socket.on('mutedUsersUpdate', (list) => {
    mutedUsersList = list;
});
// MOVED TO BOTTOM to handle both menus

// Helper to escape HTML
function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Function to apply formatting
function applyFormatting(text) {
    let formatted = escapeHtml(text);

    // Image URL Detection and Rendering
    // Matches URLs ending in .jpg, .jpeg, .png, .gif, .webp
    // Use \b boundary to ensure extension is at the end of the URL
    // Wrap in <a> for click-to-expand (opens in new tab)
    formatted = formatted.replace(
        /(https?:\/\/\S+?\.(?:jpg|jpeg|png|gif|webp))\b/gi,
        (match) => `<a href="${match}" target="_blank"><img src="${match}" class="chat-image" alt="Image" onerror="this.src='https://ui-avatars.com/api/?name=Image&background=random'; this.onerror=null;"></a>`
    );

    // Bold: **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    // Italics: *text*
    formatted = formatted.replace(/\*(.*?)\*/g, '<i>$1</i>');

    // @Mention Highlighting
    formatted = formatted.replace(/@(\w+)/g, '<span class="mention-tag">@$1</span>');

    return formatted;
}

// Helper to render a message
function renderMessage(data, isSelf = false) {
    if (!data.id) data.id = Date.now() + Math.random().toString(36).substr(2, 9);

    // Unified Container
    const container = document.createElement('div');
    container.classList.add('message-container');
    container.id = `msg-${data.id}`;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    // Store message ID
    if (data.id) {
        messageDiv.dataset.id = data.id;

        // Custom Context menu (Glassmorphism)
        messageDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const isAdmin = socket.id === currentLeaderId;
            showContextMenu(e.clientX, e.clientY, {
                type: 'message',
                id: data.id, // Ensure ID is passed
                user: data.username,
                text: data.text,
                isAdmin: isAdmin
            });
        });
    }

    // Check if it is a system message
    if (data.username === 'SYSTEM') {
        messageDiv.classList.add('system');

        // Wrap content in a container to allow close button
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.justifyContent = 'center';
        container.style.alignItems = 'center';

        const textSpan = document.createElement('span');
        textSpan.innerHTML = applyFormatting(data.text); // Apply formatting to system messages too

        const closeBtn = document.createElement('span');
        closeBtn.textContent = '✕';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.marginLeft = '10px';
        closeBtn.style.fontWeight = 'bold';
        closeBtn.title = 'Dismiss';
        closeBtn.onclick = () => {
            messageDiv.remove();
        };

        container.appendChild(textSpan);
        container.appendChild(closeBtn);
        messageDiv.appendChild(container);

    } else {
        // Standard/Private Chat
        if (data.isPrivate) {
            messageDiv.classList.add('private-message');
            messageDiv.style.border = '2px solid #ff9800';
        }

        const isMe = data.username === username; // or data.sender for private
        messageDiv.classList.add(isMe ? 'self' : 'other');

        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('username');
        if (data.isPrivate) {
            const isSender = data.sender === username;
            usernameSpan.textContent = isSender ? `[DM to ${data.recipient}]` : `[DM from ${data.sender}]`;
        } else {
            usernameSpan.textContent = data.username;
        }

        messageDiv.appendChild(usernameSpan);

        // Reply Context Rendering
        if (data.replyTo) {
            const replyCtxDiv = document.createElement('div');
            replyCtxDiv.classList.add('message-reply-ctx');
            replyCtxDiv.innerHTML = `<strong>${data.replyTo.user}</strong>: ${data.replyTo.text.substring(0, 50)}${data.replyTo.text.length > 50 ? '...' : ''}`;
            messageDiv.appendChild(replyCtxDiv);
        }

        const contentSpan = document.createElement('div'); // div for media flexibility

        let messageText = data.text;
        let isMedia = false;

        // Check for prefixes
        if (messageText.startsWith('[URL]:')) {
            messageText = messageText.substring(6);
            isMedia = true;
        } else if (messageText.startsWith('[FILE]:')) {
            messageText = messageText.substring(7);
            isMedia = true;
        } else if (messageText.startsWith('data:image/') || messageText.startsWith('data:video/')) {
            // Backward compatibility for old messages or direct pastes if any
            isMedia = true;
        }

        // Helper to check extensions
        const lowerText = messageText.toLowerCase();
        const isImage = lowerText.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/) || lowerText.startsWith('data:image/');
        const isVideo = lowerText.match(/\.(mp4|webm|ogg)($|\?)/) || lowerText.startsWith('data:video/');

        if (isMedia && isImage) {
            const img = document.createElement('img');
            img.src = messageText;
            img.classList.add('chat-image');
            img.alt = 'Image';
            img.onerror = function () {
                this.onerror = null;
                this.src = 'https://ui-avatars.com/api/?name=Image&background=random';
            };

            // Wrap in link for consistency/zoom
            const link = document.createElement('a');
            link.href = messageText;
            link.target = '_blank';
            link.appendChild(img);
            contentSpan.appendChild(link);
        } else if (isMedia && isVideo) {
            const video = document.createElement('video');
            video.src = messageText;
            video.controls = true;
            video.classList.add('chat-media-video'); // Class for styling
            contentSpan.appendChild(video);
        } else {
            // Treat as text if not identified as media despite prefix, or standard text
            // If it had a prefix but wasn't recognized media, we still show the URL/Data? 
            // Better to show the link if it was [URL]
            if (messageText.startsWith('http')) {
                contentSpan.innerHTML = `<a href="${applyFormatting(messageText)}" target="_blank">${applyFormatting(messageText)}</a>`;
            } else {
                contentSpan.innerHTML = applyFormatting(messageText);
            }
        }

        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(contentSpan); // Check spacing
    }

    // Wrap in flex container for avatar
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');
    if (data.username === username) wrapper.classList.add('self');

    if (data.username !== 'SYSTEM') {
        const avatarContainer = document.createElement('div');
        avatarContainer.classList.add('avatar-container');

        const avatarImg = document.createElement('img');
        const fallback = getFallbackAvatar(data.username);
        avatarImg.src = data.avatarUrl || fallback;
        avatarImg.classList.add('avatar-img');
        // Smart Fallback Runtime Guard
        avatarImg.onerror = function () {
            this.onerror = null; // Prevent infinite loops
            this.src = fallback;
        };

        // Leader standout styling
        if (data.username !== 'SYSTEM' && currentLeaderId && data.id === currentLeaderId) {
            // Wait, data.id here is message id. We need user id.
            // In renderMessage, we don't always have user id.
            // But we have currentLeaderId which is a socket id.
            // This is tricky because filenames/usernames are what we usually have.
            // Let's check if the server sends user id or if we can match by username.
        }
        // Actually, let's use a simpler check if we have the info.
        // For now, let's just render the avatar.

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
    window.scrollTo(0, document.body.scrollHeight);
}


// Load history (Force Restoration Logic)
socket.on('loadHistory', (history) => {
    messagesArea.innerHTML = ''; // Clear chat window logic as per prompt
    history.forEach((msg) => {
        renderMessage(msg); // Calls existing display function
    });
});

// Receive new message
socket.on('chat message', (msg) => {
    // ... (rest of the content)
    const isPrivate = msg.room && msg.room.startsWith('private_');

    // If message is for a different room, handle notification/auto-switch
    if (msg.room && msg.room !== currentRoom) {
        // ... (rest of the logic)
        unreadCounts[msg.room] = (unreadCounts[msg.room] || 0) + 1;

        if (isPrivate) {
            const parts = msg.room.split('_');
            const otherUser = parts[1] === username ? parts[2] : parts[1];
            addPrivateRoomButton(msg.room, otherUser);

            const inGenericRoom = currentRoom === 'global' || currentRoom.startsWith('report-');
            if (inGenericRoom) {
                joinRoom(msg.room);
            }
        }

        notificationSound.play().catch(err => console.log('Audio play blocked:', err));
        updateSidebarNotifications(msg.room);

        const btn = document.querySelector(`.room-btn[data-room="${msg.room}"]`);
        if (btn) {
            btn.classList.remove('pulse-notice');
            void btn.offsetWidth;
            btn.classList.add('pulse-notice');
            setTimeout(() => btn.classList.remove('pulse-notice'), 2000);
        }

        return;
    }
    renderMessage(msg);
});

// @Mention Notification Logic
socket.on('userMentioned', (data) => {
    notificationSound.play().catch(err => console.log('Audio play blocked:', err));

    const globalBtn = document.getElementById('room-global');
    if (globalBtn) {
        globalBtn.classList.remove('mention-glow');
        void globalBtn.offsetWidth; // Trigger reflow
        globalBtn.classList.add('mention-glow');
        setTimeout(() => globalBtn.classList.remove('mention-glow'), 1500);
    }
});

function updateSidebarNotifications(roomID) {
    if (!roomID) return; // Null safety
    const count = unreadCounts[roomID] || 0;

    // Find the button (static or dynamic)
    let btn = null;
    if (roomID === 'global') btn = document.getElementById('room-global');
    else if (roomID.startsWith('report-')) btn = document.getElementById('room-report');
    else btn = document.querySelector(`.room-btn[data-room="${roomID}"]`);

    if (btn) {
        let badge = btn.querySelector('.notification-dot');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'notification-dot';
                btn.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : count;
        } else if (badge) {
            badge.remove();
        }
    }
}

// Receive message delete event
socket.on('delete message', (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200); // 200ms matches CSS transition
    }
});

// Receive private message
socket.on('private message', (msg) => {
    renderMessage(msg);
});

// Receive system message (command list)
socket.on('system message', (data) => {
    // data: { title: string, commands: string[] }
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', 'system');
    messageDiv.style.textAlign = 'left'; // Reset alignment
    messageDiv.style.backgroundColor = '#f0f0f0';
    messageDiv.style.border = '1px solid #ddd';
    messageDiv.style.borderRadius = '8px';
    messageDiv.style.padding = '10px';
    messageDiv.style.maxWidth = '100%';

    const title = document.createElement('div');
    title.textContent = data.title;
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '5px';
    title.style.color = '#333';
    messageDiv.appendChild(title);

    const list = document.createElement('ul');
    list.style.listStyle = 'none';
    list.style.padding = '0';
    list.style.margin = '0';

    data.commands.forEach(cmd => {
        const item = document.createElement('li');
        item.textContent = cmd;
        item.style.fontFamily = 'monospace';
        item.style.padding = '2px 0';
        list.appendChild(item);
    });

    messageDiv.appendChild(list);
    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
});

// Handle online users list
socket.on('online users', (data) => {
    // data might be array (old) or object (new {users, leaderId})
    // Good to support both to avoid immediate break if client loads before server reload fully propagates? 
    // But we control both.

    let users = [];
    let leaderId = null;

    if (Array.isArray(data)) {
        users = data;
    } else {
        users = data.users;
        leaderId = data.leaderId;
    }

    // Update global state
    currentLeaderId = leaderId;

    userList.innerHTML = '';
    users.forEach(user => {
        // user is object {id, username, avatarUrl}
        const li = document.createElement('li');

        const avatarImg = document.createElement('img');
        const fallback = getFallbackAvatar(user.username);
        avatarImg.src = user.avatarUrl || fallback;
        avatarImg.classList.add('user-list-avatar');
        avatarImg.onerror = function () {
            this.onerror = null;
            this.src = fallback;
        };
        if (leaderId && user.id === leaderId) {
            avatarImg.classList.add('leader-avatar');
        }
        li.appendChild(avatarImg);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = user.username;
        li.appendChild(nameSpan);

        // Check for Leader
        if (leaderId && user.id === leaderId) {
            li.classList.add('leader');
            nameSpan.textContent += " (Leader)";
        }

        if (user.username === username) {
            nameSpan.textContent += " (You)";
            li.style.fontStyle = 'italic';
            li.style.color = '#888';

            const dmIcon = document.createElement('span');
            dmIcon.className = 'dm-icon-hidden';
            li.appendChild(dmIcon);

        } else {
            li.style.cursor = 'pointer';
            li.title = `Click to DM ${user.username}`;

            // Add Message Button (Telegram Style)
            const msgBtn = document.createElement('button');
            msgBtn.innerHTML = '💬';
            msgBtn.className = 'msg-btn';
            msgBtn.title = 'Message';

            msgBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Avoid triggering li click
                openPrivateChat(user.username, user.avatarUrl || fallback);
            });

            li.appendChild(msgBtn);

            li.addEventListener('click', () => {
                openPrivateChat(user.username, user.avatarUrl || fallback);
            });

            // User Context Menu
            li.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const isAdmin = socket.id === currentLeaderId;
                showContextMenu(e.clientX, e.clientY, {
                    type: 'user',
                    user: user.username,
                    isAdmin: isAdmin
                });
            });
        }
        userList.appendChild(li);
    });
});

let activePrivateRooms = new Set();

function getPrivateRoomId(u1, u2) {
    return 'private_' + [u1, u2].sort().join('_');
}

function openPrivateChat(targetUser, targetAvatar) {
    const roomID = getPrivateRoomId(username, targetUser);

    // UI Swap: Ensure sidebar button exists
    if (!activePrivateRooms.has(roomID)) {
        addPrivateRoomButton(roomID, targetUser);
    }

    // Instant Switch
    joinRoom(roomID);

    // Explicit History Request (Telegram Speed)
    socket.emit('requestPrivateHistory', roomID);
}

// Receiver-Side Auto-Spawn
socket.on('incomingPrivateChat', (data) => {
    // If receiver is in Global, force-switch instantly
    if (currentRoom === 'global') {
        openPrivateChat(data.from, data.avatar);
    } else {
        // If busy in another DM, just show notification
        unreadCounts[data.roomID] = (unreadCounts[data.roomID] || 0) + 1;
        updateSidebarNotifications(data.roomID);

        // Ensure sidebar button exists for the notification
        if (!activePrivateRooms.has(data.roomID)) {
            addPrivateRoomButton(data.roomID, data.from);
        }
    }
});

function addPrivateRoomButton(roomID, targetUser) {
    const sidebar = document.getElementById('sidebar');
    let btn = document.querySelector(`.room-btn[data-room="${roomID}"]`);

    if (btn) {
        // Prioritization: Move existing button to the top of private section
        // Insert after roomReportBtn
        if (roomReportBtn && roomReportBtn.nextSibling !== btn) {
            roomReportBtn.parentNode.insertBefore(btn, roomReportBtn.nextSibling);
        }
    } else {
        activePrivateRooms.add(roomID);

        btn = document.createElement('button');
        btn.className = 'room-btn';
        btn.dataset.room = roomID;
        btn.innerHTML = `👤 ${targetUser}`;
        btn.addEventListener('click', () => {
            joinRoom(roomID);
        });

        // Insert after Report button (top of private list)
        if (roomReportBtn && roomReportBtn.parentNode) {
            roomReportBtn.parentNode.insertBefore(btn, roomReportBtn.nextSibling);
        } else {
            sidebar.appendChild(btn);
        }
    }

    // Pulse effect for new/re-activated button
    btn.classList.add('pulse-notice');
    setTimeout(() => btn.classList.remove('pulse-notice'), 2000);

    // If there were already unread messages for this room, update UI
    if (unreadCounts[roomID]) {
        updateSidebarNotifications(roomID);
    }
}

// Send message
function sendMessage() {
    const text = messageInput.value.trim();
    if (text) {
        const messageData = {
            text: text,
            room: currentRoom,
            sender: username
        };

        if (replyTargetData) {
            messageData.replyTo = {
                user: replyTargetData.user,
                text: replyTargetData.text
            };
        }

        socket.emit('chat message', messageData);

        messageInput.value = '';
        messageInput.focus();
        cancelReply();
    }
}

// Consolidated typing variables used below

// Typing detection logic
messageInput.addEventListener('input', () => {
    if (!isTyping && username) {
        isTyping = true;
        socket.emit('typing', { room: currentRoom });
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        socket.emit('stopTyping', { room: currentRoom });
    }, 2000);
});

// Typing events from socket
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
        let text = '';
        if (users.length === 1) {
            text = `${users[0]} is typing...`;
        } else if (users.length === 2) {
            text = `${users[0]} and ${users[1]} are typing...`;
        } else {
            text = 'Multiple people are typing...';
        }
        typingText.textContent = text;
        typingIndicator.classList.add('visible');
    }
}


// Media Menu Logic
const actionBtn = document.getElementById('action-btn');
const floatingMenu = document.getElementById('floating-menu');
const menuEmoji = document.getElementById('menu-emoji');
const menuUrl = document.getElementById('menu-url');
const menuUpload = document.getElementById('menu-upload');
const emojiPicker = document.getElementById('emoji-picker');

const imageModal = document.getElementById('image-modal');
const imageUrlInput = document.getElementById('image-url-input');
const cancelImageBtn = document.getElementById('cancel-image-btn');
const sendImageBtn = document.getElementById('send-image-btn');

// Toggle Floating Menu
actionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = floatingMenu.style.display === 'flex';
    floatingMenu.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) {
        emojiPicker.style.display = 'none'; // Close emoji picker if opening menu
    }
});

// Emoji Menu Item
menuEmoji.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingMenu.style.display = 'none';
    emojiPicker.style.display = 'grid'; // Use grid as per CSS
});

// URL Menu Item
menuUrl.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingMenu.style.display = 'none';
    imageModal.style.display = 'flex';
    imageUrlInput.focus();
});

// Upload Menu Item
menuUpload.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingMenu.style.display = 'none';
    fileInput.click();
});

// Close menus on outside click
document.addEventListener('click', (e) => {
    // Close context menu (existing)
    contextMenu.style.display = 'none';

    // Close floating menu
    if (!floatingMenu.contains(e.target) && e.target !== actionBtn) {
        floatingMenu.style.display = 'none';
    }

    // Close emoji picker
    if (!emojiPicker.contains(e.target) && !menuEmoji.contains(e.target)) {
        emojiPicker.style.display = 'none';
    }

    // Close Modal on background click
    if (e.target === imageModal) {
        imageModal.style.display = 'none';
    }
    if (e.target === errorModal) {
        const content = errorModal.querySelector('.error-modal-content');
        if (content) {
            content.classList.remove('shake');
            void content.offsetWidth; // Trigger reflow
            content.classList.add('shake');
        }
    }
});

function showError(title, message) {
    const heading = document.getElementById('error-heading');
    const text = document.getElementById('error-message-text');
    if (heading) heading.textContent = title;
    if (text) text.textContent = message;

    errorModal.style.display = 'flex';
    closeErrorBtn.focus();
}

function closeErrorModal() {
    errorModal.style.display = 'none';
}

closeErrorBtn.addEventListener('click', closeErrorModal);

// Keyboard Accessibility for Error Modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && errorModal.style.display === 'flex') {
        closeErrorModal();
        e.preventDefault(); // Prevent accidental form submission
    }
});

// Room buttons logic
document.querySelectorAll('.room-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const roomName = btn.dataset.room;
        // The instruction provided `switchRoom(roomName);`
        // However, the existing code uses `joinRoom`.
        // To maintain functionality and avoid introducing an undefined function,
        // `joinRoom` is used here, assuming `switchRoom` was a placeholder
        // or a future refactor not yet implemented.
        if (roomName === 'global') {
            joinRoom('global');
        } else if (roomName === 'report') { // Assuming 'report' is the dataset value for the report button
            if (!username) return;
            const reportRoom = `report-${username}`;
            joinRoom(reportRoom);
        } else if (roomName === 'match') { // Assuming 'match' is the dataset value for the match button
            // The match button is dynamically created and has its own listener,
            // so this generic handler might not be strictly necessary for it,
            // but it covers the case if a static 'match' button existed.
            // For the dynamically created match button, its listener already calls joinRoom.
            // This part might need adjustment based on specific HTML structure.
            // For now, we'll assume `roomName` from `dataset.room` would be the actual room ID for match.
            // If `matchButton` is present and active, its own listener takes precedence.
            if (matchButton && matchButton.style.display !== 'none') {
                // If the match button is visible, its own listener should handle it.
                // This generic handler might be for other static room buttons.
                // For now, we'll just call joinRoom with the roomName.
                joinRoom(roomName);
            }
        } else {
            joinRoom(roomName);
        }
    });
});

// Emoji Insertion
emojiPicker.querySelectorAll('span').forEach(span => {
    span.addEventListener('click', () => {
        const emoji = span.textContent;
        const cursorPosition = messageInput.selectionStart;
        const text = messageInput.value;
        const newText = text.slice(0, cursorPosition) + emoji + text.slice(cursorPosition);

        messageInput.value = newText;

        // Restore cursor position after emoji
        messageInput.selectionStart = cursorPosition + emoji.length;
        messageInput.selectionEnd = cursorPosition + emoji.length;

        messageInput.focus();
        // emojiPicker.style.display = 'none'; // Optional: keep open or close
    });
});


// Image/URL Modal Logic
cancelImageBtn.addEventListener('click', () => {
    imageModal.style.display = 'none';
    imageUrlInput.value = '';
});

sendImageBtn.addEventListener('click', () => {
    const url = imageUrlInput.value.trim();
    if (url) {
        // Send URL message with prefix
        socket.emit('chat message', { text: `[URL]:${url}`, room: currentRoom, sender: username });
        imageModal.style.display = 'none';
        imageUrlInput.value = '';
    }
});

// Allow Enter in Image Input
imageUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendImageBtn.click();
    }
});

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Room Switching Logic (variables consolidated at top)

function setActiveRoom(roomID) {
    // Highlighting logic
    const allButtons = document.querySelectorAll('.room-btn');
    allButtons.forEach(btn => btn.classList.remove('active-room', 'active'));

    // Find the button for this room
    let targetBtn = null;
    if (roomID === 'global') targetBtn = document.getElementById('room-global');
    else if (roomID.startsWith('report-')) targetBtn = document.getElementById('room-report');
    else if (roomID.startsWith('match_')) targetBtn = document.getElementById('room-match');
    else {
        // Find dynamic private button
        targetBtn = document.querySelector(`.room-btn[data-room="${roomID}"]`);
    }

    if (targetBtn) {
        targetBtn.classList.add('active-room');
        targetBtn.classList.add('active');
    }
}

const roomNameDisplay = document.getElementById('room-name-display');
const roomGlobalBtn = document.getElementById('room-global');
const roomReportBtn = document.getElementById('room-report');

function joinRoom(room) {
    if (!room) return; // Null safety
    currentRoom = room;

    // Reset unread count for this room
    unreadCounts[room] = 0;
    updateSidebarNotifications(room);

    // Dynamic Header Overhaul
    const header = document.getElementById('room-name-display');
    if (room.startsWith('private_')) {
        const parts = room.split('_');
        const otherUser = parts[1] === username ? parts[2] : parts[1];

        // Find user object from list for avatar (simple lookup)
        const userElements = Array.from(userList.querySelectorAll('li'));
        const userEl = userElements.find(el => {
            const span = el.querySelector('span');
            return span && span.textContent.includes(otherUser);
        });
        const avatarSrc = userEl ? userEl.querySelector('img').src : getFallbackAvatar(otherUser);

        header.innerHTML = `
            <div id="chat-header-context" style="display: flex; align-items: center; gap: 12px;">
                <img id="chat-header-img" src="${avatarSrc}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(106, 17, 203, 0.2);">
                <span id="chat-header-name" style="font-weight: 700; font-size: 1.1rem; color: #1a1a1a;">${otherUser}</span>
            </div>
        `;
    } else if (room === 'global') {
        header.textContent = '🌐 Global Chat';
    } else if (room.startsWith('report-')) {
        header.textContent = `🚨 Report: ${room.split('-')[1]}`;
    } else if (room.startsWith('match_')) {
        const name = partnerNames[room] || 'Private Match';
        header.textContent = `🤝 Match: ${name}`;
    } else {
        header.textContent = room;
    }

    // UI Feedback
    setActiveRoom(room);

    // Server Switch
    socket.emit('switchRoom', room);

    messagesArea.innerHTML = '';

    // Auto-focus input
    if (messageInput) messageInput.focus();
}

roomGlobalBtn.addEventListener('click', () => {
    if (currentRoom !== 'global') {
        joinRoom('global');
    }
});

roomReportBtn.addEventListener('click', () => {
    // Only if username is set
    if (!username) return;
    const reportRoom = `report-${username}`;
    if (currentRoom !== reportRoom) {
        joinRoom(reportRoom);
    }
});

// Matchmaking Logic
const sidebar = document.getElementById('sidebar'); // Ensure sidebar is selectable
let matchButton = null;

function toggleMatchButton(show, roomID, partnerName) {
    if (show) {
        if (partnerName) {
            partnerNames[roomID] = partnerName;
        }
        const displayName = partnerName ? `👥 Chat with ${partnerName}` : '👥 Private Match';

        if (!matchButton) {
            matchButton = document.createElement('button');
            matchButton.id = 'room-match';
            matchButton.className = 'room-btn';
            matchButton.innerHTML = displayName;
            matchButton.addEventListener('click', () => {
                if (currentRoom !== roomID) {
                    joinRoom(roomID);
                }
            });
            // Insert after Report button
            if (roomReportBtn && roomReportBtn.parentNode) {
                roomReportBtn.parentNode.insertBefore(matchButton, roomReportBtn.nextSibling);
            } else {
                sidebar.appendChild(matchButton);
            }
        } else {
            matchButton.innerHTML = displayName;
        }
        matchButton.style.display = 'block';
    } else {
        if (matchButton) {
            matchButton.style.display = 'none';
        }
    }
}

socket.on('matchStarted', (data) => {
    const { roomID, partnerName } = data;
    // Show button with name
    toggleMatchButton(true, roomID, partnerName);

    // Show professional modal instead of alert
    const matchModal = document.getElementById('match-modal');
    const matchPartnerName = document.getElementById('match-partner-name');
    const startMatchBtn = document.getElementById('start-match-btn');

    matchPartnerName.textContent = partnerName;
    matchModal.style.display = 'flex';

    startMatchBtn.onclick = () => {
        matchModal.style.display = 'none';
        joinRoom(roomID);
    };
});

socket.on('matchEnded', () => {
    // Hide button
    toggleMatchButton(false);

    // Auto-switch back to global if we were in the match
    if (currentRoom.startsWith('match_')) {
        joinRoom('global');
    }

    // Optional: Visual cue (Maybe use modal later, but for now just clear)
    // alert('Match Ended. Returning to Global Chat.');
});

// File Upload Logic
const fileInput = document.getElementById('file-input');

fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
        // Size Check (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
            alert('File is too large. Max size is 5MB.');
            fileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            // Send File message with prefix
            socket.emit('chat message', { text: `[FILE]:${dataUrl}`, room: currentRoom, sender: username });
            fileInput.value = '';
        };
        reader.readAsDataURL(file);
    }
});
