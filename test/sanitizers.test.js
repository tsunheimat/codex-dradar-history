import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeDengHtmlBody, sanitizeDengTableBody } from '../src/sanitizers.js';

const FIX_DIR = path.join(import.meta.dirname, 'fixtures');

test('sanitizeDengHtmlBody removes the retired matrix, ladder, and report UI', () => {
  const source = fs.readFileSync(path.join(FIX_DIR, 'deng.html'));
  const out = sanitizeDengHtmlBody(source).toString('utf8');
  assert.ok(!out.includes('我的 Codex 订阅类型'));
  assert.ok(!out.includes('<section id="contributors">'));
  assert.ok(!out.includes('class="hero-link ladder-link"'));
  assert.ok(!out.includes('assets/radar-report.js'));
  assert.ok(out.includes('📡 模型智力'));
});

const FIX = path.join(FIX_DIR, 'deng-table.json');

test('sanitizeDengTableBody keeps IQ/efficiency inputs and removes matrix data', () => {
  const source = fs.readFileSync(FIX);
  const out = JSON.parse(sanitizeDengTableBody(source));
  assert.equal(out.tasks.length, 112);
  assert.equal(out.combos.length, 19);
  const cell = Object.values(out.cells).find((value) => value.ran_by?.length);
  assert.ok(cell, 'fixture contains run history');
  assert.ok('p' in cell && 'n' in cell && Array.isArray(cell.ran_by));
  assert.equal('st' in cell, false);
  assert.equal('holders' in cell, false);
  assert.equal('nickname' in cell.ran_by[0], false);
  assert.equal('avatar_seed' in cell.ran_by[0], false);
  assert.ok('passed' in cell.ran_by[0] && 'duration_sec' in cell.ran_by[0]);
});
