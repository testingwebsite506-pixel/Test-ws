# Chat App Backend

A real-time chat application backend built with Node.js, Express, Socket.io, Redis, and SQLite.

## Features

- **Real-time messaging** using Socket.io
- **Multiple chat rooms** support
- **User management** with authentication
- **Message persistence** using SQLite
- **Session management** using Redis
- **Typing indicators**
- **User presence tracking**
- **Message history**
- **Scalable architecture** with Redis adapter for multiple server instances

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Real-time Communication**: Socket.io
- **Session Store**: Redis
- **Database**: SQLite3
- **Additional**: CORS, dotenv

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd chat-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:
```
PORT=3000
NODE_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379
DATABASE_PATH=./database.db
```

## Prerequisites

- Node.js (v14 or higher)
- Redis server running locally or remotely
- npm or yarn package manager

## Running the Server

### Development mode:
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

The server will start on the port specified in your `.env` file (default: 3000).

## API Endpoints

### Users
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create a new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Rooms
- `GET /api/rooms` - Get all chat rooms
- `GET /api/rooms/:id` - Get room by ID
- `POST /api/rooms` - Create a new room
- `GET /api/rooms/:id/members` - Get room members
- `POST /api/rooms/:id/members` - Add member to room
- `DELETE /api/rooms/:id/members/:user_id` - Remove member from room

### Messages
- `GET /api/messages/room/:room_id` - Get messages for a room
- `GET /api/messages/:id` - Get specific message
- `DELETE /api/messages/:id` - Delete message

## Socket.io Events

### Emit (Client to Server)
- `join_room` - Join a chat room
  ```javascript
  socket.emit('join_room', { user_id, room_id, username });
  ```

- `send_message` - Send a message to room
  ```javascript
  socket.emit('send_message', { user_id, room_id, message, username });
  ```

- `typing` - Notify user is typing
  ```javascript
  socket.emit('typing', { room_id, username });
  ```

- `stop_typing` - Notify user stopped typing
  ```javascript
  socket.emit('stop_typing', { room_id, username });
  ```

- `get_messages` - Fetch message history
  ```javascript
  socket.emit('get_messages', { room_id, limit: 50, offset: 0 });
  ```

- `leave_room` - Leave a chat room
  ```javascript
  socket.emit('leave_room', { room_id, username });
  ```

### Listen (Server to Client)
- `receive_message` - Receive a message
- `user_joined` - User joined the room
- `user_left` - User left the room
- `user_typing` - User typing status
- `messages_list` - List of messages
- `error` - Error message

## Project Structure

```
chat-backend/
├── sockets/
│   └── chatSocket.js       # Socket.io event handlers
├── routes/
│   ├── users.js            # User API routes
│   ├── rooms.js            # Room API routes
│   └── messages.js         # Message API routes
├── database/
│   └── db.js               # SQLite database configuration
├── server.js               # Main server file
├── package.json            # Dependencies
├── .env.example            # Environment variables template
├── .gitignore              # Git ignore rules
└── README.md               # This file
```

## Database Schema

### Users
- `id` - Primary key
- `username` - Unique username
- `email` - Unique email address
- `password` - Hashed password
- `created_at` - Account creation timestamp
- `updated_at` - Last update timestamp

### Rooms
- `id` - Primary key
- `name` - Unique room name
- `description` - Room description
- `created_by` - User ID who created the room
- `created_at` - Room creation timestamp

### Messages
- `id` - Primary key
- `user_id` - Foreign key to users
- `room_id` - Foreign key to rooms
- `message` - Message content
- `created_at` - Message timestamp

### Room Members
- `id` - Primary key
- `room_id` - Foreign key to rooms
- `user_id` - Foreign key to users
- `joined_at` - Join timestamp

## Configuration

### Redis Configuration
Make sure Redis is running on the host and port specified in `.env`. You can start Redis with:
```bash
redis-server
```

### SQLite Configuration
SQLite database file will be created automatically at the path specified in `DATABASE_PATH` environment variable.

## Error Handling

The application includes comprehensive error handling for:
- Database operations
- Socket.io connections
- API endpoint errors
- Validation errors

## Future Enhancements

- User authentication with JWT
- Password hashing with bcrypt
- File/image sharing
- Direct messaging
- Message reactions
- User online status
- Read receipts
- Message search functionality
- User roles and permissions

## License

MIT
