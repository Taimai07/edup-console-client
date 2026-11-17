'use strict';
// GIGA browser bridge host. The class keeps the constructor; its methods live in giga-browser-io/intake/store.cjs
// and are attached to the prototype below (client round 1: move only).
const {fs, path, crypto, execFileSync, REGIONS, storeId, storeCode, productCode, controls, KNOWN_LIMIT, RATE_READ, READ_RECEIPT_TTL} = require('./giga-browser-shared.cjs');
class GigaBrowser {
  constructor({directory, now = () => Date.now() / 1000} = {}) { this.directory = directory; this.now = now; }
}
Object.assign(GigaBrowser.prototype, require('./giga-browser-io.cjs'));
Object.assign(GigaBrowser.prototype, require('./giga-browser-intake.cjs'));
Object.assign(GigaBrowser.prototype, require('./giga-browser-store.cjs'));
module.exports = {GigaBrowser, REGIONS};
