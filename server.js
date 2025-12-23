const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// DUAL-MODE: Chat + Mafia Engine (Final Comprehensive Version)
// ============================================================

const activeRooms = {};
const HISTORY_LIMIT = 200;
const DAY_TIMER_SECONDS = 60;

const ROLES = {
    DON: 'Don',
    MAFIA: 'Mafia',
    SHERIFF: 'Sheriff',
    VILLAGER: 'Villager'
};

const ROLE_GOALS = {
    [ROLES.DON]: 'You are the Don 🎩. At night: /kill [name] OR /checkSheriff [name]',
    [ROLES.MAFIA]: 'You are Mafia 🔪. Support the Don in secret night chat.',
    [ROLES.SHERIFF]: 'You are the Sheriff 🕵️. At night: /investigate [name]',
    [ROLES.VILLAGER]: 'You are a Villager 👤. Vote out the Mafia during the day.'
};

// ============================================================
// HELPERS
// ============================================================

const generateRoomCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (activeRooms[code] || code === 'MAFIA');
    return code;
};

const createSystemMessage = (text, type = 'info') => ({
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    username: 'SYSTEM',
    text,
    type,
    timestamp: new Date().toLocaleTimeString()
});

const getRoomUsers = (roomCode, forSocketId = null) => {
    const room = activeRooms[roomCode];
    if (!room) return { users: [], leaderId: null, gameState: 'LOBBY', isMafiaRoom: false };

    const users = [];
    const sheriffDiscoveries = room.sheriffDiscoveries || new Map();
    const requesterData = forSocketId ? room.members.get(forSocketId) : null;
    const isSheriff = requesterData?.role === ROLES.SHERIFF;

    for (const [socketId, memberData] of room.members) {
        const userInfo = {
            id: socketId,
            username: memberData.username,
            avatarUrl: memberData.avatarUrl,
            isAlive: memberData.isAlive !== false,
            isLeader: socketId === room.leaderId,
            isMuted: room.mutedUsers?.has(memberData.username),
            hasVoted: memberData.hasVoted || false,
            isSpectator: memberData.isSpectator || false
        };

        if (room.isMafiaRoom && isSheriff && sheriffDiscoveries.has(memberData.username)) {
            userInfo.colorCode = sheriffDiscoveries.get(memberData.username);
        }

        users.push(userInfo);
    }

    return { users, leaderId: room.leaderId, gameState: room.isMafiaRoom ? room.gameState : 'CHAT', isMafiaRoom: room.isMafiaRoom };
};

const broadcastRoomUsers = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return;
    for (const [socketId] of room.members) {
        const s = io.sockets.sockets.get(socketId);
        if (s) s.emit('online users', getRoomUsers(roomCode, socketId));
    }
};

const getMemberByUsername = (roomCode, targetUsername) => {
    const room = activeRooms[roomCode];
    if (!room) return null;
    for (const [socketId, memberData] of room.members) {
        if (memberData.username.toLowerCase() === targetUsername.toLowerCase()) {
            return { socketId, ...memberData };
        }
    }
    return null;
};

const getSocketByUsername = (roomCode, targetUsername) => {
    const room = activeRooms[roomCode];
    if (!room) return null;
    for (const [socketId, memberData] of room.members) {
        if (memberData.username.toLowerCase() === targetUsername.toLowerCase()) {
            return io.sockets.sockets.get(socketId);
        }
    }
    return null;
};

const getMafiaTeam = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return [];
    const mafia = [];
    for (const [socketId, memberData] of room.members) {
        if ((memberData.role === ROLES.DON || memberData.role === ROLES.MAFIA) && memberData.isAlive && !memberData.isSpectator) {
            mafia.push({ socketId, ...memberData });
        }
    }
    return mafia;
};

const getTownTeam = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return [];
    const town = [];
    for (const [socketId, memberData] of room.members) {
        if ((memberData.role === ROLES.SHERIFF || memberData.role === ROLES.VILLAGER) && memberData.isAlive && !memberData.isSpectator) {
            town.push({ socketId, ...memberData });
        }
    }
    return town;
};

const getAliveCount = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return 0;
    return [...room.members.values()].filter(m => m.isAlive && !m.isSpectator).length;
};

