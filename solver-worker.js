import { solve } from './solver.js';
self.onmessage = (e) => { self.postMessage(solve(e.data.game, e.data.opts)); };
