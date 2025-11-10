/**
 * Minimal socket.io server for signaling + playback events
 * Run: node server.js
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Couple Watch Signaling Server'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join-room', ({ roomId, userId }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = userId;
    // inform others
    socket.to(roomId).emit('peer-joined', { peerId: socket.id });
    console.log(`${userId || socket.id} joined room ${roomId}`);
  });

  // Signal message passthrough (sdp / ice)
  socket.on('signal', ({ to, data }) => {
    if (!to) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Playback commands (play/pause/seek); broadcast to others in same room
  socket.on('playback-command', ({ roomId, cmd, currentTime, clientTs }) => {
    if (!roomId) return;
    socket.to(roomId).emit('playback-command', { cmd, currentTime, clientTs, from: socket.id });
  });

  socket.on('disconnect', () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('peer-left', { peerId: socket.id });
    }
    console.log('socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Signaling server running on :${PORT}`));
