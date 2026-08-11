// ============================================================
// socket.js — Socket.io tekil (singleton) bağlantı yardımcısı
// ============================================================

import { io } from 'socket.io-client';
import { getToken } from './auth';

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

let socketInstance = null;

export function getSocket() {
  if (socketInstance) return socketInstance;
  socketInstance = io(BASE_URL, {
    auth: { token: getToken() },
    autoConnect: true,
  });
  return socketInstance;
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
