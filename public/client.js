const socket = io();

const loginScreen = document.getElementById('login-screen');
// Note: ID changed in HTML from chat-screen to main-interface to include sidebar
const mainInterface = document.getElementById('main-interface');
const usernameInput = document.getElementById('username-input');
const joinButton = document.getElementById('join-button');

const messagesArea = document.getElementById('messages-area');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

const userList = document.getElementById('user-list');

let username = '';

// Login logic
joinButton.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        username = name;
        socket.emit('set username', username);
        loginScreen.style.display = 'none';
        if (mainInterface) {
            mainInterface.style.display = 'flex'; // Use flex for side-by-side
        }
    }
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
    if (currentRecipient) {
        recipientIndicator.style.display = 'block';
        recipientIndicator.innerHTML = `<strong>DM To: ${currentRecipient.username}</strong> <span style="font-size:0.8em; margin-left:10px">(Click to clear)</span>`;
        messageInput.placeholder = `Message ${currentRecipient.username}...`;
    } else {
        recipientIndicator.style.display = 'none';
        messageInput.placeholder = 'Type a message...';
    }
}

const contextMenu = document.getElementById('context-menu');
const deleteMeBtn = document.getElementById('delete-me');
const deleteAllBtn = document.getElementById('delete-all');

let currentLeaderId = null; // Track leader globally
let selectedMessageId = null; // Track which message was clicked

// Hide menu on click elsewhere
// Hide menu on click elsewhere
// document.addEventListener('click', () => {
//     contextMenu.style.display = 'none';
// });
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
        '<a href="$1" target="_blank"><img src="$1" class="chat-image" alt="Image"></a>'
    );

    // Bold: **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    // Italics: *text*
    formatted = formatted.replace(/\*(.*?)\*/g, '<i>$1</i>');
    return formatted;
}

// Helper to render a message
function renderMessage(data, isSelf = false) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    // Store message ID
    if (data.id) {
        messageDiv.dataset.id = data.id;

        // Custom Context menu
        messageDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            selectedMessageId = data.id;

            // Position menu
            contextMenu.style.display = 'block';
            contextMenu.style.left = `${e.clientX}px`;
            contextMenu.style.top = `${e.clientY}px`;

            // Logic for "Delete for Everyone"
            const isMyMessage = data.username === username;
            const isLeader = socket.id === currentLeaderId;

            if (isLeader || isMyMessage) {
                deleteAllBtn.style.display = 'block';
            } else {
                deleteAllBtn.style.display = 'none';
            }

            // "Delete for Me" is always available
            deleteMeBtn.style.display = 'block';
        });
    }

    // Check if it is a system message
    if (data.username === 'SYSTEM') {
        messageDiv.classList.add('system');

        // Wrap content in a container to allow close button
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.justifyContent = 'space-between';
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

    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
}

// Menu Actions
deleteMeBtn.addEventListener('click', () => {
    if (selectedMessageId) {
        const el = document.querySelector(`.message[data-id="${selectedMessageId}"]`);
        if (el) el.remove();
    }
    contextMenu.style.display = 'none';
});

deleteAllBtn.addEventListener('click', () => {
    if (selectedMessageId) {
        socket.emit('chat message', { text: '/delete ' + selectedMessageId, room: currentRoom });
    }
    contextMenu.style.display = 'none';
});


// Load history (Force Restoration Logic)
socket.on('loadHistory', (history) => {
    messagesArea.innerHTML = ''; // Clear chat window logic as per prompt
    history.forEach((msg) => {
        renderMessage(msg); // Calls existing display function
    });
});

// Receive new message
socket.on('chat message', (msg) => {
    renderMessage(msg);
});

// Receive message delete event
socket.on('delete message', (id) => {
    const el = document.querySelector(`.message[data-id="${id}"]`);
    if (el) {
        // Optional: Animate out? 
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300); // Simple fade out effect if combined with CSS transition
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
        // user is object {id, username}
        const li = document.createElement('li');
        li.textContent = user.username;

        // Check for Leader
        if (leaderId && user.id === leaderId) {
            li.classList.add('leader');
            li.textContent += " (Leader)";
        }

        if (user.username === username) {
            li.textContent += " (You)";
            li.style.fontStyle = 'italic';
            li.style.color = '#888';
        } else {
            li.style.cursor = 'pointer';
            li.title = `Click to DM ${user.username}`;
            li.addEventListener('click', () => {
                currentRecipient = user;
                updateRecipientUI();
                // Focus input
                messageInput.focus();
            });
        }
        userList.appendChild(li);
    });
});

