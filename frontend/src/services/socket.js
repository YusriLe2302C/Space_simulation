import { io } from "socket.io-client";
import { SOCKET_URL, EVT_STATE_UPDATE } from "../utils/constants";

// ── Singleton ─────────────────────────────────────────────────────────────────
// Created once on first import. All hooks share this connection.
// autoConnect: false so we control exactly when the handshake happens.
const socket = io(SOCKET_URL, {
  autoConnect:          false,
  reconnection:         true,
  reconnectionAttempts: Infinity,
  reconnectionDelay:    1000,
  reconnectionDelayMax: 15000,
  randomizationFactor:  0.4,
  timeout:              10000,
  transports:           ["websocket"],  // skip long-polling entirely
});

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

/** Open the connection (idempotent). */
export function connectSocket() {
  if (!socket.connected) socket.connect();
}

/** Close the connection (idempotent). */
export function disconnectSocket() {
  if (socket.connected) socket.disconnect();
}

// ── Typed subscription helpers ────────────────────────────────────────────────
// These return unsubscribe functions so hooks can clean up in useEffect returns.

/**
 * Subscribe to "state_update" events.
 * @param {(payload: StateUpdatePayload) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onStateUpdate(handler) {
  socket.on(EVT_STATE_UPDATE, handler);
  return () => socket.off(EVT_STATE_UPDATE, handler);
}

/**
 * Subscribe to connection lifecycle events.
 * @param {{ onConnect?: () => void, onDisconnect?: (reason: string) => void, onError?: (err: Error) => void }} callbacks
 * @returns {() => void} unsubscribe
 */
export function onConnectionChange({ onConnect, onDisconnect, onError } = {}) {
  if (onConnect)    socket.on("connect",       onConnect);
  if (onDisconnect) socket.on("disconnect",    onDisconnect);
  if (onError)      socket.on("connect_error", onError);

  return () => {
    if (onConnect)    socket.off("connect",       onConnect);
    if (onDisconnect) socket.off("disconnect",    onDisconnect);
    if (onError)      socket.off("connect_error", onError);
  };
}

/** True if the socket is currently connected. */
export function isConnected() {
  return socket.connected;
}

export default socket;
