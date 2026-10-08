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

test('play layer stylesheet follows CHR_Web Harness r6 tokens: brand palette, finite motion, readable labels, print and reduced motion', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/player-arena.css'), 'utf8');
  // Harness palette (design-tokens.json) plus white and the v12 loss colour.
  const palette = new Set(['00176a', '001b59', '000c3d', '003e9c', '637291', '99abd4', 'b6bdd3', 'e1e6f2', 'f8fafe', 'f0f3f9', 'e5effb', 'ad4937', 'fbeaea', 'e4b3b3', 'ffffff', 'fff', '0a4db8']);
  const colours = [...css.matchAll(/#([0-9a-f]{3,8})\b/gi)].map(match => match[1].toLowerCase()).map(hex => hex.length === 8 ? hex.slice(0, 6) : hex);
  assert.deepEqual(colours.filter(hex => !palette.has(hex)), []);
  assert.doesNotMatch(css, /animation[^;}]*infinite/);
  const sizes = [...css.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map(match => Number(match[1]));
  assert.ok(sizes.every(size => size >= 11), `labels under 11px: ${sizes.filter(size => size < 11)}`);
  assert.match(css, /@media print\{?|@media print \{/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /html\[data-player-motion="off"\] \.pi-replay/);
});
