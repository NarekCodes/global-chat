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

    } else if (data.isPrivate) {
        // DM Logic
        messageDiv.classList.add('private-message');
        const isMe = data.sender === username;
        messageDiv.classList.add(isMe ? 'self' : 'other');

        messageDiv.style.border = '2px solid #ff9800'; // Simple visual cue

        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('username');
        if (isMe) {
            usernameSpan.textContent = `[DM to ${data.recipient}]`;
        } else {
            usernameSpan.textContent = `[DM from ${data.sender}]`;
        }

        const contentSpan = document.createElement('span');
        contentSpan.innerHTML = applyFormatting(data.text);

        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(document.createTextNode(' ')); // Space
        messageDiv.appendChild(contentSpan);
    } else {
        // Standard Chat
        const isMe = data.username === username;
        messageDiv.classList.add(isMe ? 'self' : 'other');

        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('username');
        usernameSpan.textContent = data.username;

        const contentSpan = document.createElement('span');
        contentSpan.innerHTML = applyFormatting(data.text);

        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(document.createTextNode(' ')); // Space
        messageDiv.appendChild(contentSpan);
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
        socket.emit('send_message', { text: '/delete ' + selectedMessageId });
    }
    contextMenu.style.display = 'none';
});


// Load history
socket.on('load_history', (history) => {
    messagesArea.innerHTML = ''; // clear current
    history.forEach((msg) => {
        renderMessage(msg);
    });
});

// Receive new message
socket.on('new_message', (msg) => {
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
            // Send Public
            socket.emit('send_message', { text });
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


// Emoji Picker Logic
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');

emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent document click from closing it immediately
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
});

// Close picker on outside click (handled by document listener below, but update it)
document.addEventListener('click', (e) => {
    contextMenu.style.display = 'none';

    // Also close emoji picker if click is not on the picker or the button
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.style.display = 'none';
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
        emojiPicker.style.display = 'none';
    });
});

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});