// Send message
function sendMessage() {
    const text = messageInput.value.trim();
    if (text) {
        if (currentRecipient) {
            // Send Private
            socket.emit('private message', {
                to: currentRecipient.id,
                toUsername: currentRecipient.username,
                text: text
            });
        } else {
            // Send with room context to prevent global leaks
            socket.emit('chat message', {
                text: text,
                room: currentRoom,
                sender: username
            });
        }
        messageInput.value = '';
        messageInput.focus();
    }
}

const typingIndicator = document.getElementById('typing-indicator');

let typingTimeout;
const TYPING_TIMER_LENGTH = 2000; // 2 seconds

// Emit typing event on keypress
messageInput.addEventListener('keypress', () => {
    socket.emit('typing');
});

// Handle typing event from other users
// We need to support multiple people typing: "Alice, Bob is typing..."
let typingUsers = new Set();

socket.on('typing', (data) => {
    // data is username
    const userTyping = data;

    if (userTyping) {
        typingUsers.add(userTyping);
        updateTypingIndicator();

        // Clear previous timeout for this update cycle? 
        // Actually, we want to remove THIS user after 2 seconds if they stop typing.
        // But the prompt says "timeouts" (plural) or just "a setTimeout".
        // A simple way is to clear global timeout and restart it, but that assumes one timer.
        // If multiple people type, we might want individual timers or just a global "someone is typing" refresh.
        // For simplicity and matching typical requirements:
        // Reset the unique timer for removing THAT user? No, usually it's "activity based".
        // Let's keep it simple: if ANY typing event comes in, refresh the display and timer.
        // But ideally we want to remove the specific user who stopped.
        // PROMPT Says: "Use a JavaScript setTimeout... If no further typing event is received FROM THAT USER..."

        // Complex approach: Map of username -> timeoutId.
        // Simple approach (per requirement "User A, User B is typing..."):
        // We will use a Map to track timeouts for each user.
    }
});

// Helper to manage typing users and timeouts
const typingTimeouts = {};

socket.on('typing', (username) => {
    if (!username) return;

    typingUsers.add(username);
    updateTypingIndicator();

    // Clear existing timeout for this user if any
    if (typingTimeouts[username]) {
        clearTimeout(typingTimeouts[username]);
    }

    // Set new timeout to remove this user
    typingTimeouts[username] = setTimeout(() => {
        typingUsers.delete(username);
        updateTypingIndicator();
        delete typingTimeouts[username];
    }, TYPING_TIMER_LENGTH);
});

function updateTypingIndicator() {
    if (typingUsers.size === 0) {
        typingIndicator.textContent = '';
        typingIndicator.style.display = 'none'; // Optional, but keeps layout clean
    } else {
        const users = Array.from(typingUsers).join(', ');
        typingIndicator.textContent = `${users} ${typingUsers.size === 1 ? 'is' : 'are'} typing...`;
        typingIndicator.style.display = 'block';
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

// Room Switching Logic
let currentRoom = 'global';
let partnerNames = {}; // roomID -> partnerName

function setActiveRoom(roomID) {
    // Highlighting logic
    const allButtons = document.querySelectorAll('.room-btn');
    allButtons.forEach(btn => btn.classList.remove('active-room', 'active'));

    // Find the button for this room
    let targetId = roomID;
    if (roomID === 'global') targetId = 'room-global';
    else if (roomID.startsWith('report-')) targetId = 'room-report';
    else if (roomID.startsWith('match_')) targetId = 'room-match';

    const targetBtn = document.getElementById(targetId);
    if (targetBtn) {
        targetBtn.classList.add('active-room');
        // Backward compatibility if some styles use .active
        targetBtn.classList.add('active');
    }
}

const roomNameDisplay = document.getElementById('room-name-display');
const roomGlobalBtn = document.getElementById('room-global');
const roomReportBtn = document.getElementById('room-report');

function joinRoom(room) {
    currentRoom = room;

    // UI Feedback
    setActiveRoom(room);

    // Trigger Server Switch
    socket.emit('switchRoom', room);
    socket.emit('getHistory', room);

    // Reliable History Loading: Clear window
    messagesArea.innerHTML = '';

    if (room === 'global') {
        roomNameDisplay.textContent = 'Global Chat Room';
    } else if (room.startsWith('report-')) {
        roomNameDisplay.textContent = 'Bug Report (Private)';
    } else if (room.startsWith('match_')) {
        const name = partnerNames[room] || 'Private Match';
        roomNameDisplay.textContent = `Chat with ${name}`;
    }
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
