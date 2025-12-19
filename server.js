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
const privateChatHistory = {}; // Persistent DM storage
const HISTORY_LIMIT = 200;
let currentLeaderId = null;
const mutedUsers = new Set(); // Stores usernames
let waitingUsers = [];
let activeMatches = {}; // socket.id -> roomID
let matchHistory = {}; // roomID -> messages[]

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
                users.push({ id: id, username: socket.username, avatarUrl: socket.avatarUrl });
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

    const broadcastMutedUsers = () => {
        if (currentLeaderId) {
            io.to(currentLeaderId).emit('mutedUsersUpdate', Array.from(mutedUsers));
        }
    };

    // Handle setting username
    socket.on('set username', (data) => {
        let { username, avatarUrl } = typeof data === 'string' ? { username: data, avatarUrl: null } : data;

        if (username === "SYSTEM") {
            username = `STUPID HACKER`;
        }

        // Server Guard 1: Username Check
        if (username.includes(' ')) {
            socket.emit('loginError', {
                title: 'Invalid Username',
                message: 'Usernames cannot contain spaces. Please use underscores instead.'
            });
            return;
        }

        // Username Uniqueness Check
        const { users } = getOnlineUsernames();
        const isTaken = users.some(u => u.username.toLowerCase() === username.toLowerCase());
        if (isTaken) {
            socket.emit('loginError', {
                title: 'Name Already Active',
                message: `The name "${username}" is already in use. Please choose a different name.`
            });
            return;
        }

        // Server Guard 2: Avatar URL Regex (if provided and not fallback)
        if (avatarUrl && !avatarUrl.includes('ui-avatars.com')) {
            const imageRegex = /\.(jpg|jpeg|png|webp|gif|svg)$/i;
            if (!imageRegex.test(avatarUrl)) {
                socket.emit('loginError', {
                    title: 'Invalid URL',
                    message: 'Please provide a direct link to an image file.'
                });
                return;
            }
        }

        socket.username = username;
        socket.avatarUrl = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;

        // Default join global
        socket.currentRoom = 'global';
        socket.join('global');

        // Broadcast system message
        const systemMessage = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            username: 'SYSTEM',
            text: `${username} has joined the chat`,
            senderID: 'SYSTEM'
        };
        // Add to history
        globalHistory.push(systemMessage);
        io.to('global').emit('chat message', systemMessage);

        // Send history (Standardized Event)
        socket.emit('loadHistory', globalHistory);

        io.emit('online users', getOnlineUsernames());
        broadcastMutedUsers();
    });

    // Handle Switch Room (Force History Restoration)
    socket.on('switchRoom', (roomName) => {
        // Security Check for Private Rooms
        if (roomName.startsWith('private_')) {
            const parts = roomName.split('_');
            const user1 = parts[1];
            const user2 = parts[2];
            const isLeader = socket.id === currentLeaderId;
            const isParticipant = socket.username === user1 || socket.username === user2;

            if (!isParticipant && !isLeader) {
                socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Access Denied: You are not a participant in this private chat.' });
                return;
            }
        }

        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }

        socket.currentRoom = roomName;
        socket.join(roomName);

        let historyToSend = [];
        if (roomName === 'global') {
            historyToSend = globalHistory;
        } else if (roomName === 'report' || roomName.startsWith('report-')) {
            const isLeader = socket.id === currentLeaderId;
            if (isLeader) {
                historyToSend = reportHistory;
            } else {
                historyToSend = reportHistory.filter(m => m.sender === socket.username);
            }
        } else if (roomName.startsWith('match_')) {
            historyToSend = matchHistory[roomName] || [];
        } else if (roomName.startsWith('private_')) {
            historyToSend = privateChatHistory[roomName] || [];
        }
        socket.emit('loadHistory', historyToSend);
    });

    socket.on('getHistory', (roomName) => {
        // ... (existing code for security check)
        const parts = roomName.startsWith('private_') ? roomName.split('_') : null;
        if (parts) {
            const user1 = parts[1];
            const user2 = parts[2];
            const isLeader = socket.id === currentLeaderId;
            const isParticipant = socket.username === user1 || socket.username === user2;
            if (!isParticipant && !isLeader) return;
        }

        let historyToSend = [];
        if (roomName === 'global') {
            historyToSend = globalHistory;
        } else if (roomName === 'report' || roomName.startsWith('report-')) {
            const isLeader = socket.id === currentLeaderId;
            if (isLeader) {
                historyToSend = reportHistory;
            } else {
                historyToSend = reportHistory.filter(m => m.sender === socket.username);
            }
        } else if (roomName && roomName.startsWith('match_')) {
            historyToSend = matchHistory[roomName] || [];
        } else if (roomName && roomName.startsWith('private_')) {
            historyToSend = privateChatHistory[roomName] || [];
        }
        socket.emit('loadHistory', historyToSend);
    });

    socket.on('requestPrivateHistory', (roomID) => {
        // Security Check
        const parts = roomID.split('_');
        const isParticipant = socket.username === parts[1] || socket.username === parts[2];
        const isLeader = socket.id === currentLeaderId;

        if (isParticipant || isLeader) {
            socket.emit('loadHistory', privateChatHistory[roomID] || []);
        }
    });

    // Legacy request_history removed as we auto-send on switch.

    // Handle new message
    socket.on('typing', (data) => {
        const room = data.room || 'global';
        socket.to(room).emit('userTyping', socket.username || 'Anonymous');
    });

    socket.on('stopTyping', (data) => {
        const room = data.room || 'global';
        socket.to(room).emit('userStopTyping', socket.username || 'Anonymous');
    });

    socket.on('chat message', (data) => {
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

                    io.emit('chat message', sysMsg);
                    io.emit('online users', getOnlineUsernames());
                    broadcastMutedUsers();
                } else {
                    socket.emit('chat message', {
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
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You are not the leader.' });
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
                        io.emit('chat message', sysMsg);
                        io.emit('online users', getOnlineUsernames());
                    }
                } else {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `User ${targetArg} not found.` });
                }
                return;
            }

            if (command === '/mute') {
                if (socket.id !== currentLeaderId) {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You are not the leader.' });
                    return;
                }
                const targetUsername = targetArg;
                if (targetUsername) {
                    mutedUsers.add(targetUsername);
                    const targetId = getTargetSocketId(targetUsername);
                    if (targetId) {
                        io.to(targetId).emit('chat message', {
                            id: Date.now() + Math.random(),
                            username: 'SYSTEM',
                            text: 'You have been muted by the leader.',
                            timestamp: new Date().toLocaleTimeString()
                        });
                    }
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `${targetUsername} has been muted.` });
                    broadcastMutedUsers();
                } else {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `Please specify a username.` });
                }
                return;
            }

            if (command === '/unmute') {
                if (socket.id !== currentLeaderId) {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You are not the leader.' });
                    return;
                }
                const targetUsername = targetArg;
                if (targetUsername) {
                    mutedUsers.delete(targetUsername);
                    const targetId = getTargetSocketId(targetUsername);
                    if (targetId) {
                        io.to(targetId).emit('chat message', {
                            id: Date.now() + Math.random(),
                            username: 'SYSTEM',
                            text: 'You have been unmuted.',
                            timestamp: new Date().toLocaleTimeString()
                        });
                    }
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `${targetUsername} has been unmuted.` });
                    broadcastMutedUsers();
                } else {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `Please specify a username.` });
                }
                return;
            }

            if (command === '/delete') {
                const msgId = targetArg;
                let found = false;

                const deleteFromHistory = (historyArr) => {
                    const idx = historyArr.findIndex(m => m.id == msgId);
                    if (idx !== -1) {
                        const msg = historyArr[idx];
                        const isLeader = socket.id === currentLeaderId;
                        const isAuthor = msg.senderID === socket.id;

                        if (isLeader || isAuthor) {
                            historyArr.splice(idx, 1);
                            found = true;
                            return true;
                        } else {
                            socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You can only delete your own messages or be the leader.' });
                            found = true; // Stop searching if permission denied
                            return false;
                        }
                    }
                    return false;
                };

                // 1. Try Global
                if (deleteFromHistory(globalHistory)) {
                    io.emit('delete message', msgId);
                    return;
                }
                if (found) return;

                // 2. Try Report
                if (deleteFromHistory(reportHistory)) {
                    io.emit('delete message', msgId);
                    return;
                }
                if (found) return;

                // 3. Try Match Histories
                for (const matchRoomId in matchHistory) {
                    if (deleteFromHistory(matchHistory[matchRoomId])) {
                        io.to(matchRoomId).emit('delete message', msgId);
                        return;
                    }
                    if (found) return;
                }

                if (!found) {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Message not found in any history.' });
                }
                return;
            }

            if (command === '/help') {
                const generalCommands = ['/getleader', '/help', '/match', '/cancel'];
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

            if (command === '/match') {
                // Check if already in a match or queue
                if (activeMatches[socket.id]) {
                    socket.emit('chat message', { username: 'SYSTEM', text: 'You are already in a match.' });
                    return;
                }
                const isAlreadyWaiting = waitingUsers.some(u => u.id === socket.id);
                if (isAlreadyWaiting) {
                    socket.emit('chat message', { username: 'SYSTEM', text: 'You are already in the queue.' });
                    return;
                }

                if (waitingUsers.length > 0) {
                    const partner = waitingUsers.shift();
                    const matchRoom = `match_${socket.id}_${partner.id}`;

                    // Join both
                    socket.join(matchRoom);
                    partner.join(matchRoom);

                    // Track
                    activeMatches[socket.id] = matchRoom;
                    activeMatches[partner.id] = matchRoom;

                    // Notify with names
                    socket.emit('matchStarted', { roomID: matchRoom, partnerName: partner.username || 'Anonymous' });
                    partner.emit('matchStarted', { roomID: matchRoom, partnerName: socket.username || 'Anonymous' });

                    // Optional: System message in the new room?
                    // io.to(matchRoom).emit('new_message', { username: 'SYSTEM', text: 'You are now matched! Say hi.' });
                } else {
                    waitingUsers.push(socket);
                    socket.emit('chat message', { username: 'SYSTEM', text: 'Waiting for a partner...' });
                }
                return;
            }

            if (command === '/cancel') {
                // Remove from queue
                const queueIndex = waitingUsers.findIndex(u => u.id === socket.id);
                if (queueIndex !== -1) {
                    waitingUsers.splice(queueIndex, 1);
                    socket.emit('chat message', { username: 'SYSTEM', text: 'Matchmaking cancelled.' });
                    return;
                }

                // Remove from match
                const matchRoom = activeMatches[socket.id];
                if (matchRoom) {
                    io.to(matchRoom).emit('matchEnded');

                    // Cleanup History
                    delete matchHistory[matchRoom];

                    // Clean up for both
                    // Find all users in this matchRoom from activeMatches map? 
                    // Better: just emit to room 'matchEnded'
                    // io.to(matchRoom).emit('matchEnded'); // This line was duplicated in the original, removing.

                    // We need to manually clean up activeMatches for the partner too
                    // Iterate and delete
                    // Ideally we know the partner ID but map is socket->room.
                    // We can iterate sockets.
                    // Or relies on client `matchEnded` to trigger `switchRoom('global')` which leaves room?
                    // Server `switchRoom` handles `leave`.
                    // But we must update `activeMatches` map.

                    for (let [id, room] of Object.entries(activeMatches)) {
                        if (room === matchRoom) {
                            delete activeMatches[id];
                            // socket.leave handled when they switch room? 
                            // Or forced here?
                            // Let's rely on client logic for UI, but pure server logic for state.
                            // Client will emit switchRoom('global').
                        }
                    }
                    return;
                }

                socket.emit('chat message', { username: 'SYSTEM', text: 'You are not in a match or queue.' });
                return;
            }
        }


        if (mutedUsers.has(socket.username)) {
            socket.emit('chat message', {
                id: Date.now(),
                username: 'SYSTEM',
                text: 'You are muted and cannot send messages.',
                timestamp: new Date().toLocaleTimeString()
            });
            return;
        }

        const room = data.room || socket.currentRoom || 'global';

        const message = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            username: username,
            senderID: socket.id, // Unique identity based on socket
            avatarUrl: socket.avatarUrl,
            text: text.replace(/warren/i, "Mr. Warren"),
            timestamp: new Date().toLocaleTimeString(),
            room: room,
            replyTo: data.replyTo // Support for context menu reply system
        };

        // Determine effective room type for history/logic
        const isReport = room === 'report' || room.startsWith('report-');
        const isMatch = room.startsWith('match_');
        const isPrivate = room.startsWith('private_');

        if (isReport) {
            const reportMsg = {
                ...message,
                sender: username,
                room: 'report', // Force room name for consistency in history
                time: Date.now()
            };
            reportHistory.push(reportMsg);
            if (reportHistory.length > HISTORY_LIMIT) reportHistory.shift();

            // Real-time dispatch strictly to room
            io.to(room).emit('chat message', reportMsg);

            if (currentLeaderId && currentLeaderId !== socket.id) {
                io.to(currentLeaderId).emit('chat message', { ...reportMsg, text: `[BUG REPORT] ${reportMsg.text}` });
            }
        } else if (isMatch) {
            // Private Match History
            if (!matchHistory[room]) {
                matchHistory[room] = [];
            }
            matchHistory[room].push(message);
            if (matchHistory[room].length > HISTORY_LIMIT) matchHistory[room].shift();

            io.to(room).emit('chat message', message);
        } else if (isPrivate) {
            // Persistent Private DM History
            if (!privateChatHistory[room]) {
                privateChatHistory[room] = [];
            }
            privateChatHistory[room].push(message);
            if (privateChatHistory[room].length > HISTORY_LIMIT) privateChatHistory[room].shift();

            io.to(room).emit('chat message', message);

            // Telegram-Style "Auto-Spawn" for the receiver
            const parts = room.split('_');
            const otherUser = parts[1] === socket.username ? parts[2] : parts[1];
            const targetId = getTargetSocketId(otherUser);
            if (targetId) {
                io.to(targetId).emit('incomingPrivateChat', {
                    from: socket.username,
                    avatar: socket.avatarUrl,
                    roomID: room
                });
            }
        } else {
            // Global
            globalHistory.push(message);
            if (globalHistory.length > HISTORY_LIMIT) globalHistory.shift();
            io.to('global').emit('chat message', message);

            // @Mention System for Global Chat
            const mentionRegex = /@(\w+)/g;
            const mentions = text.match(mentionRegex);
            if (mentions) {
                // Get unique usernames mentioned
                const mentionedUsers = [...new Set(mentions.map(m => m.substring(1)))];

                mentionedUsers.forEach(taggedName => {
                    const targetId = getTargetSocketId(taggedName);
                    if (targetId) {
                        io.to(targetId).emit('userMentioned', { from: username });
                    }
                });
            }
        }
    });

    socket.on('disconnect', () => {
        if (currentLeaderId === socket.id) {
            currentLeaderId = null;
        }

        // Matchmaking Cleanup
        // 1. Remove from Queue
        const queueIndex = waitingUsers.indexOf(socket);
        if (queueIndex !== -1) {
            waitingUsers.splice(queueIndex, 1);
        }

        // 2. Terminate Active Match
        const matchRoom = activeMatches[socket.id];
        if (matchRoom) {
            // Notify partner/room
            io.to(matchRoom).emit('matchEnded');

            // Clean up both users from activeMatches
            for (let [id, room] of Object.entries(activeMatches)) {
                if (room === matchRoom) {
                    delete activeMatches[id];
                }
            }
            // Cleanup History on disconnect? Prompt says optionally on /cancel.
            // Let's keep it for now as per "optionally... or keep it until server restarts".
            // But usually match ends if someone leaves.
            delete matchHistory[matchRoom];
        }

        io.emit('online users', getOnlineUsernames());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
