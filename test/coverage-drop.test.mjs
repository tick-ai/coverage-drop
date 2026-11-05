import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../coverage-drop.mjs', import.meta.url));

// Runs the tool in a fresh folder holding `files` (name -> text); removes the folder afterwards.
function run(args, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-drop-test-'));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: dir, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lcov = (...records) => records.join('');
const rec = (path, lines = [], extra = []) =>
  `SF:${path}\n` + lines.map(([n, h]) => `DA:${n},${h}\n`).join('') + extra.map((l) => l + '\n').join('') + 'end_of_record\n';

function json(base, head, extraArgs = [], extraFiles = {}) {
  const r = run(['base.info', 'head.info', '--json', ...extraArgs], { 'base.info': base, 'head.info': head, ...extraFiles });
  return { ...r, report: r.out ? JSON.parse(r.out) : null };
}

function plain(base, head, extraArgs = [], extraFiles = {}) {
  return run(['base.info', 'head.info', ...extraArgs], { 'base.info': base, 'head.info': head, ...extraFiles });
}

const EXAMPLE_BASE = lcov(
  rec('src/a.js', [[1, 1], [2, 0], [3, 0], [4, 1]]),
  rec('src/d.js', [[1, 1], [2, 0]]),
  rec('src/same.js', [[1, 1]]),
  rec('src/z.js', [[1, 1]]),
);
const EXAMPLE_HEAD = lcov(
  rec('src/a.js', [[1, 1], [2, 0], [3, 1], [4, 1]]),
  rec('src/e.js', [[1, 0], [2, 1]]),
  rec('src/same.js', [[1, 1]]),
  rec('src/z.js', [[1, 1]]),
);

// ------------------------------------------------------------ help and usage

test('--help prints a usage line and exits 0, whatever else is given', () => {
  for (const args of [['--help'], ['--bogus', '--help'], ['a', 'b', 'c', '--help'], ['--json', '--markdown', '--help'], ['--help', '--fail-on-drop']]) {
    const r = run(args);
    assert.equal(r.code, 0, args.join(' '));
    assert.match(r.out, /coverage-drop/);
    assert.equal(r.err, '');
  }
});

test('--help as the value of an option is a value, not help', () => {
  const r = run(['a.info', 'b.info', '--diff', '--help']);
  assert.equal(r.code, 3);
  assert.equal(r.out, '');
  const r2 = run(['--root', '--help']);
  assert.equal(r2.code, 2);
  assert.equal(r2.out, '');
});

test('usage errors: stderr message, empty stdout, status 2', () => {
  const ok = { 'b.info': rec('a.js', [[1, 1]]), 'h.info': rec('a.js', [[1, 1]]) };
  const cases = [
    [['b.info', 'h.info', '--nope']],
    [['b.info', 'h.info', '-']],
    [['b.info', 'h.info', '--root=/x']],
    [['b.info', 'h.info', '--diff']],
    [['b.info', 'h.info', '--root']],
    [['b.info', 'h.info', '--fail-on-drop']],
    [['b.info', 'h.info', '--diff', '']],
    [['b.info', 'h.info', '--root', '/']],
    [['b.info', 'h.info', '--root', '.']],
    [['b.info', 'h.info', '--root', './']],
    [['b.info', 'h.info', '--root', '']],
    [['b.info', 'h.info', '--fail-on-drop', 'x']],
    [['b.info', 'h.info', '--fail-on-drop', '-1']],
    [['b.info', 'h.info', '--fail-on-drop', '1.']],
    [['b.info', 'h.info', '--fail-on-drop', '.5']],
    [['b.info', 'h.info', '--fail-on-drop', '1e2']],
    [['b.info', 'h.info', '--fail-on-drop', '']],
    [['b.info', 'h.info', '--json', '--markdown']],
    [['b.info']],
    [['b.info', 'h.info', 'c.info']],
    [[]],
    [['b.info', 'h.info', '--fail-on-untested']],
  ];
  for (const [args] of cases) {
    const r = run(args, ok);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.equal(r.out, '', JSON.stringify(args));
    assert.notEqual(r.err, '', JSON.stringify(args));
  }
});

test('usage errors win over missing files', () => {
  const r = run(['missing1.info', 'missing2.info', '--bogus']);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
});

test('options and files may come in any order', () => {
  const files = { 'b.info': rec('a.js', [[1, 1]]), 'h.info': rec('a.js', [[1, 0]]), 'x.diff': '' };
  const r = run(['--json', '--diff', 'x.diff', 'b.info', '--root', '/q', 'h.info'], files);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).total.lines.change, -100);
});

// ------------------------------------------------------------ read errors

test('unreadable files give status 3 and nothing on stdout', () => {
  const files = { 'b.info': rec('a.js', [[1, 1]]), 'h.info': rec('a.js', [[1, 1]]) };
  assert.equal(run(['b.info', 'missing.info'], files).code, 3);
  assert.equal(run(['missing.info', 'h.info'], files).code, 3);
  assert.equal(run(['b.info', 'h.info', '--diff', 'missing.diff'], files).code, 3);
  for (const args of [['b.info', 'missing.info'], ['b.info', 'h.info', '--diff', 'missing.diff', '--json']]) {
    const r = run(args, files);
    assert.equal(r.out, '');
    assert.notEqual(r.err, '');
  }
});

