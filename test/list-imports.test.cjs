const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const script = path.join(__dirname, '..', 'scripts', 'list-imports.cjs');
const {scan, folderOf, list, check} = require(script);

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'list-imports-'));
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, text);
  }
  return root;
}
const run = (...args) => spawnSync(process.execPath, [script, ...args], {encoding: 'utf8'});

test('folders are the first sub-folder under desktop, shared, ui and assets; files at the top of one belong to it', () => {
  assert.equal(folderOf('ui/app.js'), 'ui');
  assert.equal(folderOf('ui/listing/app.js'), 'ui/listing');
  assert.equal(folderOf('ui/listing/deep/x.js'), 'ui/listing');
  assert.equal(folderOf('desktop/main.cjs'), 'desktop');
  assert.equal(folderOf('shared/js/protocol.cjs'), 'shared/js');
  assert.equal(folderOf('package.json'), '.');
});

test('every import form is found, and text inside strings, comments, templates and regexes is not', () => {
  const src = [
    "import a from './a.js';",
    "import {b, c as d} from './b.js'",
    "import * as ns from './c.js';",
    "import './side.js';",
    "import e, {\n  f,\n  g\n} from './multi.js';",
    "export {h} from './h.js';",
    "export * from './star.js';",
    "export * as k from './k.js';",
    "export {local};",
    "export const x = 1; const note = 'from \"./nope1.js\"';",
    "const r = require('./r.cjs'); const e2 = require(\"electron\");",
    "// import './nope2.js'",
    "/* require('./nope3.js') */",
    "const t = `import './nope4.js' ${1 + 1}`;",
    "const re = /import '.\\/nope5.js'/g; const q = 4 / 2;",
    "obj.require('./nope6.js'); obj.import('./nope7.js');",
    "const meta = import.meta.url;"
  ].join('\n');
  const {specs, problems} = scan(src);
  assert.deepEqual(specs.sort(), ['./a.js', './b.js', './c.js', './h.js', './k.js', './multi.js', './r.cjs', './side.js', './star.js', 'electron'].sort());
  assert.deepEqual(problems, []);
});

test('dynamic import() and require(name) are reported as problems', () => {
  const {specs, problems} = scan("const m = await import('./x.js'); const y = require(name); const z = require('./ok.js');");
  assert.deepEqual(specs, ['./ok.js']);
  assert.deepEqual(problems, ['dynamic import()', 'require() with a name that is not a plain string']);
});

test('lists only the pairs that cross folders, sorted, with packages ignored and extensions resolved', () => {
  const root = fixture({
    'ui/app.js': "import {a} from './listing/a.js';\nimport {z} from './common/z.js';\nimport './app2.js';\nimport 'electron';",
    'ui/app2.js': 'export {};',
    'ui/listing/a.js': "import {x} from '../common/x.js';\nimport {same} from './same.js';",
    'ui/listing/same.js': 'export const same = 1;',
    'ui/common/x.js': 'export const x = 1;',
    'ui/common/z.js': 'export const z = 1;',
    'desktop/main.cjs': "const p = require('../shared/protocol.cjs'); const fs = require('node:fs'); const same = require('./other');",
    'desktop/other.cjs': 'module.exports = 1;',
    'shared/protocol.cjs': 'module.exports = {};',
    'ui/index.html': '<script type="module" src="app.js"></script><script src="human.js"></script><script src="./ai.js?v=1"></script><script>var inline = 1;</script>'
  });
  const out = list(root).client;
  assert.deepEqual(out.crossFolderImports, [
    ['desktop/main.cjs', 'shared/protocol.cjs'],
    ['ui/app.js', 'ui/common/z.js'],
    ['ui/app.js', 'ui/listing/a.js'],
    ['ui/listing/a.js', 'ui/common/x.js']
  ]);
  assert.deepEqual(out.classicScripts, ['ui/ai.js', 'ui/human.js']);
  assert.deepEqual(out.globals, ['EdupHuman', 'ai-iframe-message', 'localStorage:edup-A-snapshot', 'window.edup']);
  assert.equal(out.problems, undefined);
});