const getVotedCount = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return 0;
    return [...room.members.values()].filter(m => m.isAlive && !m.isSpectator && m.hasVoted).length;
};

const checkVictory = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || !room.isMafiaRoom || room.gameState === 'LOBBY') return null;
    const mafia = getMafiaTeam(roomCode);
    const town = getTownTeam(roomCode);
    if (mafia.length === 0) return { winner: 'TOWN', message: '🎉 Town Wins! All Mafia eliminated.' };
    if (mafia.length >= town.length) return { winner: 'MAFIA', message: '😈 Mafia Wins!' };
    return null;
};

const eliminatePlayer = (roomCode, targetUsername, reason) => {
    const room = activeRooms[roomCode];
    if (!room) return;
    for (const [socketId, memberData] of room.members) {
        if (memberData.username.toLowerCase() === targetUsername.toLowerCase()) {
            memberData.isAlive = false;
            room.members.set(socketId, memberData);
            const msg = createSystemMessage(`💀 ${memberData.username} eliminated. ${reason}`, 'death');
            room.history.push(msg);
            io.to(roomCode).emit('chat message', msg);
            const roleMsg = createSystemMessage(`${memberData.username} was a ${memberData.role}.`, 'reveal');
            room.history.push(roleMsg);
            io.to(roomCode).emit('chat message', roleMsg);
            break;
        }
    }
    broadcastRoomUsers(roomCode);
};

// ============================================================
// TIMER SYSTEM
// ============================================================

const clearRoomTimer = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || !room.timerInterval) return;
    clearInterval(room.timerInterval);
    room.timerInterval = null;
    room.timerSeconds = 0;
    io.to(roomCode).emit('timer_update', { seconds: 0, active: false });
};

const startDayTimer = (roomCode, isDay1 = false) => {
    const room = activeRooms[roomCode];
    if (!room || !room.isMafiaRoom) return;

    clearRoomTimer(roomCode);
    room.timerSeconds = DAY_TIMER_SECONDS;

    io.to(roomCode).emit('timer_update', { seconds: room.timerSeconds, active: true });

    room.timerInterval = setInterval(() => {
        room.timerSeconds--;
        io.to(roomCode).emit('timer_update', { seconds: room.timerSeconds, active: true });

        if (room.timerSeconds <= 0) {
            clearRoomTimer(roomCode);
            if (isDay1) {
                room.round++;
                startNightPhase(roomCode);
            } else {
                resolveVoting(roomCode);
            }
        }
    }, 1000);
};

const resolveVoting = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return;

    clearRoomTimer(roomCode);

    const skipCount = room.skipVotes?.size || 0;
    let maxVotes = skipCount;
    let maxTarget = null;
    let hasTie = false;

    for (const [target, count] of (room.votes || new Map())) {
        if (count > maxVotes) {
            maxVotes = count;
            maxTarget = target;
            hasTie = false;
        } else if (count === maxVotes && count > 0) {
            hasTie = true;
        }
    }

    if (hasTie || maxTarget === null || skipCount >= maxVotes) {
        const skipMsg = createSystemMessage(`🚫 Day ended with no elimination.`, 'phase');
        room.history.push(skipMsg);
        io.to(roomCode).emit('chat message', skipMsg);
    } else {
        eliminatePlayer(roomCode, maxTarget, 'Voted out.');
        const victory = checkVictory(roomCode);
        if (victory) { endGame(roomCode, victory); return; }
    }

    room.round++;
    setTimeout(() => startNightPhase(roomCode), 2000);
};

const checkInstantResolution = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || room.gameState !== 'DAY') return;

    const aliveCount = getAliveCount(roomCode);
    const votedCount = getVotedCount(roomCode);

    if (votedCount >= aliveCount && aliveCount > 0) {
        resolveVoting(roomCode);
    }
};

// ============================================================
// MAFIA GAME PHASES
// ============================================================

