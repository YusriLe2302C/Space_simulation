let ioInstance = null;

function initSocket(io) {
  ioInstance = io;
}

function getIO() {
  if (!ioInstance) {
    const err = new Error("Socket.IO not initialized");
    err.statusCode = 500;
    throw err;
  }
  return ioInstance;
}

function broadcast(event, payload, runId) {
  if (!ioInstance) return;
  if (runId) {
    ioInstance.to(runId).emit(event, payload);
  } else {
    ioInstance.emit(event, payload);
  }
}

module.exports = { initSocket, getIO, broadcast };