test('the command prints the same sorted JSON every time, and an unresolved import goes to problems', () => {
  const root = fixture({'ui/app.js': "import './missing.js';", 'ui/x.js': 'export {};'});
  const first = run('--root', root);
  const second = run('--root', root);
  assert.equal(first.status, 0);
  assert.equal(first.stdout, second.stdout);
  const json = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(json), ['client']);
  assert.deepEqual(json.client.problems, ["ui/app.js: can't find ./missing.js"]);
});

test('--check passes when the current pairs are a subset of the baseline and fails on anything new', () => {
  const root = fixture({
    'ui/app.js': "import './listing/a.js';\nimport './common/b.js';",
    'ui/listing/a.js': 'export {};',
    'ui/common/b.js': 'export {};',
    'ui/index.html': '<script src="ai.js"></script>'
  });
  const baseline = (extra = {}) => {
    const file = path.join(root, 'baseline.json');
    fs.writeFileSync(file, JSON.stringify({client: {
      crossFolderImports: [['ui/app.js', 'ui/common/b.js'], ['ui/app.js', 'ui/listing/a.js']],
      globals: ['window.edup', 'EdupHuman', 'ai-iframe-message', 'localStorage:edup-A-snapshot'],
      classicScripts: ['ui/ai.js'], ...extra
    }}));
    return file;
  };
  assert.equal(run('--root', root, '--check', baseline()).status, 0);
  // a baseline with more than needed is fine (the numbers may only go down)
  assert.equal(run('--root', root, '--check', baseline({crossFolderImports: [['ui/app.js', 'ui/common/b.js'], ['ui/app.js', 'ui/listing/a.js'], ['ui/x.js', 'ui/y/z.js']]})).status, 0);
  const missingPair = run('--root', root, '--check', baseline({crossFolderImports: [['ui/app.js', 'ui/common/b.js']]}));
  assert.equal(missingPair.status, 1);
  assert.match(missingPair.stderr, /new cross-folder import: ui\/app\.js -> ui\/listing\/a\.js/);
  const classic = run('--root', root, '--check', baseline({classicScripts: []}));
  assert.equal(classic.status, 1);
  assert.match(classic.stderr, /new classic <script>: ui\/ai\.js/);
  const glob = run('--root', root, '--check', baseline({globals: ['window.edup']}));
  assert.equal(glob.status, 1);
  assert.match(glob.stderr, /new global name/);
});

test('--check always fails on desktop/ using ui/ and on a dynamic import(), even if the baseline lists it', () => {
  const root = fixture({
    'desktop/main.cjs': "require('../ui/sku-rules.js');",
    'ui/sku-rules.js': 'module.exports = {};',
    'ui/app.js': "import('./x.js');",
    'ui/x.js': 'export {};'
  });
  const file = path.join(root, 'baseline.json');
  fs.writeFileSync(file, JSON.stringify({client: {crossFolderImports: [['desktop/main.cjs', 'ui/sku-rules.js']], globals: ['window.edup', 'EdupHuman', 'ai-iframe-message', 'localStorage:edup-A-snapshot'], classicScripts: []}}));
  const result = run('--root', root, '--check', file);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /desktop\/ must not use ui\//);
  assert.match(result.stderr, /ui\/app\.js: dynamic import\(\)/);
});

test('the one registered exception: desktop/bootstrap.cjs may require() a run-time name; other files may not', () => {
  const root = fixture({'desktop/bootstrap.cjs': "const e = 'x'; require(e);", 'desktop/other.cjs': "const e = 'x'; require(e);"});
  assert.deepEqual(list(root).client.problems, ['desktop/other.cjs: require() with a name that is not a plain string']);
});

test('a missing or broken baseline file is an error, not a pass', () => {
  const root = fixture({'ui/app.js': 'export {};'});
  assert.equal(run('--root', root, '--check', path.join(root, 'nope.json')).status, 2);
  assert.equal(run('--bogus').status, 2);
});

test('check() on the real client tree finds no dynamic import()', () => {
  const real = list(path.join(__dirname, '..')).client;
  assert.deepEqual((real.problems || []).filter(p => p.includes('dynamic import()')), []);
  assert.deepEqual(check({client: real}, {client: real}).filter(line => !line.startsWith('desktop/ must not use ui/')), []);
});