const startNightPhase = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || !room.isMafiaRoom) return;

    clearRoomTimer(roomCode);
    room.gameState = 'NIGHT';
    room.nightActions = { mafiaKill: null, donActed: false, sheriffActed: false };
    room.mafiaChat = []; // Fresh Mafia chat each night

    const msg = createSystemMessage(`🌙 Night ${room.round} falls. Town sleeps...`, 'phase');
    room.history.push(msg);
    io.to(roomCode).emit('chat message', msg);
    io.to(roomCode).emit('phaseChange', { phase: 'NIGHT', round: room.round });

    const mafia = getMafiaTeam(roomCode);
    mafia.forEach(m => {
        const s = io.sockets.sockets.get(m.socketId);
        if (s) {
            const hint = m.role === ROLES.DON ? '/kill [name] or /checkSheriff [name]' : 'Discuss with team.';
            s.emit('chat message', createSystemMessage(hint, 'private'));
        }
    });

    for (const [socketId, memberData] of room.members) {
        if (memberData.role === ROLES.SHERIFF && memberData.isAlive && !memberData.isSpectator) {
            const s = io.sockets.sockets.get(socketId);
            if (s) s.emit('chat message', createSystemMessage('/investigate [name]', 'private'));
        }
    }
    broadcastRoomUsers(roomCode);
};

const checkNightComplete = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || room.gameState !== 'NIGHT') return;

    const sheriffAlive = [...room.members.values()].some(m => m.role === ROLES.SHERIFF && m.isAlive && !m.isSpectator);
    const donAlive = [...room.members.values()].some(m => m.role === ROLES.DON && m.isAlive && !m.isSpectator);

    const donReady = !donAlive || room.nightActions.donActed;
    const sheriffReady = !sheriffAlive || room.nightActions.sheriffActed;

    if (donReady && sheriffReady) {
        setTimeout(() => startDayPhase(roomCode), 2000);
    }
};

const startDay1Phase = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || !room.isMafiaRoom) return;

    room.gameState = 'DAY_1';
    room.round = 1;

    const msg = createSystemMessage(`☀️ Day 1. Introductions only. No voting. (60s)`, 'phase');
    room.history.push(msg);
    io.to(roomCode).emit('chat message', msg);
    io.to(roomCode).emit('phaseChange', { phase: 'DAY_1', round: 1 });

    startDayTimer(roomCode, true);
    broadcastRoomUsers(roomCode);
};

const startDayPhase = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || !room.isMafiaRoom) return;

    clearRoomTimer(roomCode);

    // Clear Mafia secret chat (privacy reset)
    room.mafiaChat = [];

    // Morning Report
    if (room.nightActions?.mafiaKill) {
        const victim = room.nightActions.mafiaKill;
        const morningMsg = createSystemMessage(`☀️ Morning has broken. ${victim} was found dead.`, 'phase');
        room.history.push(morningMsg);
        io.to(roomCode).emit('chat message', morningMsg);
        eliminatePlayer(roomCode, victim, '');
    } else {
        const peacefulMsg = createSystemMessage(`☀️ Morning has broken. No one died.`, 'phase');
        room.history.push(peacefulMsg);
        io.to(roomCode).emit('chat message', peacefulMsg);
    }

    const victory = checkVictory(roomCode);
    if (victory) { endGame(roomCode, victory); return; }

    room.gameState = 'DAY';
    room.round = (room.round || 0) + 1;
    room.votes = new Map();
    room.skipVotes = new Set();

    for (const [socketId, memberData] of room.members) {
        if (!memberData.isSpectator) {
            memberData.hasVoted = false;
            memberData.votedFor = null;
            room.members.set(socketId, memberData);
        }
    }

    const dayMsg = createSystemMessage(`Day ${room.round}. Vote /vote [name] or /skip. (60s)`, 'phase');
    room.history.push(dayMsg);
    io.to(roomCode).emit('chat message', dayMsg);
    io.to(roomCode).emit('phaseChange', { phase: 'DAY', round: room.round });

    startDayTimer(roomCode, false);
    broadcastRoomUsers(roomCode);
};

const endGame = (roomCode, victory) => {
    const room = activeRooms[roomCode];
    if (!room) return;

    clearRoomTimer(roomCode);
    room.gameState = 'LOBBY';
    room.mafiaChat = [];

    const msg = createSystemMessage(victory.message, 'victory');
    room.history.push(msg);
    io.to(roomCode).emit('chat message', msg);
    io.to(roomCode).emit('gameOver', victory);

    for (const [socketId, memberData] of room.members) {
        memberData.role = null;
        memberData.isAlive = true;
        memberData.hasVoted = false;
        memberData.isSpectator = false;
        room.members.set(socketId, memberData);
    }
    room.sheriffDiscoveries = new Map();
    broadcastRoomUsers(roomCode);
};

