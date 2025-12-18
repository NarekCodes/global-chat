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
        io.to('global').emit('chat message', systemMessage);

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
        } else if (roomName.startsWith('match_')) {
            // Match Room History
            historyToSend = matchHistory[roomName] || [];
        }
        socket.emit('loadHistory', historyToSend);
    });

    socket.on('getHistory', (roomName) => {
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
        }
        socket.emit('loadHistory', historyToSend);
    });

    // Legacy request_history removed as we auto-send on switch.

    // Handle new message
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
                const targetId = getTargetSocketId(targetArg);
                if (targetId) {
                    mutedUsers.add(targetId);
                    io.to(targetId).emit('chat message', {
                        id: Date.now() + Math.random(),
                        username: 'SYSTEM',
                        text: 'You have been muted by the leader.',
                        timestamp: new Date().toLocaleTimeString()
                    });
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `${targetArg} has been muted.` });
                } else {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `User ${targetArg} not found.` });
                }
                return;
            }

            if (command === '/unmute') {
                if (socket.id !== currentLeaderId) {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You are not the leader.' });
                    return;
                }
                const targetId = getTargetSocketId(targetArg);
                if (targetId) {
                    mutedUsers.delete(targetId);
                    io.to(targetId).emit('chat message', {
                        id: Date.now() + Math.random(),
                        username: 'SYSTEM',
                        text: 'You have been unmuted.',
                        timestamp: new Date().toLocaleTimeString()
                    });
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `${targetArg} has been unmuted.` });
                } else {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: `User ${targetArg} not found.` });
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
                        socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Permission denied: You can only delete your own messages or be the leader.' });
                    }
                } else {
                    socket.emit('chat message', { id: Date.now(), username: 'SYSTEM', text: 'Message not found in Global History.' });
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


        if (mutedUsers.has(socket.id)) {
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
            text: text.replace(/warren/i, "Mr. Warren"),
            timestamp: new Date().toLocaleTimeString(),
            room: room
        };

        // Determine effective room type for history/logic
        const isReport = room === 'report' || room.startsWith('report-');
        const isMatch = room.startsWith('match_');

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

            // Special logic for Leader visibility if they are not in the room?
            // User says: "Ensure that if the Leader is in their 'Global' view, they do not see the private match messages"
            // For reports, we still want Leader to see them if they are the leader, 
            // but usually we emit to them specifically.
            if (currentLeaderId && currentLeaderId !== socket.id) {
                // If leader is NOT in the room, they still get a notification?
                // The current app seems to send it to them.
                // To keep it strictly room-based, we should ONLY emit to room.
                // However, the leader role usually sees all reports.
                // Let's stick to strict room emitting as per "total message isolation".
                // If the leader wants to see reports, they should join the report room.
                // Wait, if I change this, I might break existing "Leader sees all reports" feature.
                // But prompt says: "Leader... do not see the private match messages unless they intentionally switch to the Match room".
                // "Messages sent in 'Private Match' must only appear in 'Private Match'. Messages sent in 'Global' must only appear in 'Global'."
                // This implies strictness.

                // Let's keep the special leader notification for reports if they are NOT the sender, 
                // but only if it's a "Global Leak" we are fixing (match vs global).
                // Actually, let's just use io.to(room) everywhere.
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
        } else {
            // Global
            globalHistory.push(message);
            if (globalHistory.length > HISTORY_LIMIT) globalHistory.shift();
            io.to('global').emit('chat message', message);
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