test('a folder given as a coverage file or diff gives status 3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-drop-test-'));
  try {
    mkdirSync(join(dir, 'folder'));
    writeFileSync(join(dir, 'ok.info'), rec('a.js', [[1, 1]]));
    const run3 = (args) => spawnSync(process.execPath, [TOOL, ...args], { cwd: dir, encoding: 'utf8' });
    for (const args of [['folder', 'ok.info'], ['ok.info', 'folder'], ['ok.info', 'ok.info', '--diff', 'folder']]) {
      const r = run3(args);
      assert.equal(r.status, 3, args.join(' '));
      assert.equal(r.stdout, '');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------ reports and example

test('plain report of the example', () => {
  const r = plain(EXAMPLE_BASE, EXAMPLE_HEAD);
  assert.equal(r.code, 0);
  assert.equal(
    r.out,
    [
      'coverage-drop: total 62.50% -> 75.00% (+12.50 points)',
      '',
      'Files:',
      '  src/a.js: 50.00% -> 75.00% (+25.00 points)',
      '  src/d.js: 50.00% -> - (removed file)',
      '  src/e.js: - -> 50.00% (new file)',
      '',
    ].join('\n'),
  );
});

test('markdown report of the example', () => {
  const r = plain(EXAMPLE_BASE, EXAMPLE_HEAD, ['--markdown']);
  assert.equal(r.code, 0);
  assert.equal(
    r.out,
    [
      '## coverage-drop: total 62.50% -> 75.00% (+12.50 points)',
      '',
      '| File | Before | After | Change |',
      '|---|---|---|---|',
      '| `src/a.js` | 50.00% | 75.00% | +25.00 points |',
      '| `src/d.js` | 50.00% | - | removed file |',
      '| `src/e.js` | - | 50.00% | new file |',
      '',
    ].join('\n'),
  );
});

test('json report of the example has the stated shape', () => {
  const { report, code } = json(EXAMPLE_BASE, EXAMPLE_HEAD);
  assert.equal(code, 0);
  assert.equal(report.tool, 'coverage-drop');
  assert.equal(report.version, '0.1.0');
  assert.deepEqual(report.total.lines, {
    before: { found: 8, hit: 5, percent: 62.5 },
    after: { found: 8, hit: 6, percent: 75 },
    change: 12.5,
  });
  assert.deepEqual(report.total.branches, {
    before: { found: 0, hit: 0, percent: null },
    after: { found: 0, hit: 0, percent: null },
    change: null,
  });
  assert.deepEqual(report.files.map((f) => [f.file, f.status]), [
    ['src/a.js', 'changed'],
    ['src/d.js', 'removed'],
    ['src/e.js', 'added'],
    ['src/same.js', 'unchanged'],
    ['src/z.js', 'unchanged'],
  ]);
  assert.deepEqual(report.files[0].lines, {
    before: { found: 4, hit: 2, percent: 50 },
    after: { found: 4, hit: 3, percent: 75 },
    change: 25,
  });
  assert.equal(report.files[1].lines.after, null);
  assert.equal(report.files[1].lines.change, null);
  assert.equal(report.files[2].lines.before, null);
  assert.equal(report.files[2].lines.change, null);
  assert.deepEqual(report.new_files, ['src/e.js']);
  assert.deepEqual(report.removed_files, ['src/d.js']);
  assert.equal(report.untested, null);
  assert.deepEqual(report.failures, []);
});

test('json prints exactly one object and ends with a newline', () => {
  const r = json(EXAMPLE_BASE, EXAMPLE_HEAD);
  assert.ok(r.out.endsWith('\n'));
  assert.doesNotThrow(() => JSON.parse(r.out));
});

test('all unchanged files: only the total line', () => {
  const same = lcov(rec('a.js', [[1, 1], [2, 0]]));
  assert.equal(plain(same, same).out, 'coverage-drop: total 50.00% -> 50.00% (0.00 points)\n');
  assert.equal(plain(same, same, ['--markdown']).out, '## coverage-drop: total 50.00% -> 50.00% (0.00 points)\n');
});

test('empty reports: n/a totals', () => {
  const r = plain('', '');
  assert.equal(r.out, 'coverage-drop: total n/a -> n/a (n/a)\n');
  assert.equal(plain('', '', ['--markdown']).out, '## coverage-drop: total n/a -> n/a (n/a)\n');
  const j = json('', '').report;
  assert.deepEqual(j.total.lines, {
    before: { found: 0, hit: 0, percent: null },
    after: { found: 0, hit: 0, percent: null },
    change: null,
  });
  assert.deepEqual(j.files, []);
  assert.deepEqual(j.new_files, []);
  assert.deepEqual(j.removed_files, []);
});

test('a file with a record but no valid DA lines has 0 lines (n/a)', () => {
  const r = plain(lcov(rec('e.js')), lcov(rec('e.js')));
  assert.equal(r.out, 'coverage-drop: total n/a -> n/a (n/a)\n');
  const j = json(lcov(rec('e.js')), lcov(rec('e.js'), rec('f.js'))).report;
  assert.equal(j.files[0].status, 'unchanged');
  assert.equal(j.files[1].status, 'added');
  assert.equal(plain(lcov(rec('e.js')), lcov(rec('e.js'), rec('f.js'))).out.includes('  f.js: - -> n/a (new file)'), true);
});

test('n/a cell and null change in a changed file', () => {
  const r = plain(lcov(rec('a.js')), lcov(rec('a.js', [[1, 1]])));
  assert.equal(
    r.out,
    'coverage-drop: total n/a -> 100.00% (n/a)\n\nFiles:\n  a.js: n/a -> 100.00% (n/a)\n',
  );
});

test('zero change prints 0.00 points and is the number 0 in json', () => {
  const b = lcov(rec('a.js', [[1, 1], [2, 0]]));
  const h = lcov(rec('a.js', [[1, 0], [2, 1]]));
  const { report } = json(b, h);
  assert.equal(report.total.lines.change, 0);
  assert.equal(report.files[0].status, 'unchanged');
  assert.ok(plain(b, h).out.startsWith('coverage-drop: total 50.00% -> 50.00% (0.00 points)\n'));
});

test('status uses lines only: a branch-only change is unchanged', () => {
  const b = lcov(rec('a.js', [[1, 1]], ['BRDA:1,0,0,0']));
  const h = lcov(rec('a.js', [[1, 1]], ['BRDA:1,0,0,3']));
  const { report, out } = json(b, h);
  assert.equal(report.files[0].status, 'unchanged');
  assert.deepEqual(report.files[0].branches, {
    before: { found: 1, hit: 0, percent: 0 },
    after: { found: 1, hit: 1, percent: 100 },
    change: 100,
  });
  assert.deepEqual(report.total.branches.change, 100);
  assert.equal(plain(b, h).out, 'coverage-drop: total 100.00% -> 100.00% (0.00 points)\n');
});

test('negative change prints with a minus sign', () => {
  const b = lcov(rec('a.js', [[1, 1], [2, 1], [3, 1], [4, 1]]));
  const h = lcov(rec('a.js', [[1, 1], [2, 1], [3, 1], [4, 0]]));
  assert.equal(
    plain(b, h).out,
    'coverage-drop: total 100.00% -> 75.00% (-25.00 points)\n\nFiles:\n  a.js: 100.00% -> 75.00% (-25.00 points)\n',
  );
});

// ------------------------------------------------------------ rounding

test('percentages are rounded half up to two decimals; change is the difference of rounded values', () => {
  const mk = (hit, found) => lcov(rec('a.js', Array.from({ length: found }, (_, i) => [i + 1, i < hit ? 1 : 0])));
  const pct = (hit, found) => json(mk(hit, found), mk(hit, found)).report.total.lines.after.percent;
  assert.equal(pct(1, 32), 3.13);
  assert.equal(pct(3, 32), 9.38);
  assert.equal(pct(2, 3), 66.67);
  assert.equal(pct(1, 3), 33.33);
  assert.equal(pct(1, 8), 12.5);
  assert.equal(pct(1, 200), 0.5);
  assert.equal(pct(0, 5), 0);
  assert.equal(pct(5, 5), 100);
  const { report } = json(mk(4, 7), mk(4, 6));
  assert.equal(report.total.lines.before.percent, 57.14);
  assert.equal(report.total.lines.after.percent, 66.67);
  assert.equal(report.total.lines.change, 9.53);
  assert.ok(plain(mk(1, 200), mk(1, 200)).out.includes('0.50% -> 0.50%'));
});

// ------------------------------------------------------------ LCOV reader

test('totals are recomputed from DA lines; LF/LH/BRF/BRH/FN* are ignored', () => {
  const l = [
    'SF:a.js', 'FN:1,f', 'FNDA:9,f', 'FNF:1', 'FNH:1', 'DA:1,1', 'DA:2,0', 'LF:100', 'LH:100', 'BRF:9', 'BRH:9', 'end_of_record', '',
  ].join('\n');
  const { report } = json(l, l);
  assert.deepEqual(report.total.lines.after, { found: 2, hit: 1, percent: 50 });
  assert.deepEqual(report.total.branches.after, { found: 0, hit: 0, percent: null });
});

test('malformed DA lines are ignored', () => {
  const bad = [
    'DA:0,1', 'DA:-1,1', 'DA:1.5,1', 'DA:1,-1', 'DA:1,1.5', 'DA: 1,1', 'DA:1, 1', 'DA:1', 'DA:1,1,x,y', 'DA:,1', 'DA:1,', 'DA:a,b', 'DA:1;1', 'DA:+1,1', 'DA:00,1', 'DA:1e1,1',
  ];
  const l = ['SF:a.js', ...bad, 'DA:7,1', 'DA:8,0,abc', 'end_of_record', ''].join('\n');
  const { report } = json(l, l);
  assert.deepEqual(report.total.lines.after, { found: 2, hit: 1, percent: 50 });
});

test('duplicate DA lines and duplicate records of one file merge; executed in any', () => {
  const l = [
    'SF:a.js', 'DA:1,0', 'DA:1,3', 'DA:2,0', 'DA:2,0', 'end_of_record',
    'SF:./a.js', 'DA:2,0', 'DA:3,1', 'DA:3,0', 'end_of_record', '',
  ].join('\n');
  const { report } = json(l, l);
  assert.equal(report.files.length, 1);
  assert.deepEqual(report.total.lines.after, { found: 3, hit: 2, percent: 66.67 });
});

test('a line seen with hits in a later duplicate is executed', () => {
  const l = ['SF:a.js', 'DA:1,0', 'end_of_record', 'SF:a.js', 'DA:1,5', 'end_of_record', ''].join('\n');
  assert.deepEqual(json(l, l).report.total.lines.after, { found: 1, hit: 1, percent: 100 });
});

test('BRDA rules: four fields, digits or "-", identity, merging', () => {
  const l = [
    'SF:a.js',
    'DA:1,1',
    'BRDA:1,0,0,1', // taken
    'BRDA:1,0,1,-', // never taken
    'BRDA:1,0,1,0', // same identity, not taken
    'BRDA:2,0,0,-',
    'BRDA:2,0,0,4', // same identity as above: taken
    'BRDA:0,0,0,1', // line 0: invalid
    'BRDA:3,,0,1', // empty block
    'BRDA:3,0,,1', // empty branch
    'BRDA:3,0,0', // three fields
    'BRDA:3,0,0,1,1', // five fields
    'BRDA:3,0,0,x', // bad taken
    'BRDA:3,0,0,-1', // bad taken
    'BRDA:x,0,0,1', // bad line
    'BRDA:4,a,b,2', // taken
    'end_of_record',
    '',
  ].join('\n');
  const { report } = json(l, l);
  assert.deepEqual(report.total.branches.after, { found: 4, hit: 3, percent: 75 });
});

test('DA and BRDA outside a record are ignored', () => {
  const l = ['DA:1,1', 'BRDA:1,0,0,1', 'SF:a.js', 'DA:2,1', 'end_of_record', 'DA:3,1', 'BRDA:3,0,0,1', ''].join('\n');
  const { report } = json(l, l);
  assert.deepEqual(report.total.lines.after, { found: 1, hit: 1, percent: 100 });
  assert.equal(report.total.branches.after.found, 0);
});

test('a record without end_of_record ends at the next SF or at the end of the input', () => {
  const l = ['SF:a.js', 'DA:1,1', 'SF:b.js', 'DA:1,0', 'DA:2,1'].join('\n');
  const { report } = json(l, l);
  assert.deepEqual(report.files.map((f) => [f.file, f.lines.after.found, f.lines.after.hit]), [
    ['a.js', 1, 1],
    ['b.js', 2, 1],
  ]);
});

test('CRLF, byte-order mark, TN lines and unknown lines are tolerated', () => {
  const l = '﻿TN:name\r\nSF:a.js\r\nWHAT:ever\r\n\r\nDA:1,1\r\nDA:2,0\r\nend_of_record\r\n';
  const { report } = json(l, l);
  assert.equal(report.files[0].file, 'a.js');
  assert.deepEqual(report.total.lines.after, { found: 2, hit: 1, percent: 50 });
});

test('lines are not trimmed: indented lines are unknown', () => {
  const l = ['SF:a.js', ' DA:1,1', 'DA:2,1', ' end_of_record', 'DA:3,1', ''].join('\n');
  const { report } = json(l, l);
  assert.deepEqual(report.total.lines.after, { found: 2, hit: 2, percent: 100 });
});

test('lines before the first SF are ignored; a record with an empty path is ignored', () => {
  const l = ['DA:1,1', 'SF:', 'DA:1,1', 'end_of_record', 'SF:./', 'DA:1,1', 'end_of_record', 'SF:a.js', 'DA:5,1', 'end_of_record', ''].join('\n');
  const { report } = json(l, l);
  assert.deepEqual(report.files.map((f) => f.file), ['a.js']);
});

// ------------------------------------------------------------ paths

test('backslashes and ./ segments are normalised so the same file matches', () => {
  const b = lcov(rec('./src/a.js', [[1, 0]]), rec('x\\y\\b.js', [[1, 1]]));
  const h = lcov(rec('src\\a.js', [[1, 1]]), rec('x/./y/b.js', [[1, 1]]));
  const { report } = json(b, h);
  assert.deepEqual(report.files.map((f) => [f.file, f.status]), [
    ['src/a.js', 'changed'],
    ['x/y/b.js', 'unchanged'],
  ]);
});

test('empty segments are kept: a//b stays', () => {
  const l = lcov(rec('a//b.js', [[1, 1]]), rec('./a/./b.js', [[1, 1]]));
  assert.deepEqual(json(l, l).report.files.map((f) => f.file), ['a//b.js', 'a/b.js']);
});

test('--root strips a whole-segment prefix from both reports', () => {
  const b = lcov(rec('/home/ci/work/src/a.js', [[1, 0]]));
  const h = lcov(rec('src/a.js', [[1, 1]]));
  const { report } = json(b, h, ['--root', '/home/ci/work']);
  assert.deepEqual(report.files.map((f) => [f.file, f.status]), [['src/a.js', 'changed']]);
  // trailing slash, backslashes and dots in the prefix
  assert.deepEqual(json(b, h, ['--root', '/home/./ci\\work//']).report.files.map((f) => f.file), ['src/a.js']);
});

test('--root: whole segments only, longest wins, stripped once, equal path not stripped', () => {
  const l = lcov(
    rec('/work2/a.js', [[1, 1]]),
    rec('/work/a.js', [[1, 1]]),
    rec('/work/sub/b.js', [[1, 1]]),
    rec('/work', [[1, 1]]),
    rec('/work/work/c.js', [[1, 1]]),
  );
  const files = json(l, l, ['--root', '/work', '--root', '/work/sub']).report.files.map((f) => f.file);
  assert.deepEqual(files, ['/work', '/work2/a.js', 'a.js', 'b.js', 'work/c.js']);
});

test('--root given twice applies to both reports whichever it was meant for', () => {
  const b = lcov(rec('/one/a.js', [[1, 0]]));
  const h = lcov(rec('/two/a.js', [[1, 1]]));
  const { report } = json(b, h, ['--root', '/one', '--root', '/two']);
  assert.deepEqual(report.files.map((f) => [f.file, f.status]), [['a.js', 'changed']]);
});

test('paths are case-sensitive and sorted by UTF-16 code units', () => {
  const l = lcov(rec('a/b.js', [[1, 1]]), rec('a.js', [[1, 1]]), rec('a.js2', [[1, 1]]), rec('B.js', [[1, 1]]), rec('b.js', [[1, 1]]), rec('A.js', [[1, 1]]));
  assert.deepEqual(json(l, l).report.files.map((f) => f.file), ['A.js', 'B.js', 'a.js', 'a.js2', 'a/b.js', 'b.js']);
});

test('markdown escapes | inside a path', () => {
  const r = plain('', lcov(rec('a|b.js', [[1, 1]])), ['--markdown']);
  assert.ok(r.out.includes('| `a\\|b.js` | - | 100.00% | new file |'));
});

// ------------------------------------------------------------ diff reader

const HEAD_FOR_DIFF = lcov(
  rec('src/a.js', [[1, 1], [2, 0], [3, 0], [4, 1], [5, 0], [6, 0], [7, 0], [9, 0], [11, 0], [12, 0], [20, 0]]),
);

function untested(diff, head = HEAD_FOR_DIFF, extra = []) {
  const r = json(head, head, ['--diff', 'x.diff', ...extra], { 'x.diff': diff });
  assert.equal(r.code, 0);
  return r.report.untested;
}

const sectionFor = (path, hunks) => `diff --git a/${path} b/${path}\nindex 111..222 100644\n--- a/${path}\n+++ b/${path}\n${hunks}`;

test('untested changed lines: ranges, counts, sorting', () => {
  const diff = sectionFor(
    'src/a.js',
    '@@ -4,0 +5,3 @@\n+x\n+x\n+x\n@@ -8,0 +9,1 @@\n+y\n@@ -10,0 +11,2 @@\n+z\n+z\n@@ -20,0 +20,1 @@\n+w\n',
  );
  assert.deepEqual(untested(diff), {
    count: 7,
    files: [
      {
        file: 'src/a.js',
        count: 7,
        ranges: [
          { start: 5, end: 7 },
          { start: 9, end: 9 },
          { start: 11, end: 12 },
          { start: 20, end: 20 },
        ],
      },
    ],
  });
});

test('lines with 0 hits that are context, lines with no DA, and files without a record are not findings', () => {
  const head = lcov(rec('a.js', [[1, 0], [2, 1], [4, 0]]));
  const diff =
    sectionFor('a.js', '@@ -1,2 +1,5 @@\n ctx0\n+executed\n+nodata\n+zero\n ctx\n') +
    sectionFor('nocov.js', '@@ -0,0 +1,2 @@\n+a\n+b\n');
  // new lines: 1 ctx (DA 0 hits, context), 2 added (hit), 3 added (no DA), 4 added (0 hits), 5 ctx
  assert.deepEqual(untested(diff, head), { count: 1, files: [{ file: 'a.js', count: 1, ranges: [{ start: 4, end: 4 }] }] });
});

test('a changed line that is executed in any duplicate record is not untested', () => {
  const head = lcov(rec('a.js', [[1, 0]]), rec('a.js', [[1, 2]]));
  const diff = sectionFor('a.js', '@@ -0,0 +1 @@\n+x\n');
  assert.deepEqual(untested(diff, head), { count: 0, files: [] });
});

test('removed lines are never changed lines and do not move the line count', () => {
  const head = lcov(rec('a.js', [[1, 1], [2, 0], [3, 1]]));
  // old: a, gone, gone2, c, tail; new: a, b, c
  const diff2 = sectionFor('a.js', '@@ -1,5 +1,3 @@\n a\n-gone\n-gone2\n+b\n c\n-tail\n');
  assert.deepEqual(untested(diff2, head), { count: 1, files: [{ file: 'a.js', count: 1, ranges: [{ start: 2, end: 2 }] }] });
});

test('missing counts mean 1', () => {
  const head = lcov(rec('a.js', [[5, 0]]));
  const diff = sectionFor('a.js', '@@ -5 +5 @@\n-old\n+new\n');
  assert.deepEqual(untested(diff, head).count, 1);
});

test('hunk length follows the header counts: added lines that look like headers', () => {
  const head = lcov(rec('a.js', [[1, 0], [2, 0], [3, 0], [4, 0]]), rec('other.js', [[1, 0], [2, 0]]));
  // "+++ b/other.js" is an added line inside the hunk, and "--- gone" a removed one.
  const diff = sectionFor('a.js', '@@ -1,2 +1,3 @@\n--- gone\n-old\n+++ b/other.js\n+two\n+three\n');
  const r = untested(diff, head);
  assert.deepEqual(r.files.map((f) => [f.file, f.ranges]), [['a.js', [{ start: 1, end: 3 }]]]);
});

test('an added line that looks like a diff --git header is an added line', () => {
  const head = lcov(rec('a.js', [[1, 0], [2, 0]]), rec('b.js', [[1, 0]]));
  const diff = sectionFor('a.js', '@@ -0,0 +1,2 @@\n+diff --git a/b.js b/b.js\n+@@ -0,0 +1 @@\n');
  assert.deepEqual(untested(diff, head).files.map((f) => [f.file, f.count]), [['a.js', 2]]);
});

test('a hunk ends when a line does not fit; that line is read outside the hunk', () => {
  const head = lcov(rec('a.js', [[1, 0], [2, 0], [3, 0]]), rec('b.js', [[1, 0]]));
  // the a.js hunk promises one new line; the next "+" does not fit and is ignored outside a hunk
  const diff = sectionFor('a.js', '@@ -0,0 +1 @@\n+one\n+extra\n') + sectionFor('b.js', '@@ -0,0 +1 @@\n+b\n');
  assert.deepEqual(untested(diff, head).files.map((f) => [f.file, f.count]), [['a.js', 1], ['b.js', 1]]);
});

test('a "+++ " line after a hunk that ended early sets the current file', () => {
  const head = lcov(rec('a.js', [[1, 0]]), rec('b.js', [[1, 0], [2, 0]]));
  const diff = '--- a/a.js\n+++ b/a.js\n@@ -0,0 +1 @@\n+x\n--- a/b.js\n+++ b/b.js\n@@ -0,0 +1,2 @@\n+y\n+z\n';
  assert.deepEqual(untested(diff, head).files.map((f) => [f.file, f.count]), [['a.js', 1], ['b.js', 2]]);
});

test('no-newline markers count for nothing', () => {
  const head = lcov(rec('a.js', [[1, 0], [2, 0]]));
  const diff = sectionFor('a.js', '@@ -1 +1,2 @@\n-old\n\\ No newline at end of file\n+new\n+new2\n\\ No newline at end of file\n');
  assert.deepEqual(untested(diff, head).files[0].ranges, [{ start: 1, end: 2 }]);
});

test('CRLF diffs and a missing final newline', () => {
  const head = lcov(rec('a.js', [[1, 0], [2, 0]]));
  const diff = 'diff --git a/a.js b/a.js\r\n--- a/a.js\r\n+++ b/a.js\r\n@@ -0,0 +1,2 @@\r\n+x\r\n+y';
  assert.deepEqual(untested(diff, head).files[0].ranges, [{ start: 1, end: 2 }]);
  const withEmptyContext = 'diff --git a/a.js b/a.js\r\n+++ b/a.js\r\n@@ -1,1 +1,2 @@\r\n\r\n+y\r\n';
  assert.deepEqual(untested(withEmptyContext, head).files[0].ranges, [{ start: 2, end: 2 }]);
});

test('an empty line inside a hunk is a context line', () => {
  const head = lcov(rec('a.js', [[2, 0]]));
  const diff = sectionFor('a.js', '@@ -1,1 +1,2 @@\n\n+x\n');
  assert.deepEqual(untested(diff, head).count, 1);
});

test('paths with spaces (tab after the path), quotes aside', () => {
  const head = lcov(rec('my dir/a b.js', [[1, 0]]));
  const diff = 'diff --git a/my dir/a b.js b/my dir/a b.js\n--- a/my dir/a b.js\t\n+++ b/my dir/a b.js\t\n@@ -0,0 +1 @@\n+x\n';
  assert.deepEqual(untested(diff, head).files[0].file, 'my dir/a b.js');
});

test('renames: the new path is used', () => {
  const head = lcov(rec('new/name.js', [[1, 1], [2, 0]]));
  const diff = 'diff --git a/old/name.js b/new/name.js\nsimilarity index 80%\nrename from old/name.js\nrename to new/name.js\n--- a/old/name.js\n+++ b/new/name.js\n@@ -1 +1,2 @@\n a\n+b\n';
  assert.deepEqual(untested(diff, head).files, [{ file: 'new/name.js', count: 1, ranges: [{ start: 2, end: 2 }] }]);
  const pure = 'diff --git a/old.js b/new.js\nsimilarity index 100%\nrename from old.js\nrename to new.js\n';
  assert.deepEqual(untested(pure, head), { count: 0, files: [] });
});

test('new files and deleted files', () => {
  const head = lcov(rec('n.js', [[1, 0], [2, 1]]), rec('gone.js', [[1, 0]]));
  const diff =
    'diff --git a/n.js b/n.js\nnew file mode 100644\n--- /dev/null\n+++ b/n.js\n@@ -0,0 +1,2 @@\n+a\n+b\n' +
    'diff --git a/gone.js b/gone.js\ndeleted file mode 100644\n--- a/gone.js\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n';
  assert.deepEqual(untested(diff, head), { count: 1, files: [{ file: 'n.js', count: 1, ranges: [{ start: 1, end: 1 }] }] });
});

test('a hunk read while the current file is none adds nothing', () => {
  const head = lcov(rec('a.js', [[1, 0]]));
  assert.deepEqual(untested('@@ -0,0 +1 @@\n+x\n', head), { count: 0, files: [] });
  // diff --git resets the current file even after a previous +++
  const diff = 'diff --git a/a.js b/a.js\n+++ b/a.js\ndiff --git a/a.js b/a.js\n@@ -0,0 +1 @@\n+x\n';
  assert.deepEqual(untested(diff, head), { count: 0, files: [] });
});

test('binary files, mode changes: no hunks, no change', () => {
  const head = lcov(rec('a.js', [[1, 0]]));
  const diff = 'diff --git a/a.js b/a.js\nold mode 100644\nnew mode 100755\nBinary files a/x.png and b/x.png differ\n';
  assert.deepEqual(untested(diff, head), { count: 0, files: [] });
});

test('diff paths are normalised (dots, backslashes) but get no --root', () => {
  const head = lcov(rec('/r/src/a.js', [[1, 0]]), rec('src/a.js', [[1, 0]]));
  const diff = sectionFor('src/a.js', '@@ -0,0 +1 @@\n+x\n').replace('+++ b/src/a.js', '+++ b/./src\\a.js');
  const r = untested(diff, head, ['--root', '/r']);
  assert.deepEqual(r.files.map((f) => f.file), ['src/a.js']);
});

test('--root makes head coverage paths match diff paths', () => {
  const head = lcov(rec('/home/ci/work/src/a.js', [[1, 0]]));
  const diff = sectionFor('src/a.js', '@@ -0,0 +1 @@\n+x\n');
  assert.equal(untested(diff, head, ['--root', '/home/ci/work']).count, 1);
  assert.equal(untested(diff, head).count, 0);
});

test('the same file in several sections accumulates; untested files are sorted by path', () => {
  const head = lcov(rec('b.js', [[1, 0], [3, 0]]), rec('a.js', [[2, 0]]));
  const diff2 = sectionFor('b.js', '@@ -0,0 +1 @@\n+x\n') + sectionFor('a.js', '@@ -1,0 +2 @@\n+x\n') + sectionFor('b.js', '@@ -2,0 +3 @@\n+x\n');
  assert.deepEqual(untested(diff2, head).files.map((f) => [f.file, f.count]), [['a.js', 1], ['b.js', 2]]);
});

test('lines that are not consecutive numbers are never joined', () => {
  const head = lcov(rec('a.js', [[1, 0], [2, 1], [3, 0]]));
  const diff = sectionFor('a.js', '@@ -0,0 +1 @@\n+x\n@@ -0,0 +3 @@\n+x\n');
  assert.deepEqual(untested(diff, head).files[0].ranges, [{ start: 1, end: 1 }, { start: 3, end: 3 }]);
});

test('the last --diff counts', () => {
  const head = lcov(rec('a.js', [[1, 0]]));
  const r = json(head, head, ['--diff', 'one.diff', '--diff', 'two.diff'], {
    'one.diff': '',
    'two.diff': sectionFor('a.js', '@@ -0,0 +1 @@\n+x\n'),
  });
  assert.equal(r.report.untested.count, 1);
});

// ------------------------------------------------------------ reports with a diff

const DIFF_BASE = lcov(rec('src/a.js', [[1, 1], [2, 0], [3, 0], [4, 1]]), rec('src/d.js', [[1, 1], [2, 0]]));
const DIFF_HEAD = lcov(
  rec('src/a.js', [[1, 1], [2, 0], [3, 0], [4, 1], [20, 0]]),
  rec('src/e.js', [[1, 1]]),
);
const DIFF_TEXT = sectionFor('src/a.js', '@@ -1,3 +1,4 @@\n a\n+b\n+c\n d\n-e\n@@ -19,0 +20 @@\n+z\n');

test('plain report with a diff', () => {
  const r = plain(DIFF_BASE, DIFF_HEAD, ['--diff', 'x.diff'], { 'x.diff': DIFF_TEXT });
  assert.equal(r.code, 0);
  assert.equal(
    r.out,
    [
      'coverage-drop: total 50.00% -> 50.00% (0.00 points)',
      '',
      'Files:',
      '  src/a.js: 50.00% -> 40.00% (-10.00 points)',
      '  src/d.js: 50.00% -> - (removed file)',
      '  src/e.js: - -> 100.00% (new file)',
      '',
      'Untested changed lines: 3',
      '  src/a.js: 2-3, 20',
      '',
    ].join('\n'),
  );
});

test('markdown report with a diff', () => {
  const r = plain(DIFF_BASE, DIFF_HEAD, ['--markdown', '--diff', 'x.diff'], { 'x.diff': DIFF_TEXT });
  assert.equal(
    r.out,
    [
      '## coverage-drop: total 50.00% -> 50.00% (0.00 points)',
      '',
      '| File | Before | After | Change |',
      '|---|---|---|---|',
      '| `src/a.js` | 50.00% | 40.00% | -10.00 points |',
      '| `src/d.js` | 50.00% | - | removed file |',
      '| `src/e.js` | - | 100.00% | new file |',
      '',
      '### Untested changed lines (3)',
      '',
      '- `src/a.js`: 2-3, 20',
      '',
    ].join('\n'),
  );
});

test('json report with a diff', () => {
  const { report } = json(DIFF_BASE, DIFF_HEAD, ['--diff', 'x.diff'], { 'x.diff': DIFF_TEXT });
  assert.deepEqual(report.untested, {
    count: 3,
    files: [{ file: 'src/a.js', count: 3, ranges: [{ start: 2, end: 3 }, { start: 20, end: 20 }] }],
  });
});

test('with a diff and nothing untested: heading with 0, no bullets, plain shows count only', () => {
  const same = lcov(rec('a.js', [[1, 1]]));
  const diff = sectionFor('a.js', '@@ -0,0 +1 @@\n+x\n');
  const files = { 'x.diff': diff };
  assert.equal(
    plain(same, same, ['--diff', 'x.diff'], files).out,
    'coverage-drop: total 100.00% -> 100.00% (0.00 points)\n\nUntested changed lines: 0\n',
  );
  assert.equal(
    plain(same, same, ['--diff', 'x.diff', '--markdown'], files).out,
    '## coverage-drop: total 100.00% -> 100.00% (0.00 points)\n\n### Untested changed lines (0)\n',
  );
});

test('empty reports with an empty diff', () => {
  assert.equal(plain('', '', ['--diff', 'x.diff'], { 'x.diff': '' }).out, 'coverage-drop: total n/a -> n/a (n/a)\n\nUntested changed lines: 0\n');
});

// ------------------------------------------------------------ failing

const DROP_BASE = lcov(rec('a.js', [[1, 1], [2, 1], [3, 1], [4, 1]]));
const DROP_HEAD = lcov(rec('a.js', [[1, 1], [2, 1], [3, 1], [4, 0]])); // 100 -> 75: -25.00

test('--fail-on-drop: fails only when the drop is more than the points', () => {
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '24.99']).code, 1);
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '25']).code, 0);
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '25.00']).code, 0);
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '25.0001']).code, 0);
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '0']).code, 1);
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '0.5']).code, 1);
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '100']).code, 0);
});