const assignRoles = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return;

    const activePlayers = [...room.members.entries()].filter(([, m]) => !m.isSpectator);
    const count = activePlayers.length;
    const mafiaCount = Math.max(1, Math.floor(count * 0.25));

    for (let i = activePlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [activePlayers[i], activePlayers[j]] = [activePlayers[j], activePlayers[i]];
    }

    let mafiaAssigned = 0, sheriffAssigned = false;

    activePlayers.forEach(([socketId, memberData]) => {
        let role;
        if (mafiaAssigned < mafiaCount) {
            role = mafiaAssigned === 0 ? ROLES.DON : ROLES.MAFIA;
            mafiaAssigned++;
        } else if (!sheriffAssigned) {
            role = ROLES.SHERIFF;
            sheriffAssigned = true;
        } else {
            role = ROLES.VILLAGER;
        }

        memberData.role = role;
        memberData.isAlive = true;
        memberData.hasVoted = false;
        room.members.set(socketId, memberData);

        const s = io.sockets.sockets.get(socketId);
        if (s) {
            s.emit('roleAssigned', { role, goal: ROLE_GOALS[role], team: (role === ROLES.DON || role === ROLES.MAFIA) ? 'MAFIA' : 'TOWN' });
        }
    });

    const mafia = getMafiaTeam(roomCode);
    const mafiaNames = mafia.map(m => `${m.username}${m.role === ROLES.DON ? ' (Don)' : ''}`).join(', ');
    mafia.forEach(m => {
        const s = io.sockets.sockets.get(m.socketId);
        if (s) s.emit('chat message', createSystemMessage(`🔪 Team: ${mafiaNames}`, 'private'));
    });

    room.sheriffDiscoveries = new Map();
    room.mafiaChat = [];

    const startMsg = createSystemMessage(`🎮 Game started! ${count} players.`, 'game');
    room.history.push(startMsg);
    io.to(roomCode).emit('chat message', startMsg);

    setTimeout(() => startDay1Phase(roomCode), 2000);
};

