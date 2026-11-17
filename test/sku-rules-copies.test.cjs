const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// desktop/import.cjs may not reach into ui/, but the interface can only load files under ui/ (ui-assets.cjs serves nothing else),
// so the SKU-code rules live in two places. They must stay byte for byte the same.
test('shared/sku-rules.js (desktop) and ui/listing/sku-rules.js (interface) are the same file, byte for byte', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '..', name));
  assert.ok(read('shared/sku-rules.js').equals(read('ui/listing/sku-rules.js')));
});

test('desktop/import.cjs takes the rules from shared/, not from ui/', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'import.cjs'), 'utf8');
  assert.match(text, /require\('\.\.\/shared\/sku-rules\.js'\)/);
  assert.doesNotMatch(text, /\.\.\/ui\//);
});