test('--fail-on-drop compares the change as printed, exactly', () => {
  const mk = (hit, found) => lcov(rec('a.js', Array.from({ length: found }, (_, i) => [i + 1, i < hit ? 1 : 0])));
  // 57.14 -> 66.67 and back: drop of exactly 9.53
  assert.equal(plain(mk(4, 6), mk(4, 7), ['--fail-on-drop', '9.53']).code, 0);
  assert.equal(plain(mk(4, 6), mk(4, 7), ['--fail-on-drop', '9.52']).code, 1);
  assert.equal(plain(mk(4, 6), mk(4, 7), ['--fail-on-drop', '9.529']).code, 1);
  assert.equal(plain(mk(4, 6), mk(4, 7), ['--fail-on-drop', '9.530']).code, 0);
  // no change at all
  assert.equal(plain(mk(1, 3), mk(1, 3), ['--fail-on-drop', '0']).code, 0);
});

test('--fail-on-drop never fails on a rise, no change or a null change', () => {
  assert.equal(plain(DROP_HEAD, DROP_BASE, ['--fail-on-drop', '0']).code, 0);
  assert.equal(plain(DROP_BASE, DROP_BASE, ['--fail-on-drop', '0']).code, 0);
  assert.equal(plain('', DROP_BASE, ['--fail-on-drop', '0']).code, 0);
  assert.equal(plain(DROP_BASE, '', ['--fail-on-drop', '0']).code, 0);
});

