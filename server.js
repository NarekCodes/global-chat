const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// DUAL-MODE: Chat + Mafia Game Engine (Final Version)
// ============================================================

const activeRooms = {};
const HISTORY_LIMIT = 200;

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
            isMuted: room.mutedUsers?.has(memberData.username)
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
        if ((memberData.role === ROLES.DON || memberData.role === ROLES.MAFIA) && memberData.isAlive) {
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
        if ((memberData.role === ROLES.SHERIFF || memberData.role === ROLES.VILLAGER) && memberData.isAlive) {
            town.push({ socketId, ...memberData });
        }
    }
    return town;
};

const getAliveCount = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return 0;
    return [...room.members.values()].filter(m => m.isAlive).length;
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
// MAFIA GAME PHASES
// ============================================================

const startNightPhase = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || !room.isMafiaRoom) return;

    room.gameState = 'NIGHT';
    room.nightActions = { mafiaKill: null, donActed: false, sheriffActed: false };

    const msg = createSystemMessage(`🌙 Night ${room.round} falls. Town sleeps...`, 'phase');
    room.history.push(msg);
    io.to(roomCode).emit('chat message', msg);
    io.to(roomCode).emit('phaseChange', { phase: 'NIGHT', round: room.round });

    // Notify players of their night actions
    const mafia = getMafiaTeam(roomCode);
    mafia.forEach(m => {
        const s = io.sockets.sockets.get(m.socketId);
        if (s) {
            const hint = m.role === ROLES.DON ? '/kill [name] or /checkSheriff [name]' : 'Discuss with team.';
            s.emit('chat message', createSystemMessage(hint, 'private'));
        }
    });

    for (const [socketId, memberData] of room.members) {
        if (memberData.role === ROLES.SHERIFF && memberData.isAlive) {
            const s = io.sockets.sockets.get(socketId);
            if (s) s.emit('chat message', createSystemMessage('/investigate [name]', 'private'));
        }
    }
    broadcastRoomUsers(roomCode);
};

const checkNightComplete = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || room.gameState !== 'NIGHT') return;

    // Wait for BOTH Don AND Sheriff to act
    const sheriffAlive = [...room.members.values()].some(m => m.role === ROLES.SHERIFF && m.isAlive);
    const donAlive = [...room.members.values()].some(m => m.role === ROLES.DON && m.isAlive);

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

    const msg = createSystemMessage(`☀️ Day 1. Introductions only. No voting or skipping allowed.`, 'phase');
    room.history.push(msg);
    io.to(roomCode).emit('chat message', msg);
    io.to(roomCode).emit('phaseChange', { phase: 'DAY_1', round: 1 });
    broadcastRoomUsers(roomCode);
};

const startDayPhase = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || !room.isMafiaRoom) return;

    // Morning Report
    if (room.nightActions?.mafiaKill) {
        const victim = room.nightActions.mafiaKill;
        const morningMsg = createSystemMessage(`☀️ Morning has broken. ${victim} was found dead.`, 'phase');
        room.history.push(morningMsg);
        io.to(roomCode).emit('chat message', morningMsg);
        eliminatePlayer(roomCode, victim, '');
    } else {
        const peacefulMsg = createSystemMessage(`☀️ Morning has broken. No one died last night.`, 'phase');
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
        memberData.hasVoted = false;
        memberData.votedFor = null;
        room.members.set(socketId, memberData);
    }

    const dayMsg = createSystemMessage(`Day ${room.round}. Use /vote [name] or /skip to end without elimination.`, 'phase');
    room.history.push(dayMsg);
    io.to(roomCode).emit('chat message', dayMsg);
    io.to(roomCode).emit('phaseChange', { phase: 'DAY', round: room.round });
    broadcastRoomUsers(roomCode);
};

const endGame = (roomCode, victory) => {
    const room = activeRooms[roomCode];
    if (!room) return;

    room.gameState = 'LOBBY';
    const msg = createSystemMessage(victory.message, 'victory');
    room.history.push(msg);
    io.to(roomCode).emit('chat message', msg);
    io.to(roomCode).emit('gameOver', victory);

    for (const [socketId, memberData] of room.members) {
        memberData.role = null;
        memberData.isAlive = true;
        memberData.hasVoted = false;
        room.members.set(socketId, memberData);
    }
    room.sheriffDiscoveries = new Map();
    broadcastRoomUsers(roomCode);
};

