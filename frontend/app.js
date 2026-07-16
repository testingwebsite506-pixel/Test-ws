// Centrifugo connection
let centrifuge;
let currentUser = null;
let currentRoom = null;
const API_URL = window.location.origin;

// Determine Centrifugo URL based on environment
const getCentrifugoURL = () => {
  if (window.location.protocol === 'https:') {
    // Production: wss (secure websocket)
    return 'wss://' + window.location.host + '/connection/websocket';
  } else {
    // Development: ws (regular websocket)
    return 'ws://localhost:8000/connection/websocket';
  }
};

const CENTRIFUGO_URL = getCentrifugoURL();

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

    // Validate email
    if (!isValidEmail(email)) {
        alert('Please enter a valid email');
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

        // Get auth token for Centrifugo
        const tokenResponse = await fetch(`${API_URL}/api/centrifugo/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: user.id })
        });

        if (!tokenResponse.ok) {
            throw new Error('Failed to get Centrifugo token');
        }

        const { token } = await tokenResponse.json();

        // Initialize Centrifugo
        centrifuge = new Centrifuge(CENTRIFUGO_URL, {
            token: token,
            debug: false,
            maxReconnectDelay: 30000
        });

        setupCentrifugoListeners();

        // Connect
        centrifuge.connect();

    } catch (error) {
        console.error('Error joining chat:', error);
        alert('Error: ' + error.message);
    }
}

function setupCentrifugoListeners() {
    centrifuge.on('connect', () => {
        console.log('✅ Connected to Centrifugo');
        
        // Notify user online
        centrifuge.call('user_online', {
            user_id: currentUser.id,
            username: currentUser.username
        }).then(result => {
            console.log('User online response:', result);
            updateOnlineUsers(result.online_users);
            
            // Switch UI
            document.getElementById('loginSection').classList.remove('active');
            document.getElementById('chatSection').classList.add('active');
            document.getElementById('userInfo').innerHTML = `
                <div class="status"></div>
                <strong>${currentUser.username}</strong>
            `;

            // Load rooms
            loadRooms();
        }).catch(error => {
            console.error('Error marking user online:', error);
            alert('Failed to mark user online');
        });

        // Subscribe to user status channel
        const userStatusSub = centrifuge.newSubscription('user_status');
        
        userStatusSub.on('subscribe', () => {
            console.log('Subscribed to user_status channel');
        });

        userStatusSub.on('publication', (message) => {
            const { type, data } = message.data;
            if (type === 'user_status_changed') {
                handleUserStatusChange(data);
            }
        });

        userStatusSub.on('error', (err) => {
            console.error('User status subscription error:', err);
        });

        userStatusSub.subscribe();
    });

    centrifuge.on('disconnect', (ctx) => {
        console.log('⚠️ Disconnected from Centrifugo:', ctx.reason);
        alert('Connection lost. Please refresh the page.');
    });

    centrifuge.on('error', (error) => {
        console.error('❌ Centrifugo error:', error);
    });

    centrifuge.on('connect_error', (error) => {
        console.error('Connection error:', error);
    });
}

// Load Rooms
async function loadRooms() {
    try {
        const response = await fetch(`${API_URL}/api/rooms`);
        if (!response.ok) throw new Error('Failed to fetch rooms');
        
        const rooms = await response.json();
        displayRooms(rooms);
    } catch (error) {
        console.error('Error loading rooms:', error);
        alert('Failed to load rooms');
    }
}

function displayRooms(rooms) {
    const roomsList = document.getElementById('roomsList');
    roomsList.innerHTML = '';

    if (rooms.length === 0) {
        roomsList.innerHTML = '<p style="color: #999; font-size: 12px; padding: 10px;">No rooms available</p>';
        return;
    }

    rooms.forEach(room => {
        const roomItem = document.createElement('div');
        roomItem.className = 'room-item';
        if (currentRoom && currentRoom.id === room.id) {
            roomItem.classList.add('active');
        }
        roomItem.innerHTML = `
            <div class="room-name">${escapeHtml(room.name)}</div>
            <div class="room-desc">${escapeHtml(room.description || 'No description')}</div>
        `;
        roomItem.addEventListener('click', () => joinRoom(room, roomItem));
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

    if (name.length > 100) {
        alert('Room name must be less than 100 characters');
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
function joinRoom(room, roomItem) {
    if (currentRoom) {
        leaveCurrentRoom(false);
    }

    currentRoom = room;

    // Subscribe to room channel
    const roomSub = centrifuge.newSubscription(`room_${room.id}`);
    
    roomSub.on('subscribe', () => {
        console.log(`✅ Subscribed to room ${room.id}`);
        
        // Notify joined
        centrifuge.call('join_room', {
            user_id: currentUser.id,
            room_id: room.id,
            username: currentUser.username
        }).then(() => {
            // Get messages
            centrifuge.call('get_messages', {
                room_id: room.id,
                user_id: currentUser.id,
                limit: 50,
                offset: 0
            }).then(result => {
                displayMessages(result.messages);
            }).catch(error => {
                console.error('Error fetching messages:', error);
                alert('Failed to load messages');
            });
        }).catch(error => {
            console.error('Error joining room:', error);
            alert('Failed to join room');
        });
    });

    roomSub.on('publication', (message) => {
        const { type, data } = message.data;
        
        switch (type) {
            case 'receive_message':
                handleReceivedMessage(data);
                break;
            case 'user_joined':
                handleUserJoined(data);
                break;
            case 'user_left':
                handleUserLeft(data);
                break;
            case 'message_read':
                handleMessageRead(data);
                break;
            case 'user_typing':
                handleUserTyping(data);
                break;
        }
    });

    roomSub.on('error', (err) => {
        console.error('Room subscription error:', err);
    });

    roomSub.subscribe();

    // Update UI
    document.getElementById('currentRoomName').textContent = room.name;
    document.getElementById('currentRoomDesc').textContent = room.description || '';
    document.getElementById('messagesContainer').innerHTML = '';
    document.getElementById('leaveBtn').style.display = 'block';

    // Update active room indicator
    document.querySelectorAll('.room-item').forEach(item => {
        item.classList.remove('active');
    });
    roomItem.classList.add('active');
}

function leaveCurrentRoom(cleanup = true) {
    if (currentRoom) {
        centrifuge.call('leave_room', {
            room_id: currentRoom.id,
            username: currentUser.username
        }).catch(error => {
            console.error('Error leaving room:', error);
        });

        if (cleanup) {
            // Unsubscribe from room
            try {
                const roomSub = centrifuge.getSubscription(`room_${currentRoom.id}`);
                if (roomSub) {
                    roomSub.unsubscribe();
                }
            } catch (error) {
                console.error('Error unsubscribing from room:', error);
            }
        }

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

    if (message.length > 4096) {
        alert('Message is too long (max 4096 characters)');
        return;
    }

    centrifuge.call('send_message', {
        user_id: currentUser.id,
        room_id: currentRoom.id,
        message,
        username: currentUser.username
    }).then(() => {
        input.value = '';
        input.style.height = 'auto';
        centrifuge.call('stop_typing', {
            room_id: currentRoom.id,
            username: currentUser.username
        }).catch(error => console.error('Error stopping typing:', error));
    }).catch(error => {
        console.error('Error sending message:', error);
        alert('Failed to send message');
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
                <div class="message-header">${escapeHtml(data.username)}</div>
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

    // Mark as read if not own message
    if (!isOwn) {
        setTimeout(() => {
            centrifuge.call('mark_as_read', {
                message_id: data.id,
                user_id: currentUser.id,
                room_id: currentRoom.id,
                username: currentUser.username
            }).catch(error => console.error('Error marking as read:', error));
        }, 1000);
    }
}

function handleUserJoined(data) {
    const container = document.getElementById('messagesContainer');
    const message = document.createElement('div');
    message.className = 'message system-message';
    message.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">${escapeHtml(data.username)} joined the chat</div>
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
            <div class="message-text">${escapeHtml(data.username)} left the chat</div>
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
        list.innerHTML = '<p style="color: #999; font-size: 12px; padding: 10px;">No one online</p>';
        return;
    }

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item online';
        item.innerHTML = `
            <div class="user-avatar">${user.username[0].toUpperCase()}</div>
            <div class="user-details">
                <div class="user-name">${escapeHtml(user.username)}</div>
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
    // Refresh online users list
    centrifuge.call('get_online_users', {}).then(result => {
        updateOnlineUsers(result.online_users);
    }).catch(error => console.error('Error fetching online users:', error));
}

// Typing
let typingTimeout;
function handleTyping() {
    if (!currentRoom) return;

    if (typingTimeout) clearTimeout(typingTimeout);

    centrifuge.call('typing', {
        room_id: currentRoom.id,
        username: currentUser.username
    }).catch(error => console.error('Error sending typing:', error));

    typingTimeout = setTimeout(() => {
        centrifuge.call('stop_typing', {
            room_id: currentRoom.id,
            username: currentUser.username
        }).catch(error => console.error('Error stopping typing:', error));
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
                ${escapeHtml(usersList)} ${text}
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

// Utility Functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// Auto-expand textarea on input
document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('messageInput');
    if (textarea) {
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }
});

// Handle logout
window.addEventListener('beforeunload', () => {
    if (centrifuge && currentUser) {
        centrifuge.call('user_offline', {
            user_id: currentUser.id,
            username: currentUser.username
        }).catch(error => console.error('Error marking user offline:', error));
        centrifuge.disconnect();
    }
});

// Handle page visibility
document.addEventListener('visibilitychange', () => {
    if (document.hidden && centrifuge) {
        console.log('Page hidden - user may be inactive');
    } else if (!document.hidden && centrifuge) {
        console.log('Page visible - resuming connection');
    }
});
