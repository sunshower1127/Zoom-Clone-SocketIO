const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const wsServer = socketIo(httpServer);

// Set Pug as the template engine
app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Define a route
app.get("/", (req, res) => {
  res.render("index", { title: "Document", message: "Hello World" });
});

wsServer.on("connection", (socket) => {
  socket.on("join_room", (roomName) => {
    const roomExists = wsServer.sockets.adapter.rooms.has(roomName);
    socket.join(roomName);

    if (!roomExists) {
      // 방이 없었다면 처음 만든 사람
      socket.emit("room_created");
    } else {
      // 방이 있었다면 참여하는 사람
      socket.to(roomName).emit("welcome");
    }
  });
  socket.on("offer", (offer, roomName) => {
    socket.to(roomName).emit("offer", offer);
  });
  socket.on("answer", (answer, roomName) => {
    socket.to(roomName).emit("answer", answer);
  });
  socket.on("ice", (ice, roomName) => {
    socket.to(roomName).emit("ice", ice);
  });
});

const handleListen = () => console.log(`Listening on http://localhost:3000`);
httpServer.listen(3000, handleListen);
