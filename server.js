const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory message storage (Reverted to single store)
// In-memory message storage
const globalHistory = [];
const reportHistory = [];
const HISTORY_LIMIT = 200;
let currentLeaderId = null;
const mutedUsers = new Set();

io.on('connection', (socket) => {
    console.log('A user connected');

    // Send existing history to the new client (Global only for now)
    // socket.emit('load_history', messages); // Removed in previous steps, but maybe good to have?
    // Client requests it now? The Sidebar client code emits 'request_history' but we are reverting.
    // Let's rely on standard 'load_history' on join-global if needed, or just leave empty for now to be safe.
    // Actually, Sidebar verification said "Verify chat clears". So history loading wasn't critical there?
    // But User expects *some* chat.
    // Let's restore basic `socket.emit('load_history', messages);` on connection/username?
    // In Sidebar task (Step 167), I removed it from 'set username'.
    // I will stick to Step 167 logic: explicit join 'global' and NO history load yet (cleanup).
    // Or better: Restore `load_history` for global join.

    // Helper to get online usernames and leader info
    const getOnlineUsernames = () => {
        const users = [];
        for (let [id, socket] of io.of("/").sockets) {
            if (socket.username) {
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
        if (username === "SYSTEM") {
            username = `STUPID HACKER`;
        }

        socket.username = username;

        // Default join global
        socket.currentRoom = 'global';
        socket.join('global');

        // Broadcast system message
        // Broadcast system message
        const systemMessage = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            username: 'SYSTEM',
            text: `${username} has joined the chat`
        };
        // Add to history
        globalHistory.push(systemMessage);
        io.to('global').emit('new_message', systemMessage);

        // Send history (Standardized Event)
        socket.emit('loadHistory', globalHistory);

        io.emit('online users', getOnlineUsernames());
    });

    // Handle Switch Room (Force History Restoration)
    socket.on('switchRoom', (roomName) => {
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }

        // Normalize room name if needed, but client sends what it sends.
        // If client sends 'report', we use 'report'.
        socket.currentRoom = roomName;
        socket.join(roomName);

        let historyToSend = [];
        if (roomName === 'global') {
            historyToSend = globalHistory;
        } else if (roomName === 'report' || roomName.startsWith('report-')) {
            // Report Room Logic
            const isLeader = socket.id === currentLeaderId;
            if (isLeader) {
                historyToSend = reportHistory;
            } else {
                historyToSend = reportHistory.filter(m => m.sender === socket.username);
            }
        }
        socket.emit('loadHistory', historyToSend);
    });

    // Legacy request_history removed as we auto-send on switch.

    // Handle new message
    socket.on('send_message', (data) => {
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
                    globalHistory.push(sysMsg);
                    if (globalHistory.length > HISTORY_LIMIT) globalHistory.shift();

                    io.emit('new_message', sysMsg);
                    io.emit('online users', getOnlineUsernames());
                } else {
                    socket.emit('new_message', {
                        id: Date.now(),
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
                        globalHistory.push(sysMsg);
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
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: `User ${targetArg} not found.` });
                }
                return;
            }

            if (command === '/delete') {
                const msgId = targetArg;
                // Use globalHistory for delete
                const index = globalHistory.findIndex(m => m.id == msgId);

                if (index !== -1) {
                    const msg = globalHistory[index];
                    const isLeader = socket.id === currentLeaderId;
                    const isAuthor = msg.username === socket.username;

                    if (isLeader || isAuthor) {
                        globalHistory.splice(index, 1);
                        io.emit('delete message', msgId);
                    } else {
                        socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You can only delete your own messages or be the leader.' });
                    }
                } else {
                    socket.emit('new_message', { id: Date.now(), username: 'SYSTEM', text: 'Message not found in Global History.' });
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

                socket.emit('system message', {
                    title: 'AVAILABLE COMMANDS:',
                    commands: availableCommands
                });
                return;
            }
        }

        // ... (Full command block restoration is risky if I miss something.
        // Actually, the previous 'view_file' had them. I can use that reference.)

        if (mutedUsers.has(socket.id)) {
            socket.emit('new_message', {
                id: Date.now(),
                username: 'SYSTEM',
                text: 'You are muted and cannot send messages.',
                timestamp: new Date().toLocaleTimeString()
            });
            return;
        }

        const room = socket.currentRoom || 'global';

        const message = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            username: username,
            text: text.replace(/warren/i, "Mr. Warren"),
            timestamp: new Date().toLocaleTimeString(),
            room: room
        };

        // Determine effective room type for history/logic
        const isReport = room === 'report' || room.startsWith('report-');

        if (isReport) {
            const reportMsg = {
                ...message,
                sender: username,
                room: 'report', // Force room name for consistency in history
                time: Date.now()
            };
            reportHistory.push(reportMsg);
            if (reportHistory.length > HISTORY_LIMIT) reportHistory.shift();

            // Real-time dispatch
            // 1. To Sender
            socket.emit('new_message', reportMsg);

            // 2. To Leader
            if (currentLeaderId && currentLeaderId !== socket.id) {
                io.to(currentLeaderId).emit('new_message', { ...reportMsg, text: `[BUG REPORT] ${reportMsg.text}` });
            }
        } else {
            // Global
            globalHistory.push(message);
            if (globalHistory.length > HISTORY_LIMIT) globalHistory.shift();
            io.to('global').emit('new_message', message);
        }
    });

    socket.on('disconnect', () => {
        if (currentLeaderId === socket.id) {
            currentLeaderId = null;
        }
        io.emit('online users', getOnlineUsernames());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