test('without --fail-on-drop a drop does not fail', () => {
  assert.equal(plain(DROP_BASE, DROP_HEAD).code, 0);
});

test('the last --fail-on-drop counts', () => {
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '0', '--fail-on-drop', '50']).code, 0);
  assert.equal(plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '50', '--fail-on-drop', '1']).code, 1);
});

test('--fail-on-drop still prints the report, and json lists the failure', () => {
  const r = plain(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '1']);
  assert.equal(r.code, 1);
  assert.ok(r.out.startsWith('coverage-drop: total 100.00% -> 75.00% (-25.00 points)\n'));
  const j = json(DROP_BASE, DROP_HEAD, ['--fail-on-drop', '1']);
  assert.equal(j.code, 1);
  assert.deepEqual(j.report.failures, ['drop']);
});

test('--fail-on-untested fails when a changed line is untested and prints the report', () => {
  const head = lcov(rec('a.js', [[1, 0]]));
  const files = { 'x.diff': sectionFor('a.js', '@@ -0,0 +1 @@\n+x\n') };
  const r = plain(head, head, ['--diff', 'x.diff', '--fail-on-untested'], files);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('Untested changed lines: 1\n  a.js: 1\n'));
  const j = json(head, head, ['--diff', 'x.diff', '--fail-on-untested'], files);
  assert.equal(j.code, 1);
  assert.deepEqual(j.report.failures, ['untested']);
});

