(function (root) {
  'use strict';

  // Presentation-only motion for the player page. Every helper is a no-op when
  // motion is disabled or a browser API is missing, so the rendered numbers are
  // always the exact source-derived text. Animations only travel *toward* that
  // text and restore it verbatim when they finish.
  const COUNT_MS = 720;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const frame = callback => typeof root.requestAnimationFrame === 'function' ? root.requestAnimationFrame(callback) : null;
  const all = (container, selector) => typeof container?.querySelectorAll === 'function' ? Array.from(container.querySelectorAll(selector)) : [];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const format = (value, digits) => value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  function snapshot(container) {
    const numbers = new Map(), bars = new Map();
    for (const element of all(container, '[data-count-key]')) {
      const value = Number(element.getAttribute('data-count-value'));
      if (finite(value)) numbers.set(element.getAttribute('data-count-key'), value);
    }
    for (const element of all(container, '[data-bar-key]')) {
      const value = parseFloat(element.style?.getPropertyValue?.('--bar'));
      if (finite(value)) bars.set(element.getAttribute('data-bar-key'), value);
    }
    return { numbers, bars };
  }

  function countTo(element, from, to, digits, delay = 0) {
    const finalText = element.textContent;
    const suffix = element.getAttribute('data-count-suffix') || '';
    const started = { at: null };
    element.classList.add('pm-counting');
    const step = now => {
      if (!element.isConnected) return;
      if (started.at === null) started.at = now + delay;
      const t = Math.max(0, Math.min(1, (now - started.at) / COUNT_MS));
      if (t >= 1) { element.textContent = finalText; element.classList.remove('pm-counting'); return; }
      element.textContent = format(from + (to - from) * easeOut(t), digits) + suffix;
      frame(step);
    };
    element.textContent = format(from, digits) + suffix;
    frame(step);
  }

  // `previous` is a snapshot taken before the container was re-rendered. With
  // no snapshot (first entrance) numbers count up from zero and bars grow.
  function play(container, previous, options = {}) {
    if (!options.enabled || typeof root.requestAnimationFrame !== 'function') return;
    const entrance = !previous;
    all(container, '[data-count-key]').forEach((element, index) => {
      const to = Number(element.getAttribute('data-count-value'));
      if (!finite(to)) return;
      const key = element.getAttribute('data-count-key');
      const from = entrance ? 0 : previous.numbers.get(key);
      if (!finite(from) || from === to) return;
      const digits = Math.max(0, Math.min(3, Number(element.getAttribute('data-count-digits')) || 0));
      countTo(element, from, to, digits, entrance ? Math.min(index, 8) * 40 : 0);
      if (!entrance) {
        const holder = element.closest?.('[data-count-flash]');
        if (holder) {
          holder.classList.remove('pm-changed-up', 'pm-changed-down');
          void holder.offsetWidth;
          holder.classList.add(to > from ? 'pm-changed-up' : 'pm-changed-down');
        }
      }
    });
    const bars = all(container, '[data-bar-key]');
    const moving = bars.filter(element => {
      const to = parseFloat(element.style.getPropertyValue('--bar'));
      const from = entrance ? 0 : previous.bars.get(element.getAttribute('data-bar-key'));
      if (!finite(to) || !finite(from) || from === to) return false;
      element.dataset.barTarget = String(to);
      element.style.setProperty('--bar', `${from}%`);
      return true;
    });
    if (!moving.length) return;
    void container.offsetWidth;
    frame(() => frame(() => moving.forEach(element => {
      element.style.setProperty('--bar', `${element.dataset.barTarget}%`);
      delete element.dataset.barTarget;
    })));
  }

  // Pointer tilt for cards marked with data-tilt. Mouse/pen only; touch keeps
  // native scrolling and tap behaviour.
  function tilt(container, isEnabled) {
    if (typeof container?.addEventListener !== 'function') return () => {};
    let active = null;
    const reset = card => { if (!card) return; card.style.removeProperty('--tilt-x'); card.style.removeProperty('--tilt-y'); card.classList.remove('pm-tilting'); };
    const move = event => {
      if (event.pointerType === 'touch' || !isEnabled()) return;
      const card = event.target?.closest?.('[data-tilt]');
      if (card !== active) { reset(active); active = card; }
      if (!card || typeof card.getBoundingClientRect !== 'function') return;
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
      card.classList.add('pm-tilting');
      card.style.setProperty('--tilt-x', `${((0.5 - y) * 10).toFixed(2)}deg`);
      card.style.setProperty('--tilt-y', `${((x - 0.5) * 12).toFixed(2)}deg`);
      card.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
    };
    const leave = event => { if (!event.relatedTarget || !container.contains?.(event.relatedTarget)) { reset(active); active = null; } };
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerout', leave);
    return () => { container.removeEventListener('pointermove', move); container.removeEventListener('pointerout', leave); reset(active); };
  }

  // A small particle burst anchored inside `target`. Purely decorative.
  function burst(target, options = {}) {
    if (!options.enabled || !target || typeof root.document?.createElement !== 'function') return;
    const doc = root.document;
    const host = doc.createElement('span');
    host.className = `pm-burst${options.tone ? ` pm-burst-${options.tone}` : ''}`;
    host.setAttribute('aria-hidden', 'true');
    const count = options.count || 14;
    for (let index = 0; index < count; index += 1) {
      const particle = doc.createElement('i');
      const angle = (index / count) * Math.PI * 2 + (index % 2 ? 0.2 : -0.1);
      const distance = 46 + (index % 4) * 16;
      particle.style.setProperty('--dx', `${(Math.cos(angle) * distance).toFixed(1)}px`);
      particle.style.setProperty('--dy', `${(Math.sin(angle) * distance).toFixed(1)}px`);
      particle.style.setProperty('--delay', `${(index % 3) * 30}ms`);
      host.appendChild(particle);
    }
    if (options.x != null && options.y != null) { host.style.left = `${options.x}px`; host.style.top = `${options.y}px`; }
    target.appendChild(host);
    setTimeout(() => host.remove(), 1100);
  }

  // Press ripple on buttons marked with data-ripple (or any descendant button of
  // a container marked data-ripple-scope).
  function ripple(container, isEnabled) {
    if (typeof container?.addEventListener !== 'function') return () => {};
    const down = event => {
      if (!isEnabled() || event.button > 0) return;
      const button = event.target?.closest?.('[data-ripple-scope] button, button[data-ripple], a[data-ripple]');
      if (!button || button.disabled || typeof button.getBoundingClientRect !== 'function') return;
      const rect = button.getBoundingClientRect();
      const wave = root.document.createElement('span');
      wave.className = 'pm-ripple';
      wave.setAttribute('aria-hidden', 'true');
      const size = Math.max(rect.width, rect.height) * 2.2;
      wave.style.width = wave.style.height = `${size}px`;
      wave.style.left = `${event.clientX - rect.left - size / 2}px`;
      wave.style.top = `${event.clientY - rect.top - size / 2}px`;
      button.appendChild(wave);
      setTimeout(() => wave.remove(), 650);
    };
    container.addEventListener('pointerdown', down);
    return () => container.removeEventListener('pointerdown', down);
  }

  function flash(element, className, enabled) {
    if (!enabled || !element?.classList) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  const api = Object.freeze({ snapshot, play, tilt, burst, ripple, flash });
  root.LoLPlayerMotion = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
