'use strict';
// Presentation motion must only travel toward the exact rendered text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(withFrames) {
  const frames = [];
  const context = vm.createContext({ module: { exports: {} }, setTimeout() {}, ...(withFrames ? { requestAnimationFrame(fn) { frames.push(fn); return frames.length; } } : {}) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/player-motion.js'), 'utf8'), context);
  return { M: context.module.exports, frames, run(time) { const pending = frames.splice(0); pending.forEach(fn => fn(time)); } };
}
function counter(key, value, text, extra = {}) {
  const attributes = { 'data-count-key': key, 'data-count-value': String(value), ...extra };
  return { textContent: text, isConnected: true, getAttribute: name => attributes[name] ?? null, classList: { add() {}, remove() {} }, closest: () => null };
}
const container = elements => ({ offsetWidth: 1, querySelectorAll: selector => selector === '[data-count-key]' ? elements : [] });

test('disabled motion never touches the rendered numbers', () => {
  const { M, frames } = load(true);
  const element = counter('rate', 62.5, '62.5%', { 'data-count-digits': '1', 'data-count-suffix': '%' });
  M.play(container([element]), null, { enabled: false });
  assert.equal(element.textContent, '62.5%');
  assert.equal(frames.length, 0);
});

test('missing animation frames leave the exact text', () => {
  const { M } = load(false);
  const element = counter('rate', 62.5, '62.5%');
  M.play(container([element]), null, { enabled: true });
  assert.equal(element.textContent, '62.5%');
});

test('entrance counts up from zero and ends on the exact source text', () => {
  const { M, run } = load(true);
  const element = counter('rate', 62.5, '62.5%', { 'data-count-digits': '1', 'data-count-suffix': '%' });
  M.play(container([element]), null, { enabled: true });
  assert.equal(element.textContent, '0.0%');
  run(0); run(300);
  assert.ok(parseFloat(element.textContent) > 0 && parseFloat(element.textContent) < 62.5);
  run(5000);
  assert.equal(element.textContent, '62.5%');
});

test('scope changes glide from the previous snapshot and skip unchanged values', () => {
  const { M, run } = load(true);
  const before = M.snapshot(container([counter('games', 24, '24'), counter('same', 3, '3')]));
  assert.equal(before.numbers.get('games'), 24);
  const games = counter('games', 7, '7'), same = counter('same', 3, '3');
  M.play(container([games, same]), before, { enabled: true });
  assert.equal(games.textContent, '24');
  assert.equal(same.textContent, '3');
  run(0); run(5000);
  assert.equal(games.textContent, '7');
});