test('--fail-on-untested passes when nothing is untested', () => {
  const head = lcov(rec('a.js', [[1, 1]]));
  const files = { 'x.diff': sectionFor('a.js', '@@ -0,0 +1 @@\n+x\n') };
  const j = json(head, head, ['--diff', 'x.diff', '--fail-on-untested'], files);
  assert.equal(j.code, 0);
  assert.deepEqual(j.report.failures, []);
});

test('both options: failures list "drop" then "untested"', () => {
  const head = DROP_HEAD;
  const files = { 'x.diff': sectionFor('a.js', '@@ -0,0 +1,4 @@\n+x\n+x\n+x\n+x\n') };
  const j = json(DROP_BASE, head, ['--diff', 'x.diff', '--fail-on-untested', '--fail-on-drop', '1'], files);
  assert.equal(j.code, 1);
  assert.deepEqual(j.report.failures, ['drop', 'untested']);
  const only = json(DROP_BASE, head, ['--diff', 'x.diff', '--fail-on-untested', '--fail-on-drop', '30'], files);
  assert.deepEqual(only.report.failures, ['untested']);
});

test('markdown form also exits 1 on failure and still prints', () => {
  const r = plain(DROP_BASE, DROP_HEAD, ['--markdown', '--fail-on-drop', '1']);
  assert.equal(r.code, 1);
  assert.ok(r.out.startsWith('## coverage-drop: total 100.00% -> 75.00% (-25.00 points)\n'));
});

test('no output on stdout besides the report: stderr is empty on success', () => {
  const r = plain(EXAMPLE_BASE, EXAMPLE_HEAD);
  assert.equal(r.err, '');
});
