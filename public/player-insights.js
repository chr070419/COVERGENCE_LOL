(function (root) {
  'use strict';

  const S = root.LoLPlayerStats || (typeof require === 'function' ? require('../domain/player-stats.cjs') : null);
  const METRICS = Object.freeze({
    kda: { label: 'KDA', unit: 'KDA', digits: 2 },
    csPerMinute: { label: 'CS / 분', unit: 'CS / 분', digits: 1 },
    damage: { label: '챔피언 피해량', unit: '피해량', digits: 0 }
  });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const known = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const fmt = (value, digits = 0) => known(value) ? value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const axisNumber = value => known(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: Math.min(10, Math.max(0, -Math.floor(Math.log10(value || 1)) + 1)) }) : '—';
  const list = value => Array.isArray(value) ? value : [];
  const shortDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.slice(5).replace('-', '.') : '날짜 없음';
  const fullDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.replaceAll('-', '.') : '날짜 미입력';
  const time = value => known(value) && value > 0 ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '—';
  const kda = game => game?.kda?.perfect === true ? 'Perfect' : fmt(game?.kda?.ratio, 2);
  const recentOrder = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.endedAt || '').localeCompare(String(a.endedAt || '')) || String(b.seriesId || '').localeCompare(String(a.seriesId || '')) || (b.setNumber || 0) - (a.setNumber || 0);
  const round = value => Number(value.toFixed(3));
  const PLOT = Object.freeze({ left: 12, right: 628, top: 54, bottom: 214, perfect: 20, width: 640, height: 240 });
  // The canonical source selector identifies a set by seriesId + setNumber.
  // Prefer a game ID when future selectors provide one; never use display names.
  const gameKey = game => JSON.stringify([String(game?.seriesId || ''), game?.gameId ? String(game.gameId) : `set:${game?.setNumber ?? ''}`]);
  const keyAttr = game => esc(encodeURIComponent(gameKey(game)));

  function positiveCeiling(value) {
    if (!(value > 0)) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const base = value / magnitude;
    return (base <= 1 ? 1 : base <= 2 ? 2 : base <= 4 ? 4 : base <= 5 ? 5 : base <= 8 ? 8 : 10) * magnitude;
  }
  function highlights(rows) {
    const complete = rows.filter(row => [row.kills, row.deaths, row.assists].every(integer));
    return { games: complete.length, maxKills: complete.length ? Math.max(...complete.map(row => row.kills)) : null, maxAssists: complete.length ? Math.max(...complete.map(row => row.assists)) : null, deathless: complete.length ? complete.filter(row => row.deaths === 0).length : null };
  }
  function buildModel(detail, requestedMetric = 'kda', options = {}) {
    if (typeof options === 'string') options = { selectedKey: options };
    const metric = Object.hasOwn(METRICS, requestedMetric) ? requestedMetric : 'kda';
    const rows = list(detail?.recent), chronological = rows.slice().sort(recentOrder);
    const allGames = chronological.slice().reverse();
    const keyedIndex = typeof options.selectedKey === 'string' ? allGames.findIndex(game => gameKey(game) === options.selectedKey) : -1;
    const lastStart = Math.max(0, allGames.length - 12);
    let windowStart = lastStart;
    if (keyedIndex >= 0) {
      const retained = Number.isInteger(options.windowStart) && options.windowStart >= 0 && options.windowStart <= lastStart && keyedIndex >= options.windowStart && keyedIndex < options.windowStart + 12;
      windowStart = retained ? options.windowStart : Math.min(lastStart, Math.max(0, keyedIndex - 5));
    }
    const games = allGames.slice(windowStart, windowStart + 12);
    const selected = keyedIndex >= 0 ? keyedIndex - windowStart : games.length ? Number.isInteger(options.selectedIndex) ? Math.max(0, Math.min(games.length - 1, options.selectedIndex)) : games.length - 1 : -1;
    const points = games.map((game, index) => {
      const value = metric === 'csPerMinute' ? S.calculateCsPerMinute([game]).value : metric === 'damage' ? game.damage : game.kda?.ratio;
      const perfect = metric === 'kda' && game.kda?.perfect === true;
      return { index, globalIndex: windowStart + index, key: gameKey(game), game, value: !perfect && known(value) ? value : null, perfect, missing: !perfect && !known(value) };
    });
    const numericCount = points.filter(point => point.value !== null).length;
    const maximum = numericCount ? positiveCeiling(Math.max(0, ...points.map(point => point.value ?? 0))) : null;
    points.forEach(point => {
      point.x = round(points.length <= 1 ? (PLOT.left + PLOT.right) / 2 : PLOT.left + point.index / (points.length - 1) * (PLOT.right - PLOT.left));
      point.y = point.perfect ? PLOT.perfect : point.value === null ? null : round(PLOT.bottom - point.value / maximum * (PLOT.bottom - PLOT.top));
    });
    const segments = [];
    let segment = [];
    points.forEach(point => {
      if (point.value === null) { if (segment.length) segments.push(segment); segment = []; }
      else segment.push(point);
    });
    if (segment.length) segments.push(segment);
    const h = highlights(rows), complete = chronological.filter(row => [row.kills, row.deaths, row.assists].every(integer));
    const highlightGames = { maxKills: complete.find(row => row.kills === h.maxKills) || null, maxAssists: complete.find(row => row.assists === h.maxAssists) || null, deathless: complete.find(row => row.deaths === 0) || null };
    return { metric, ...METRICS[metric], allGames, games, points, segments, windowStart, selectedIndex: selected, selectedGlobalIndex: selected < 0 ? -1 : windowStart + selected, selectedKey: selected < 0 ? null : gameKey(games[selected]), domain: { min: 0, max: maximum }, ticks: numericCount ? [maximum, maximum / 2, 0] : [], numericCount, highlights: h, highlightGames, measured: points.filter(point => point.value !== null || point.perfect).length, plot: PLOT };
  }
  function selectedIndex(model, value) {
    if (!model.games.length) return -1;
    return Number.isInteger(value) ? Math.max(0, Math.min(model.games.length - 1, value)) : Number.isInteger(model.selectedIndex) ? model.selectedIndex : model.games.length - 1;
  }
  function pointLabel(point, model) {
    return point.perfect ? 'Perfect' : point.missing ? '미수집' : `${fmt(point.value, model.digits)}${model.metric === 'csPerMinute' ? ' CS/분' : model.metric === 'damage' ? ' 피해량' : ' KDA'}`;
  }
  function selectionLabel(model) {
    const point = model.points[model.selectedIndex];
    return point ? `${model.selectedGlobalIndex + 1}/${model.allGames.length}경기, ${fullDate(point.game.date)} ${point.game.setNumber}세트, ${point.game.champion || '챔피언 미입력'}, ${point.game.won ? '승리' : '패배'}, ${pointLabel(point, model)}` : '기록 없음';
  }
  function chartLabel(model) {
    return `${model.label} 추이. 전체 ${model.allGames.length}경기 중 ${model.windowStart + 1}~${model.windowStart + model.games.length}번째 경기 표시. ${model.measured}/${model.games.length}경기 수집. 가로축은 오래된 경기부터 최신 경기 순서입니다. ${model.numericCount ? `세로축은 0부터 ${axisNumber(model.domain.max)} ${model.unit}.` : '수치 데이터가 없어 숫자 축을 표시하지 않습니다.'}`;
  }
  function renderAxis(model) {
    const p = model.plot;
    return model.ticks.map((tick, index) => `<span style="top:${[p.top, (p.top + p.bottom) / 2, p.bottom][index]}px">${axisNumber(tick)}</span>`).join('');
  }
  function renderDrawing(model) {
    const p = model.plot, selected = model.selectedIndex;
    const grid = (model.numericCount ? [p.top, (p.top + p.bottom) / 2, p.bottom] : []).map(y => `<path class="pi-gridline" d="M${p.left} ${y}H${p.right}"/>`).join('');
    const segments = model.segments.filter(segment => segment.length > 1).map(segment => {
      const path = segment.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');
      return `<path class="pi-area" d="${path}L${segment.at(-1).x} ${p.bottom}L${segment[0].x} ${p.bottom}Z"/><path class="pi-trend-line" d="${path}" pathLength="100"/>`;
    }).join('');
    const dots = model.points.map(point => {
      if (point.missing) return '';
      const className = `pi-point ${point.game.won === true ? 'pi-point-win' : 'pi-point-loss'}${point.index === selected ? ' pi-point-selected' : ''}`;
      return point.perfect ? `<path class="${className} pi-perfect-point" d="m${point.x} ${p.perfect - 7} 7 7-7 7-7-7Z"/>` : `<path class="${className}" d="M${point.x} ${point.y}h.01"/>`;
    }).join('');
    const cursor = selected >= 0 ? `<path class="pi-cursor" d="M${model.points[selected].x} ${p.perfect}V${p.bottom}"/>` : '';
    return `<svg viewBox="0 0 ${p.width} ${p.height}" preserveAspectRatio="none" aria-hidden="true">${grid}${segments}${cursor}${dots}</svg>${model.metric === 'kda' && model.points.some(point => point.perfect) ? '<span class="pi-perfect-key">◇ Perfect · 수치 축과 별도 표시</span>' : ''}${model.numericCount ? '' : `<span class="pi-chart-empty">${model.measured ? 'Perfect 기록은 위쪽에 별도로 표시합니다.<br>수치형 KDA가 없어 숫자 축은 표시하지 않습니다.' : '이 지표는 아직 수집되지 않았습니다.'}</span>`}<div class="pi-axis-x" aria-hidden="true"><span>${esc(shortDate(model.games[0]?.date))}</span><span>오래된 경기 → 최신</span><span>${esc(shortDate(model.games.at(-1)?.date))}</span></div>`;
  }
  function renderChart(model) {
    return `<div class="pi-chart" aria-label="${esc(chartLabel(model))}"><div class="pi-axis-y" aria-hidden="true">${renderAxis(model)}</div><div class="pi-plot"><div class="pi-drawing" role="img" aria-label="${esc(chartLabel(model))}">${renderDrawing(model)}</div><input class="pi-plot-input" type="range" data-insight-range="plot" min="${model.windowStart}" max="${model.windowStart + model.games.length - 1}" step="1" value="${model.selectedGlobalIndex}" aria-label="그래프에서 경기 선택. 좌우로 끌거나 방향키를 누르세요" aria-valuetext="${esc(selectionLabel(model))}"${model.games.length < 2 ? ' disabled' : ''}></div></div>`;
  }
  function renderSelection(model, index) {
    if (index < 0) return '';
    const point = model.points[index], game = point.game;
    return `<div class="pi-selection" aria-live="polite" aria-atomic="true"><div class="pi-selected-title"><span class="pi-result ${game.won === true ? 'pi-result-win' : 'pi-result-loss'}">${game.won === true ? 'WIN' : 'LOSS'}</span><div><span class="pi-selected-kicker">GAME ${String(model.windowStart + index + 1).padStart(2, '0')} / ${model.allGames.length}</span><strong>${esc(game.champion || '챔피언 미입력')}</strong><span>${esc(fullDate(game.date))} · ${integer(game.setNumber) ? game.setNumber : '—'}세트 · ${esc(game.position ? String(game.position).toUpperCase() : '포지션 미입력')}</span></div><p><b>${esc(pointLabel(point, model))}</b><small>선택한 경기</small></p></div><dl class="pi-game-stats"><div><dt>K / D / A</dt><dd>${fmt(game.kills)} / ${fmt(game.deaths)} / ${fmt(game.assists)}</dd></div><div><dt>KDA</dt><dd>${esc(kda(game))}</dd></div><div><dt>CS · 시간</dt><dd>${fmt(game.cs)} · ${time(game.durationSeconds)}</dd></div><div><dt>챔피언 피해량</dt><dd>${fmt(game.damage)}</dd></div></dl></div>`;
  }
  function renderGameButtons(model) {
    return model.points.map(point => `<button type="button" data-insight-game="${point.index}" data-insight-key="${keyAttr(point.game)}" class="${point.game.won === true ? 'pi-pick-win' : 'pi-pick-loss'}" aria-pressed="${point.index === model.selectedIndex}" aria-label="${esc(fullDate(point.game.date))} ${integer(point.game.setNumber) ? point.game.setNumber : '—'}세트, ${point.game.won === true ? '승리' : '패배'}, ${esc(point.game.champion || '챔피언 미입력')}, ${esc(pointLabel(point, model))}"><span>${String(point.globalIndex + 1).padStart(2, '0')} <b>${point.game.won === true ? 'W' : 'L'}</b></span><small>${esc(shortDate(point.game.date))}</small></button>`).join('');
  }
  function renderNavigation(model) {
    const index = model.selectedGlobalIndex, previous = model.allGames[index - 1], next = model.allGames[index + 1];
    return `<button type="button" class="pi-step" data-insight-step="previous"${previous ? ` data-insight-key="${keyAttr(previous)}"` : ' disabled'} aria-label="이전 경기 선택">← 이전</button><span class="pi-timeline-count"><b>${index + 1}</b> / ${model.allGames.length}<small>전체 경기 탐색</small></span><button type="button" class="pi-step" data-insight-step="next"${next ? ` data-insight-key="${keyAttr(next)}"` : ' disabled'} aria-label="다음 경기 선택">다음 →</button>`;
  }
  function renderHighlights(model) {
    const h = model.highlights;
    const items = [['maxKills', '한 경기 최다 킬', h.maxKills, 'KILLS'], ['maxAssists', '한 경기 최다 어시스트', h.maxAssists, 'ASSISTS'], ['deathless', '데스 없이 끝낸 경기', h.deathless, 'GAMES']];
    return `<div class="pi-highlights"><div class="pi-highlights-heading"><span>MY HIGHLIGHTS</span><p>현재 조회 범위 · K/D/A가 모두 있는 ${h.games}경기</p></div><div class="pi-highlight-items">${items.map(([id, label, value, unit]) => { const game = model.highlightGames[id]; return `<button type="button" class="pi-highlight"${game ? ` data-insight-key="${keyAttr(game)}"` : ' disabled'} aria-label="${esc(`${label} ${fmt(value)}${game ? `, ${fullDate(game.date)} ${game.champion || '챔피언 미입력'} 경기 선택` : ', 해당 경기 없음'}`)}"><span>${label}</span><strong>${fmt(value)}<small>${unit}</small></strong><em>${game ? `${esc(shortDate(game.date))} · ${esc(game.champion || '챔피언 미입력')} <i aria-hidden="true">↗</i>` : '해당 경기 없음'}</em></button>`; }).join('')}</div>${h.deathless > 1 ? '<p class="pi-highlight-note">무데스 하이라이트는 가장 최근 경기를 엽니다. 동일한 최고 기록도 최신 경기로 이동합니다.</p>' : '<p class="pi-highlight-note">하이라이트를 누르면 해당 경기로 이동합니다. 동일한 최고 기록은 최신 경기를 선택합니다.</p>'}</div>`;
  }
  function render(detail, options = {}) {
    const model = buildModel(detail, options.metric, options);
    const metricButtons = Object.entries(METRICS).map(([metric, item]) => `<button type="button" data-insight-metric="${metric}" aria-pressed="${model.metric === metric}">${item.label}</button>`).join('');
    const fields = ['seriesId', 'gameId', 'setNumber', 'date', 'endedAt', 'won', 'champion', 'position', 'kills', 'deaths', 'assists', 'cs', 'durationSeconds', 'damage', 'kda'];
    const source = { metric: model.metric, selectedKey: model.selectedKey, windowStart: model.windowStart, recent: model.allGames.map(game => Object.fromEntries(fields.filter(field => Object.hasOwn(game, field)).map(field => [field, game[field]]))) };
    const data = JSON.stringify(source).replace(/[<>&]/g, character => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' }[character]));
    return `<section class="pi-panel${options.animate === true ? ' is-animated' : ''}" aria-label="경기별 퍼포먼스 추이"><div class="pi-heading"><div><span class="pi-eyebrow">PLAY EXPLORER</span><h3>한 판씩, 나의 플레이 곡선</h3><p>그래프를 좌우로 끌어 경기를 골라보세요.</p></div><div class="pi-metric-tabs" role="group" aria-label="추이 지표 선택">${metricButtons}</div></div>${model.games.length ? `<div data-insight-selection>${renderSelection(model, model.selectedIndex)}</div><div class="pi-chart-header"><span data-insight-measured>${esc(model.unit)} · ${model.measured}/${model.games.length}경기 수집</span><p><i class="pi-legend-win" aria-hidden="true"></i>승리 <i class="pi-legend-loss" aria-hidden="true"></i>패배</p></div>${renderChart(model)}<div class="pi-game-picker" role="group" aria-label="경기 선택">${renderGameButtons(model)}</div><div class="pi-timeline"><div class="pi-timeline-navigation">${renderNavigation(model)}</div><input class="pi-timeline-range" type="range" data-insight-range="all" min="0" max="${model.allGames.length - 1}" step="1" value="${model.selectedGlobalIndex}" aria-label="전체 경기 타임라인. 좌우로 끌거나 방향키를 누르세요" aria-valuetext="${esc(selectionLabel(model))}"${model.allGames.length < 2 ? ' disabled' : ''}><div class="pi-timeline-ends"><span>첫 경기 ${esc(shortDate(model.allGames[0]?.date))}</span><span>최신 ${esc(shortDate(model.allGames.at(-1)?.date))}</span></div></div><p class="pi-hint">그래프를 누르거나 끌어서 탐색 · 전체 타임라인으로 과거 경기 이동 · 미수집 값과 Perfect KDA는 선을 연결하지 않습니다.</p>` : '<div class="pi-empty"><span aria-hidden="true">↗</span><strong>첫 경기부터 나만의 곡선이 시작됩니다.</strong><p>경기 기록이 등록되면 KDA, CS/분, 피해량을 비교할 수 있습니다.</p></div>'}${renderHighlights(model)}<script type="application/json" data-insight-data>${data}</script></section>`;
  }

  // Native range inputs keep their DOM identity throughout a drag. Only the
  // drawing, labels and detail contents are projected on input; the page receives
  // a committed stable key on change and can then rerender safely. Native ranges
  // supply touch, pointer, arrow, Page Up/Down and Home/End semantics without
  // hijacking a mobile page's vertical scroll gesture.
  function bind(container, callback) {
    const onSelect = typeof callback === 'function' ? callback : callback?.onSelect;
    const sourceNode = container?.querySelector?.('[data-insight-data]');
    if (!sourceNode || typeof container.addEventListener !== 'function') return () => {};
    let source;
    try { source = JSON.parse(sourceNode.textContent); } catch (_error) { return () => {}; }
    let model = buildModel(source, source.metric, { selectedKey: source.selectedKey, windowStart: source.windowStart });
    const update = event => {
      const target = event.target;
      if (!target?.getAttribute?.('data-insight-range') || target.disabled) return;
      const index = Number(target.value);
      if (!Number.isInteger(index) || !model.allGames[index]) return;
      model = buildModel(source, model.metric, { selectedKey: gameKey(model.allGames[index]), windowStart: model.windowStart });
      const setHtml = (selector, html) => { const element = container.querySelector(selector); if (element) element.innerHTML = html; };
      const drawing = container.querySelector('.pi-drawing');
      if (drawing) { drawing.innerHTML = renderDrawing(model); drawing.setAttribute('aria-label', chartLabel(model)); }
      container.querySelector('.pi-chart')?.setAttribute('aria-label', chartLabel(model));
      // Remove only entry animation; selection never replays the entire curve.
      container.querySelector('.pi-panel')?.classList?.remove('is-animated');
      setHtml('.pi-axis-y', renderAxis(model));
      setHtml('[data-insight-selection]', renderSelection(model, model.selectedIndex));
      setHtml('.pi-game-picker', renderGameButtons(model));
      setHtml('.pi-timeline-navigation', renderNavigation(model));
      const measured = container.querySelector('[data-insight-measured]');
      if (measured) measured.textContent = `${model.unit} · ${model.measured}/${model.games.length}경기 수집`;
      for (const input of container.querySelectorAll('[data-insight-range]')) {
        input.value = String(model.selectedGlobalIndex);
        input.setAttribute('aria-valuetext', selectionLabel(model));
        if (input.getAttribute('data-insight-range') === 'plot') { input.min = String(model.windowStart); input.max = String(model.windowStart + model.games.length - 1); }
      }
    };
    const commit = event => {
      if (!event.target?.getAttribute?.('data-insight-range') || event.target.disabled) return;
      update(event);
      if (model.selectedKey !== null && typeof onSelect === 'function') onSelect(model.selectedKey, { windowStart: model.windowStart });
    };
    container.addEventListener('input', update);
    container.addEventListener('change', commit);
    return () => { container.removeEventListener('input', update); container.removeEventListener('change', commit); };
  }

  const api = Object.freeze({ buildModel, gameKey, selectedIndex, render, bind });
  root.LoLPlayerInsights = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
