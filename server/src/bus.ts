import { EventEmitter } from 'node:events';
import type { Capture } from './types';

class Bus extends EventEmitter {}

export const bus = new Bus();
bus.setMaxListeners(100);

export function emitUpdate(capture: Capture): void {
  bus.emit('update', capture);
}

export function emitRemoved(id: string): void {
  bus.emit('removed', id);
}