const assignRoles = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room) return;

    const members = [...room.members.entries()];
    const count = members.length;
    const mafiaCount = Math.max(1, Math.floor(count * 0.25));

    for (let i = members.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [members[i], members[j]] = [members[j], members[i]];
    }

    let mafiaAssigned = 0, sheriffAssigned = false;

    members.forEach(([socketId, memberData]) => {
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
    const startMsg = createSystemMessage(`🎮 Game started! ${count} players.`, 'game');
    room.history.push(startMsg);
    io.to(roomCode).emit('chat message', startMsg);

    setTimeout(() => startDay1Phase(roomCode), 2000);
};

const checkDayEnd = (roomCode) => {
    const room = activeRooms[roomCode];
    if (!room || room.gameState !== 'DAY') return;

    const aliveCount = getAliveCount(roomCode);
    const majority = Math.floor(aliveCount / 2) + 1;
    const skipCount = room.skipVotes.size;

    // Check if skip has majority
    if (skipCount >= majority) {
        const skipMsg = createSystemMessage(`🚫 Majority voted to skip. No elimination.`, 'phase');
        room.history.push(skipMsg);
        io.to(roomCode).emit('chat message', skipMsg);
        room.round++;
        setTimeout(() => startNightPhase(roomCode), 2000);
        return true;
    }

    // Check if any player has majority votes
    for (const [target, count] of room.votes) {
        if (count >= majority) {
            eliminatePlayer(roomCode, target, 'Voted out.');
            const victory = checkVictory(roomCode);
            if (victory) { endGame(roomCode, victory); return true; }
            setTimeout(() => startNightPhase(roomCode), 2000);
            return true;
        }
    }

    return false;
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
            members: new Map([[socket.id, { username, avatarUrl: socket.avatarUrl, isAlive: true }]]),
            leaderId: socket.id,
            mutedUsers: new Set(),
            isPermanent: false,
            isMafiaRoom: false
        };

        socket.join(roomCode);
        const msg = createSystemMessage(`${username} created the room.`);
        activeRooms[roomCode].history.push(msg);

        socket.emit('roomJoined', { roomCode, isLeader: true, isMafiaRoom: false });
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
                round: 0
            };
        }

        if (!activeRooms[roomCode]) {
            socket.emit('loginError', { title: 'Room Not Found', message: 'No room with this code.' });
            return;
        }

        const room = activeRooms[roomCode];

        if (room.isMafiaRoom && room.gameState !== 'LOBBY') {
            socket.emit('loginError', { title: 'Game In Progress', message: 'Wait for next game.' });
            return;
        }

        for (const [, m] of room.members) {
            if (m.username.toLowerCase() === username.toLowerCase()) {
                socket.emit('loginError', { title: 'Name Taken', message: 'Choose another.' });
                return;
            }
        }

        socket.username = username;
        socket.avatarUrl = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
        socket.roomCode = roomCode;

        room.members.set(socket.id, { username, avatarUrl: socket.avatarUrl, isAlive: true });
        if (!room.leaderId) room.leaderId = socket.id;

        socket.join(roomCode);
        const msg = createSystemMessage(`${username} joined.`);
        room.history.push(msg);
        io.to(roomCode).emit('chat message', msg);

        socket.emit('roomJoined', { roomCode, isLeader: socket.id === room.leaderId, isMafiaRoom: room.isMafiaRoom });
        socket.emit('loadHistory', room.history);
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

        if (room.isMafiaRoom && !member.isAlive) {
            socket.emit('chat message', createSystemMessage('Dead cannot speak.', 'error'));
            return;
        }

        if (room.isMafiaRoom && room.gameState === 'NIGHT') {
            if (member.role !== ROLES.DON && member.role !== ROLES.MAFIA) {
                socket.emit('chat message', createSystemMessage('🌙 Town sleeps.', 'error'));
                return;
            }

            const message = {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                username: `🔪 ${member.username}`,
                avatarUrl: member.avatarUrl,
                text, timestamp: new Date().toLocaleTimeString(),
                isSecret: true
            };
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

    socket.on('typing', () => { if (socket.roomCode) socket.to(socket.roomCode).emit('userTyping', socket.username); });
    socket.on('stopTyping', () => { if (socket.roomCode) socket.to(socket.roomCode).emit('userStopTyping', socket.username); });

    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !activeRooms[roomCode]) return;

        const room = activeRooms[roomCode];
        const member = room.members.get(socket.id);
        const username = member?.username || 'Unknown';

        if (room.isMafiaRoom && room.gameState !== 'LOBBY' && member?.isAlive) {
            member.isAlive = false;
            const deathMsg = createSystemMessage(`💀 ${username} disconnected (suicide).`, 'death');
            room.history.push(deathMsg);
            io.to(roomCode).emit('chat message', deathMsg);

            const victory = checkVictory(roomCode);
            if (victory) endGame(roomCode, victory);
        }

        room.members.delete(socket.id);

        if (room.leaderId === socket.id && room.members.size > 0) {
            room.leaderId = room.members.keys().next().value;
            const newLeader = room.members.get(room.leaderId);
            io.to(roomCode).emit('chat message', createSystemMessage(`${newLeader?.username} is now Leader.`));
        }

        if (room.members.size === 0 && !room.isPermanent) {
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
            commands = ['/help', '/getleader', '/kick [name]', '/mute [name]', '/unmute [name]'];
        }
        socket.emit('system message', { title: 'Commands:', commands });
        return;
    }

    if (command === '/getleader') {
        const leader = room.members.get(room.leaderId);
        socket.emit('chat message', createSystemMessage(`Leader: ${leader?.username || 'None'}`));
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

    // MAFIA-ONLY COMMANDS
    if (!room.isMafiaRoom) {
        socket.emit('chat message', createSystemMessage('This is a chat room, not a game lobby.', 'error'));
        return;
    }

    if (command === '/start') {
        if (!isLeader) { socket.emit('chat message', createSystemMessage('Only Leader.', 'error')); return; }
        if (room.gameState !== 'LOBBY') { socket.emit('chat message', createSystemMessage('Game running.', 'error')); return; }
        const count = room.members.size;
        if (count < 5 || count > 20) { socket.emit('chat message', createSystemMessage('Need 5-20 players.', 'error')); return; }
        assignRoles(roomCode);
        return;
    }

    if (command === '/endday') {
        if (!isLeader) { socket.emit('chat message', createSystemMessage('Only Leader.', 'error')); return; }
        if (room.gameState !== 'DAY_1') { socket.emit('chat message', createSystemMessage('Only Day 1.', 'error')); return; }
        room.round++;
        startNightPhase(roomCode);
        return;
    }

    if (command === '/kill') {
        if (room.gameState !== 'NIGHT') { socket.emit('chat message', createSystemMessage('Night only.', 'error')); return; }
        if (member.role !== ROLES.DON) { socket.emit('chat message', createSystemMessage('Don only.', 'error')); return; }
        if (room.nightActions.donActed) { socket.emit('chat message', createSystemMessage('Already acted.', 'error')); return; }

        const targetMember = getMemberByUsername(roomCode, target);
        if (!targetMember || !targetMember.isAlive) { socket.emit('chat message', createSystemMessage('Invalid target.', 'error')); return; }
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
        if (!targetMember || !targetMember.isAlive) { socket.emit('chat message', createSystemMessage('Invalid target.', 'error')); return; }

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
        if (!targetMember || !targetMember.isAlive) { socket.emit('chat message', createSystemMessage('Invalid target.', 'error')); return; }

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
        if (!targetMember || !targetMember.isAlive) { socket.emit('chat message', createSystemMessage('Invalid target.', 'error')); return; }

        // Remove from skip if was skipping
        room.skipVotes.delete(socket.id);

        // Remove old vote
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

        checkDayEnd(roomCode);
        return;
    }

    if (command === '/skip') {
        if (room.gameState === 'DAY_1') { socket.emit('chat message', createSystemMessage('No skipping Day 1.', 'error')); return; }
        if (room.gameState !== 'DAY') { socket.emit('chat message', createSystemMessage('Day only.', 'error')); return; }
        if (!member.isAlive) { socket.emit('chat message', createSystemMessage('Dead cannot vote.', 'error')); return; }

        // Remove previous vote if any
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

        checkDayEnd(roomCode);
        return;
    }

    socket.emit('chat message', createSystemMessage('Unknown command.', 'error'));
}

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
