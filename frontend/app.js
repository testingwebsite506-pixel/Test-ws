// Socket.io connection
let socket;
let currentUser = null;
let currentRoom = null;
let messageId = 0;
const API_URL = 'http://localhost:3000';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

function setupEventListeners() {
    // Login
    document.getElementById('joinBtn').addEventListener('click', joinChat);
    document.getElementById('usernameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinChat();
    });

    // Chat
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    document.getElementById('messageInput').addEventListener('input', handleTyping);

    // Rooms
    document.getElementById('createRoomBtn').addEventListener('click', () => {
        openModal('createRoomModal');
    });
    document.getElementById('createRoomConfirmBtn').addEventListener('click', createRoom);

    // Leave Room
    document.getElementById('leaveBtn').addEventListener('click', leaveCurrentRoom);
}

// Join Chat
async function joinChat() {
    const username = document.getElementById('usernameInput').value.trim();
    const email = document.getElementById('emailInput').value.trim();

    if (!username || !email) {
        alert('Please enter username and email');
        return;
    }

    try {
        // Create user via API
        const response = await fetch(`${API_URL}/api/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create user');
        }

        const user = await response.json();
        currentUser = user;

        // Initialize Socket.io
        socket = io(API_URL, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: 5
        });

        setupSocketListeners();

        // Emit user online event
        socket.emit('user_online', {
            user_id: currentUser.id,
            username: currentUser.username
        });

        // Switch UI
        document.getElementById('loginSection').classList.remove('active');
        document.getElementById('chatSection').classList.add('active');
        document.getElementById('userInfo').innerHTML = `
            <div class="status"></div>
            <strong>${currentUser.username}</strong>
        `;

        // Load rooms and online users
        await loadRooms();
        socket.emit('get_online_users');
    } catch (error) {
        console.error('Error joining chat:', error);
        alert('Error: ' + error.message);
    }
}

function setupSocketListeners() {
    // Online users
    socket.on('online_users_list', updateOnlineUsers);
    socket.on('user_status_changed', handleUserStatusChange);

    // Messages
    socket.on('receive_message', handleReceivedMessage);
    socket.on('messages_list', displayMessages);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);

    // Typing
    socket.on('user_typing', handleUserTyping);

    // Read receipts
    socket.on('message_read', handleMessageRead);

    // Errors
    socket.on('error', (error) => {
        console.error('Socket error:', error);
        alert('Error: ' + error.message);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
}

// Load Rooms
async function loadRooms() {
    try {
        const response = await fetch(`${API_URL}/api/rooms`);
        const rooms = await response.json();
        displayRooms(rooms);
    } catch (error) {
        console.error('Error loading rooms:', error);
    }
}

function displayRooms(rooms) {
    const roomsList = document.getElementById('roomsList');
    roomsList.innerHTML = '';

    if (rooms.length === 0) {
        roomsList.innerHTML = '<p style="color: #999; font-size: 12px;">No rooms available</p>';
        return;
    }

    rooms.forEach(room => {
        const roomItem = document.createElement('div');
        roomItem.className = 'room-item';
        if (currentRoom && currentRoom.id === room.id) {
            roomItem.classList.add('active');
        }
        roomItem.innerHTML = `
            <div class="room-name">${room.name}</div>
            <div class="room-desc">${room.description || 'No description'}</div>
        `;
        roomItem.addEventListener('click', () => joinRoom(room));
        roomsList.appendChild(roomItem);
    });
}

// Create Room
async function createRoom() {
    const name = document.getElementById('roomNameInput').value.trim();
    const description = document.getElementById('roomDescInput').value.trim();

    if (!name) {
        alert('Room name is required');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                description,
                created_by: currentUser.id
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create room');
        }

        closeModal('createRoomModal');
        document.getElementById('roomNameInput').value = '';
        document.getElementById('roomDescInput').value = '';
        await loadRooms();
    } catch (error) {
        console.error('Error creating room:', error);
        alert('Error: ' + error.message);
    }
}

// Join Room
function joinRoom(room) {
    if (currentRoom) {
        socket.emit('leave_room', {
            room_id: currentRoom.id,
            username: currentUser.username
        });
    }

    currentRoom = room;

    socket.emit('join_room', {
        user_id: currentUser.id,
        room_id: room.id,
        username: currentUser.username
    });

    socket.emit('get_messages', {
        room_id: room.id,
        user_id: currentUser.id,
        limit: 50,
        offset: 0
    });

    // Update UI
    document.getElementById('currentRoomName').textContent = room.name;
    document.getElementById('currentRoomDesc').textContent = room.description || '';
    document.getElementById('messagesContainer').innerHTML = '';
    document.getElementById('leaveBtn').style.display = 'block';

    // Update active room indicator
    document.querySelectorAll('.room-item').forEach(item => {
        item.classList.remove('active');
    });
    event.target.closest('.room-item').classList.add('active');
}

function leaveCurrentRoom() {
    if (currentRoom) {
        socket.emit('leave_room', {
            room_id: currentRoom.id,
            username: currentUser.username
        });
        currentRoom = null;
        document.getElementById('currentRoomName').textContent = 'Select a room';
        document.getElementById('currentRoomDesc').textContent = '';
        document.getElementById('messagesContainer').innerHTML = '<div class="welcome-message"><p>Select a room to start chatting</p></div>';
        document.getElementById('leaveBtn').style.display = 'none';
    }
}

// Messages
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message || !currentRoom) {
        return;
    }

    socket.emit('send_message', {
        user_id: currentUser.id,
        room_id: currentRoom.id,
        message,
        username: currentUser.username
    });

    input.value = '';
    socket.emit('stop_typing', {
        room_id: currentRoom.id,
        username: currentUser.username
    });
}

function handleReceivedMessage(data) {
    displayMessage(data, false);
    // Auto-scroll to bottom
    const container = document.getElementById('messagesContainer');
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 100);
}

function displayMessages(messages) {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';

    if (messages.length === 0) {
        container.innerHTML = '<div class="welcome-message"><p>No messages yet. Start a conversation!</p></div>';
        return;
    }

    messages.forEach(msg => {
        displayMessage(msg, msg.user_id === currentUser.id);
    });

    // Auto-scroll to bottom
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 100);
}

function displayMessage(data, isOwn) {
    const container = document.getElementById('messagesContainer');
    const message = document.createElement('div');
    message.className = `message ${isOwn ? 'own' : ''}`;
    message.id = `msg-${data.id}`;

    const avatar = data.username[0].toUpperCase();
    const readByHTML = data.read_by && data.read_by.length > 0
        ? `<div class="read-receipts">${data.read_by.map(r => `<div class="read-receipt" title="${r.username}">${r.username[0]}</div>`).join('')}</div>`
        : '';

    const timestamp = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    message.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">
            <div class="message-bubble">
                <div class="message-header">${data.username}</div>
                <div class="message-text">${escapeHtml(data.message)}</div>
                <div class="message-footer">
                    <span>${timestamp}</span>
                    ${readByHTML}
                </div>
            </div>
        </div>
    `;

    if (container.querySelector('.welcome-message')) {
        container.innerHTML = '';
    }

    container.appendChild(message);

    // Mark as read if own message or after delay
    if (!isOwn) {
        setTimeout(() => {
            socket.emit('mark_as_read', {
                message_id: data.id,
                user_id: currentUser.id,
                room_id: currentRoom.id,
                username: currentUser.username
            });
        }, 1000);
    }
}

function handleUserJoined(data) {
    const container = document.getElementById('messagesContainer');
    const message = document.createElement('div');
    message.className = 'message system-message';
    message.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">${data.username} joined the chat</div>
        </div>
    `;
    container.appendChild(message);
}

function handleUserLeft(data) {
    const container = document.getElementById('messagesContainer');
    const message = document.createElement('div');
    message.className = 'message system-message';
    message.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">${data.username} left the chat</div>
        </div>
    `;
    container.appendChild(message);
}

// Read Receipts
function handleMessageRead(data) {
    const msgElement = document.getElementById(`msg-${data.message_id}`);
    if (msgElement) {
        const readByHTML = data.read_by.map(r => `<div class="read-receipt" title="${r.username}">${r.username[0]}</div>`).join('');
        const footer = msgElement.querySelector('.message-footer');
        if (footer) {
            let readReceipts = footer.querySelector('.read-receipts');
            if (!readReceipts) {
                readReceipts = document.createElement('div');
                readReceipts.className = 'read-receipts';
                footer.appendChild(readReceipts);
            }
            readReceipts.innerHTML = readByHTML;
        }
    }
}

// Online Users
function updateOnlineUsers(users) {
    const list = document.getElementById('onlineUsersList');
    list.innerHTML = '';

    const count = users.length;
    document.getElementById('onlineCount').textContent = count;

    if (count === 0) {
        list.innerHTML = '<p style="color: #999; font-size: 12px;">No one online</p>';
        return;
    }

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item online';
        item.innerHTML = `
            <div class="user-avatar">${user.username[0].toUpperCase()}</div>
            <div class="user-details">
                <div class="user-name">${user.username}</div>
                <div class="user-status">
                    <span class="status-dot"></span>
                    <span>Online</span>
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

function handleUserStatusChange(data) {
    if (data.status === 'online') {
        socket.emit('get_online_users');
    } else {
        socket.emit('get_online_users');
    }
}

// Typing
let typingTimeout;
function handleTyping() {
    if (!currentRoom) return;

    if (typingTimeout) clearTimeout(typingTimeout);

    socket.emit('typing', {
        room_id: currentRoom.id,
        username: currentUser.username
    });

    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing', {
            room_id: currentRoom.id,
            username: currentUser.username
        });
    }, 3000);
}

let typingUsers = {};
function handleUserTyping(data) {
    if (data.is_typing) {
        typingUsers[data.username] = true;
    } else {
        delete typingUsers[data.username];
    }
    updateTypingIndicator();
}

function updateTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    const users = Object.keys(typingUsers);

    if (users.length === 0) {
        indicator.classList.remove('active');
        indicator.innerHTML = '';
    } else {
        indicator.classList.add('active');
        const usersList = users.join(', ');
        const text = users.length === 1 ? 'is typing' : 'are typing';
        indicator.innerHTML = `
            <div class="typing-text">
                ${usersList} ${text}
                <span class="typing-dots">
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                </span>
            </div>
        `;
    }
}

// Modal
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle logout
window.addEventListener('beforeunload', () => {
    if (socket && currentUser) {
        socket.emit('user_offline', {
            user_id: currentUser.id,
            username: currentUser.username
        });
    }
});
