'use strict';
// Requires and constants of the GIGA browser bridge. Moved out of giga-browser.cjs unchanged (client round 1).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const REGIONS = Object.freeze({DE: [81, 'DEU'], US: [223, 'USA'], GB: [222, 'GBR'], CA: [38, 'CAN'], JP: [107, 'JPN']});
const storeId = /^[1-9][0-9]{0,14}$/;
const storeCode = /^[A-Z0-9][A-Z0-9_.-]{0,39}$/;
const productCode = /^[A-Z0-9][A-Z0-9_.-]{2,39}$/;
const controls = /[\x00-\x1f\x7f]/;
const KNOWN_LIMIT = 3000;
const RATE_READ = ['RATE_LOW', 'RATE_NA', 'RATE_MEDIUM', 'RATE_HIGH'];
const READ_RECEIPT_TTL = 3 * 24 * 60 * 60;
module.exports = {fs, path, crypto, execFileSync, REGIONS, storeId, storeCode, productCode, controls, KNOWN_LIMIT, RATE_READ, READ_RECEIPT_TTL};