// ============================================================
// SOCKET HANDLERS
// ============================================================

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    socket.on('host_room', (data) => {
        let { username, avatarUrl } = data;
        if (!username || username.includes(' ')) {
            socket.emit('loginError', { title: 'Invalid Username', message: 'No spaces.' });
            return;
        }
        if (username.toUpperCase() === 'SYSTEM') username = 'PLAYER';

        const roomCode = generateRoomCode();
        socket.username = username;
        socket.avatarUrl = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
        socket.roomCode = roomCode;

        activeRooms[roomCode] = {
            history: [],
            members: new Map([[socket.id, { username, avatarUrl: socket.avatarUrl, isAlive: true, hasVoted: false, isSpectator: false }]]),
            leaderId: null, // No auto-leader assignment
            mutedUsers: new Set(),
            isPermanent: false,
            isMafiaRoom: false
        };

        socket.join(roomCode);
        const msg = createSystemMessage(`${username} created the room.`);
        activeRooms[roomCode].history.push(msg);

        const room = activeRooms[roomCode];
        const leader = room.leaderId ? room.members.get(room.leaderId) : null;
        socket.emit('roomJoined', { 
            roomCode, 
            isLeader: false, 
            isMafiaRoom: false,
            currentLeaderId: room.leaderId,
            currentLeaderUsername: leader?.username || null
        });
        socket.emit('loadHistory', activeRooms[roomCode].history);
        broadcastRoomUsers(roomCode);
    });

    socket.on('join_room', (data) => {
        let { username, avatarUrl, roomCode } = data;
        if (!username || username.includes(' ')) {
            socket.emit('loginError', { title: 'Invalid Username', message: 'No spaces.' });
            return;
        }
        if (username.toUpperCase() === 'SYSTEM') username = 'PLAYER';

        roomCode = roomCode ? roomCode.toUpperCase().trim() : '';

        if (roomCode === 'MAFIA' && !activeRooms['MAFIA']) {
            activeRooms['MAFIA'] = {
                history: [],
                members: new Map(),
                leaderId: null,
                mutedUsers: new Set(),
                isPermanent: true,
                isMafiaRoom: true,
                gameState: 'LOBBY',
                nightActions: {},
                sheriffDiscoveries: new Map(),
                votes: new Map(),
                skipVotes: new Set(),
                mafiaChat: [],
                round: 0,
                timerInterval: null,
                timerSeconds: 0
            };
        }

        if (!activeRooms[roomCode]) {
            socket.emit('loginError', { title: 'Room Not Found', message: 'No room with this code.' });
            return;
        }

        const room = activeRooms[roomCode];

        for (const [, m] of room.members) {
            if (m.username.toLowerCase() === username.toLowerCase()) {
                socket.emit('loginError', { title: 'Name Taken', message: 'Choose another.' });
                return;
            }
        }

        socket.username = username;
        socket.avatarUrl = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
        socket.roomCode = roomCode;

        // Spectator logic: if game is in progress
        const isSpectator = room.isMafiaRoom && room.gameState !== 'LOBBY';

        room.members.set(socket.id, {
            username,
            avatarUrl: socket.avatarUrl,
            isAlive: !isSpectator,
            hasVoted: false,
            isSpectator
        });

        // No auto-leader assignment - leader must be set via /getleader

        socket.join(roomCode);

        const joinMsg = isSpectator
            ? createSystemMessage(`👁️ ${username} joined as a Spectator.`)
            : createSystemMessage(`${username} joined.`);
        room.history.push(joinMsg);
        io.to(roomCode).emit('chat message', joinMsg);

        const leader = room.leaderId ? room.members.get(room.leaderId) : null;
        socket.emit('roomJoined', {
            roomCode,
            isLeader: false, // Leader status only set via /getleader
            isMafiaRoom: room.isMafiaRoom,
            isSpectator,
            currentLeaderId: room.leaderId,
            currentLeaderUsername: leader?.username || null
        });
        socket.emit('loadHistory', room.history);

        if (isSpectator) {
            socket.emit('chat message', createSystemMessage('You are a Spectator. Watch only.', 'private'));
        }

        broadcastRoomUsers(roomCode);
    });

    socket.on('chat message', (data) => {
        const roomCode = socket.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        const room = activeRooms[roomCode];
        const member = room.members.get(socket.id);
        if (!member) return;

        const text = data.text.trim();

        if (text.startsWith('/')) {
            handleCommand(socket, room, roomCode, member, text);
            return;
        }

        if (room.mutedUsers.has(member.username)) {
            socket.emit('chat message', createSystemMessage('You are muted.', 'error'));
            return;
        }

        // Spectators can only chat during LOBBY
        if (room.isMafiaRoom && member.isSpectator && room.gameState !== 'LOBBY') {
            socket.emit('chat message', createSystemMessage('Spectators cannot chat during game.', 'error'));
            return;
        }

        if (room.isMafiaRoom && !member.isAlive && !member.isSpectator) {
            socket.emit('chat message', createSystemMessage('Dead cannot speak.', 'error'));
            return;
        }

        if (room.isMafiaRoom && room.gameState === 'NIGHT') {
            if (member.role !== ROLES.DON && member.role !== ROLES.MAFIA) {
                socket.emit('chat message', createSystemMessage('🌙 Town sleeps.', 'error'));
                return;
            }

            // Mafia secret chat
            const message = {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                username: `🔪 ${member.username}`,
                avatarUrl: member.avatarUrl,
                text, timestamp: new Date().toLocaleTimeString(),
                isSecret: true
            };
            room.mafiaChat.push(message);
            getMafiaTeam(roomCode).forEach(m => {
                const s = io.sockets.sockets.get(m.socketId);
                if (s) s.emit('chat message', message);
            });
            return;
        }

        const message = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            username: member.username,
            avatarUrl: member.avatarUrl,
            text, timestamp: new Date().toLocaleTimeString()
        };

        room.history.push(message);
        if (room.history.length > HISTORY_LIMIT) room.history.shift();
        io.to(roomCode).emit('chat message', message);
    });

    socket.on('delete_message', (data) => {
        const roomCode = socket.roomCode || data.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        const room = activeRooms[roomCode];
        const member = room.members.get(socket.id);
        if (!member) return;

        // Check if user is leader or message author
        const isLeader = socket.id === room.leaderId;
        const message = room.history.find(msg => msg.id === data.messageId);
        
        if (!message) return;
        
        const isAuthor = message.username === member.username;
        
        // Only allow deletion if user is leader or message author
        if (!isLeader && !isAuthor) {
            socket.emit('chat message', createSystemMessage('You can only delete your own messages or be a leader.', 'error'));
            return;
        }

        // Remove message from history
        const messageIndex = room.history.findIndex(msg => msg.id === data.messageId);
        if (messageIndex !== -1) {
            room.history.splice(messageIndex, 1);
        }

        // Broadcast deletion to all clients
        io.to(roomCode).emit('message_deleted', { messageId: data.messageId });
    });

    socket.on('typing', () => { if (socket.roomCode) socket.to(socket.roomCode).emit('userTyping', socket.username); });
    socket.on('stopTyping', () => { if (socket.roomCode) socket.to(socket.roomCode).emit('userStopTyping', socket.username); });

    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        const room = activeRooms[roomCode];
        const member = room.members.get(socket.id);
        const username = member?.username || 'Unknown';

        if (room.isMafiaRoom && room.gameState !== 'LOBBY' && member?.isAlive && !member?.isSpectator) {
            member.isAlive = false;
            const deathMsg = createSystemMessage(`💀 ${username} disconnected (suicide).`, 'death');
            room.history.push(deathMsg);
            io.to(roomCode).emit('chat message', deathMsg);

            const victory = checkVictory(roomCode);
            if (victory) { endGame(roomCode, victory); return; }

            if (room.gameState === 'DAY') {
                checkInstantResolution(roomCode);
            }
        }

        room.members.delete(socket.id);

        // Don't auto-assign new leader on disconnect - leader must be set via /getleader
        if (room.leaderId === socket.id) {
            room.leaderId = null;
            io.to(roomCode).emit('leader_removed', {});
            broadcastRoomUsers(roomCode);
        }

        if (room.members.size === 0 && !room.isPermanent) {
            clearRoomTimer(roomCode);
            delete activeRooms[roomCode];
            return;
        }

        io.to(roomCode).emit('chat message', createSystemMessage(`${username} left.`));
        broadcastRoomUsers(roomCode);
    });
});

