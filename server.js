const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory message storage
let messages = [];
const MAX_HISTORY_MESSAGES = 200;
let currentLeaderId = null;
const mutedUsers = new Set();

io.on('connection', (socket) => {
    console.log('A user connected');

    // Send existing history to the new client
    socket.emit('load_history', messages);

    // Helper to get online usernames and leader info
    const getOnlineUsernames = () => {
        const users = [];
        // Map<SocketId, Socket>
        for (let [id, socket] of io.of("/").sockets) {
            if (socket.username) {
                // Return object with id and username
                users.push({ id: id, username: socket.username });
            }
        }
        return { users, leaderId: currentLeaderId };
    };

    const getTargetSocketId = (targetUsername) => {
        for (let [id, s] of io.of("/").sockets) {
            if (s.username === targetUsername) {
                return id;
            }
        }
        return null;
    };

    // Handle setting username
    socket.on('set username', (username) => {
        socket.username = username;
        // Broadcast system message
        const systemMessage = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            username: 'SYSTEM',
            text: `${username} has joined the chat`,
            timestamp: new Date().toLocaleTimeString()
        };
        messages.push(systemMessage);
        io.emit('new_message', systemMessage);

        // Update online users list
        io.emit('online users', getOnlineUsernames());
    });

    // Handle new message
    socket.on('send_message', (data) => {
        // Use the stored username
        const username = socket.username || 'Anonymous';
        const text = data.text.trim();

        // Command Parsing
        if (text.startsWith('/')) {
            const parts = text.split(' ');
            const command = parts[0].toLowerCase();
            const targetArg = parts[1];

            if (command === '/getleader') {
                if (!currentLeaderId) {
                    currentLeaderId = socket.id;
                    const sysMsg = {
                        id: Date.now() + Math.random().toString(36).substr(2, 9),
                        username: 'SYSTEM',
                        text: `${username} is now the Leader!`,
                        timestamp: new Date().toLocaleTimeString()
                    };
                    messages.push(sysMsg);
                    io.emit('new_message', sysMsg);
                    io.emit('online users', getOnlineUsernames());
                } else {
                    socket.emit('new_message', {
                        id: Date.now() + Math.random().toString(36).substr(2, 9),
                        username: 'SYSTEM',
                        text: 'There is already a leader.',
                        timestamp: new Date().toLocaleTimeString()
                    });
                }
                return;
            }

            if (command === '/kick') {
                if (socket.id !== currentLeaderId) {
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You are not the leader.' });
                    return;
                }
                const targetId = getTargetSocketId(targetArg);
                if (targetId) {
                    const targetSocket = io.sockets.sockets.get(targetId);
                    if (targetSocket) {
                        targetSocket.disconnect(true);
                        const sysMsg = {
                            id: Date.now() + Math.random().toString(36).substr(2, 9),
                            username: 'SYSTEM',
                            text: `${targetArg} has been kicked by the leader.`,
                            timestamp: new Date().toLocaleTimeString()
                        };
                        messages.push(sysMsg);
                        io.emit('new_message', sysMsg);
                        io.emit('online users', getOnlineUsernames());
                    }
                } else {
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: `User ${targetArg} not found.` });
                }
                return;
            }

            if (command === '/mute') {
                if (socket.id !== currentLeaderId) {
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You are not the leader.' });
                    return;
                }
                const targetId = getTargetSocketId(targetArg);
                if (targetId) {
                    mutedUsers.add(targetId);
                    io.to(targetId).emit('new_message', {
                        id: Date.now() + Math.random(),
                        username: 'SYSTEM',
                        text: 'You have been muted by the leader.',
                        timestamp: new Date().toLocaleTimeString()
                    });
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: `${targetArg} has been muted.` });
                } else {
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: `User ${targetArg} not found.` });
                }
                return;
            }

            if (command === '/unmute') {
                if (socket.id !== currentLeaderId) {
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You are not the leader.' });
                    return;
                }
                const targetId = getTargetSocketId(targetArg);
                if (targetId) {
                    mutedUsers.delete(targetId);
                    io.to(targetId).emit('new_message', {
                        id: Date.now() + Math.random(),
                        username: 'SYSTEM',
                        text: 'You have been unmuted.',
                        timestamp: new Date().toLocaleTimeString()
                    });
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: `${targetArg} has been unmuted.` });
                } else {
                    // Try to remove by ID if user kept same ID? Or just fail. 
                    // Muted set uses IDs. If user reconnected, they have new ID and aren't muted.
                    // Helper gets ID from name.
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: `User ${targetArg} not found.` });
                }
                return;
            }

            if (command === '/delete') {
                const msgId = targetArg;
                const index = messages.findIndex(m => m.id == msgId);

                if (index !== -1) {
                    const msg = messages[index];
                    const isLeader = socket.id === currentLeaderId;
                    const isAuthor = msg.username === socket.username;

                    if (isLeader || isAuthor) {
                        messages.splice(index, 1);
                        io.emit('delete message', msgId);
                    } else {
                        socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You can only delete your own messages or be the leader.' });
                    }
                } else {
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: 'Message not found.' });
                }
                return;
            }

            if (command === '/help') {
                const generalCommands = ['/getleader', '/help'];
                const leaderCommands = ['/kick {username}', '/mute {username}', '/unmute {username}', '/delete {id}'];

                let availableCommands = [...generalCommands];
                if (socket.id === currentLeaderId) {
                    availableCommands = [...availableCommands, ...leaderCommands];
                }

                // Send formatted list
                socket.emit('system message', {
                    title: 'AVAILABLE COMMANDS:',
                    commands: availableCommands
                });
                return;
            }
        }

        if (mutedUsers.has(socket.id)) {
            socket.emit('new_message', {
                id: Date.now(),
                username: 'SYSTEM',
                text: 'You are muted and cannot send messages.',
                timestamp: new Date().toLocaleTimeString()
            });
            return;
        }

        const message = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            username: username,
            text: data.text, // Client only needs to send text now, or we ignore username from client
            timestamp: new Date().toLocaleTimeString()
        };

        messages.push(message);

        // History Limit Enforcement
        if (messages.length > MAX_HISTORY_MESSAGES) {
            messages.shift();
        }

        // Broadcast to all clients
        io.emit('new_message', message);
    });

    // Handle private message
    socket.on('private message', (data) => {
        // data: { to: socketId, text: string, toUsername: string }
        const username = socket.username || 'Anonymous';

        const messageData = {
            sender: username,
            text: data.text,
            recipient: data.toUsername,
            timestamp: new Date().toLocaleTimeString(),
            isPrivate: true
        };

        // Send to recipient
        io.to(data.to).emit('private message', messageData);

        // Send back to sender
        socket.emit('private message', messageData);
    });

    // Handle typing event
    socket.on('typing', () => {
        socket.broadcast.emit('typing', socket.username);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        // Update online users list after a short delay to ensure socket is gone
        // Actually, io.of("/").sockets should already have the socket removed by the time this runs or immediately after?
        // The prompt suggests waiting a moment or just calling it.
        // Node's event loop might handle it.
        // Let's use a small timeout to happen on next tick, or standard call.
        // However, in 'disconnect' handler, the socket is still in the process of leaving?
        // Actually, 'disconnecting' is before leaving rooms, 'disconnect' is after.
        // But io.sockets size checks are tricky.
        // Let's rely on re-fetching.
        io.emit('online users', getOnlineUsernames());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
