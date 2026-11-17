// Module state of the listing runner shared by its files: the current state, stop / resume flags, listener set and task queue.
// Split out of listing-runner.js unchanged (client round 3); the module state the runner shares is `rs` in listing-runner-state.js.
import {KEY} from './listing-local.js';

export const rs = {state: {phase: 'idle', queue: 0}, stopRequested: false, resumeSignal: null};
export const listeners = new Set();
export const queue = [];
export function emit(patch) { rs.state = {...rs.state, ...patch, queue: queue.length}; for (const fn of listeners) fn(rs.state); }
export const persistQueue = () => localStorage.setItem(KEY.queue, JSON.stringify(queue));