// ============================================================
// COMMAND HANDLER
// ============================================================

function handleCommand(socket, room, roomCode, member, text) {
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    const target = parts.slice(1).join(' ');
    const isLeader = socket.id === room.leaderId;

    if (command === '/help') {
        let commands = [];
        if (room.isMafiaRoom) {
            commands = ['/help', '/start (Host)', '/vote [name]', '/skip'];
            if (room.gameState === 'NIGHT') {
                if (member.role === ROLES.DON) commands.push('/kill [name]', '/checkSheriff [name]');
                if (member.role === ROLES.SHERIFF) commands.push('/investigate [name]');
            }
        } else {
            commands = ['/help', '/getleader', '/removeleader', '/kick [name]', '/mute [name]', '/unmute [name]'];
        }
        socket.emit('system message', { title: 'Commands:', commands });
        return;
    }

    if (command === '/getleader') {
        // If no leader exists, assign the command sender as leader
        if (!room.leaderId) {
            room.leaderId = socket.id;
            const newLeader = room.members.get(socket.id);
            io.to(roomCode).emit('chat message', createSystemMessage(`${newLeader?.username} is now Leader.`));
            // Broadcast leader update to all clients
            io.to(roomCode).emit('leader_updated', { 
                leaderId: socket.id, 
                leaderUsername: newLeader?.username 
            });
            broadcastRoomUsers(roomCode);
            return;
        }
        
        // If leader exists, just show who it is and broadcast to all
        const leader = room.members.get(room.leaderId);
        const leaderUsername = leader?.username || 'None';
        socket.emit('chat message', createSystemMessage(`Leader: ${leaderUsername}`));
        // Broadcast leader update to all clients
        if (leaderUsername !== 'None') {
            io.to(roomCode).emit('leader_updated', { 
                leaderId: room.leaderId, 
                leaderUsername 
            });
        }
        return;
    }

    if (command === '/removeleader') {
        if (!isLeader) {
            socket.emit('chat message', createSystemMessage('Only the current leader can step down.', 'error'));
            return;
        }
        room.leaderId = null;
        io.to(roomCode).emit('chat message', createSystemMessage(`${member.username} stepped down as leader.`));
        // Broadcast leader removal to all clients
        io.to(roomCode).emit('leader_updated', { 
            leaderId: null, 
            leaderUsername: null 
        });
        broadcastRoomUsers(roomCode);
        return;
    }

    if (command === '/kick' && isLeader) {
        const targetSocket = getSocketByUsername(roomCode, target);
        if (targetSocket && targetSocket.id !== socket.id) {
            targetSocket.emit('kicked', { message: 'Kicked.' });
            targetSocket.disconnect(true);
        }
        return;
    }

    if (command === '/mute' && isLeader) {
        if (target) { room.mutedUsers.add(target); broadcastRoomUsers(roomCode); }
        return;
    }

    if (command === '/unmute' && isLeader) {
        if (target) { room.mutedUsers.delete(target); broadcastRoomUsers(roomCode); }
        return;
    }

    // MAFIA-ONLY
    if (!room.isMafiaRoom) {
        socket.emit('chat message', createSystemMessage('This is a chat room, not a game lobby.', 'error'));
        return;
    }

    // Spectators cannot use game commands
    if (member.isSpectator) {
        socket.emit('chat message', createSystemMessage('Spectators cannot use game commands.', 'error'));
        return;
    }

    if (command === '/start') {
        if (!isLeader) { socket.emit('chat message', createSystemMessage('Only Leader.', 'error')); return; }
        if (room.gameState !== 'LOBBY') { socket.emit('chat message', createSystemMessage('Game running.', 'error')); return; }
        const count = [...room.members.values()].filter(m => !m.isSpectator).length;
        if (count < 5 || count > 20) { socket.emit('chat message', createSystemMessage('Need 5-20 players.', 'error')); return; }
        assignRoles(roomCode);
        return;
    }

    if (command === '/endday') {
        if (!isLeader) { socket.emit('chat message', createSystemMessage('Only Leader.', 'error')); return; }
        if (room.gameState !== 'DAY_1') { socket.emit('chat message', createSystemMessage('Only Day 1.', 'error')); return; }
        clearRoomTimer(roomCode);
        room.round++;
        startNightPhase(roomCode);
        return;
    }

    if (command === '/kill') {
        if (room.gameState !== 'NIGHT') { socket.emit('chat message', createSystemMessage('Night only.', 'error')); return; }
        if (member.role !== ROLES.DON) { socket.emit('chat message', createSystemMessage('Don only.', 'error')); return; }
        if (room.nightActions.donActed) { socket.emit('chat message', createSystemMessage('Already acted.', 'error')); return; }

        const targetMember = getMemberByUsername(roomCode, target);
        if (!targetMember || !targetMember.isAlive || targetMember.isSpectator) { socket.emit('chat message', createSystemMessage('Invalid target.', 'error')); return; }
        if (targetMember.role === ROLES.DON || targetMember.role === ROLES.MAFIA) { socket.emit('chat message', createSystemMessage('Not your team.', 'error')); return; }

        room.nightActions.mafiaKill = targetMember.username;
        room.nightActions.donActed = true;

        getMafiaTeam(roomCode).forEach(m => {
            const s = io.sockets.sockets.get(m.socketId);
            if (s) s.emit('chat message', createSystemMessage(`🎯 Target: ${targetMember.username}`, 'private'));
        });

        checkNightComplete(roomCode);
        return;
    }

    if (command === '/checksheriff') {
        if (room.gameState !== 'NIGHT') { socket.emit('chat message', createSystemMessage('Night only.', 'error')); return; }
        if (member.role !== ROLES.DON) { socket.emit('chat message', createSystemMessage('Don only.', 'error')); return; }
        if (room.nightActions.donActed) { socket.emit('chat message', createSystemMessage('Already acted.', 'error')); return; }

        const targetMember = getMemberByUsername(roomCode, target);
        if (!targetMember || !targetMember.isAlive || targetMember.isSpectator) { socket.emit('chat message', createSystemMessage('Invalid target.', 'error')); return; }

        room.nightActions.donActed = true;
        const isSheriff = targetMember.role === ROLES.SHERIFF;
        socket.emit('chat message', createSystemMessage(isSheriff ? `🕵️ ${targetMember.username} IS Sheriff!` : `❌ Not Sheriff.`, 'private'));

        checkNightComplete(roomCode);
        return;
    }

    if (command === '/investigate') {
        if (room.gameState !== 'NIGHT') { socket.emit('chat message', createSystemMessage('Night only.', 'error')); return; }
        if (member.role !== ROLES.SHERIFF) { socket.emit('chat message', createSystemMessage('Sheriff only.', 'error')); return; }
        if (room.nightActions.sheriffActed) { socket.emit('chat message', createSystemMessage('Already investigated.', 'error')); return; }

        const targetMember = getMemberByUsername(roomCode, target);
        if (!targetMember || !targetMember.isAlive || targetMember.isSpectator) { socket.emit('chat message', createSystemMessage('Invalid target.', 'error')); return; }

        room.nightActions.sheriffActed = true;
        const isMafia = targetMember.role === ROLES.DON || targetMember.role === ROLES.MAFIA;
        room.sheriffDiscoveries.set(targetMember.username, isMafia ? 'MAFIA' : 'TOWN');

        socket.emit('chat message', createSystemMessage(isMafia ? `🔴 ${targetMember.username} is MAFIA!` : `🟢 ${targetMember.username} is TOWN.`, 'private'));
        socket.emit('online users', getRoomUsers(roomCode, socket.id));

        checkNightComplete(roomCode);
        return;
    }

    if (command === '/vote') {
        if (room.gameState === 'DAY_1') { socket.emit('chat message', createSystemMessage('No voting Day 1.', 'error')); return; }
        if (room.gameState !== 'DAY') { socket.emit('chat message', createSystemMessage('Day only.', 'error')); return; }
        if (!member.isAlive) { socket.emit('chat message', createSystemMessage('Dead cannot vote.', 'error')); return; }

        const targetMember = getMemberByUsername(roomCode, target);
        if (!targetMember || !targetMember.isAlive || targetMember.isSpectator) { socket.emit('chat message', createSystemMessage('Invalid target.', 'error')); return; }

        room.skipVotes.delete(socket.id);

        if (member.votedFor) {
            const old = room.votes.get(member.votedFor) || 0;
            if (old > 1) room.votes.set(member.votedFor, old - 1);
            else room.votes.delete(member.votedFor);
        }

        member.hasVoted = true;
        member.votedFor = targetMember.username;
        room.members.set(socket.id, member);

        const count = (room.votes.get(targetMember.username) || 0) + 1;
        room.votes.set(targetMember.username, count);

        io.to(roomCode).emit('chat message', createSystemMessage(`🗳️ ${member.username} → ${targetMember.username} (${count})`));
        broadcastRoomUsers(roomCode);

        checkInstantResolution(roomCode);
        return;
    }

    if (command === '/skip') {
        if (room.gameState === 'DAY_1') { socket.emit('chat message', createSystemMessage('No skipping Day 1.', 'error')); return; }
        if (room.gameState !== 'DAY') { socket.emit('chat message', createSystemMessage('Day only.', 'error')); return; }
        if (!member.isAlive) { socket.emit('chat message', createSystemMessage('Dead cannot vote.', 'error')); return; }

        if (member.votedFor) {
            const old = room.votes.get(member.votedFor) || 0;
            if (old > 1) room.votes.set(member.votedFor, old - 1);
            else room.votes.delete(member.votedFor);
            member.votedFor = null;
        }

        room.skipVotes.add(socket.id);
        member.hasVoted = true;
        room.members.set(socket.id, member);

        io.to(roomCode).emit('chat message', createSystemMessage(`⏭️ ${member.username} voted to skip (${room.skipVotes.size})`));
        broadcastRoomUsers(roomCode);

        checkInstantResolution(roomCode);
        return;
    }

    socket.emit('chat message', createSystemMessage('Unknown command.', 'error'));
}

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
