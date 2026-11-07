import { EventEmitter } from 'node:events';

declare global {
  var __attendanceEmitter: EventEmitter | undefined;
}

if (!globalThis.__attendanceEmitter) {
  globalThis.__attendanceEmitter = new EventEmitter();
  globalThis.__attendanceEmitter.setMaxListeners(200);
}

export const attendanceEmitter = globalThis.__attendanceEmitter;
