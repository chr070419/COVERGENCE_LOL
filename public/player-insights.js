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
  const pct = (value, total) => `${round(value / total * 100)}%`;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const frame = callback => typeof root.requestAnimationFrame === 'function' ? root.requestAnimationFrame(callback) : null;

  // A text-only champion mark. It is not an official icon: two letters and one
  // of six brand-palette fills derived from the recorded name, so a missing or
  // unmatched champion still reads as its name.
  function championInitials(name) {
    const parts = String(name || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length > 1) return parts.slice(0, 2).map(part => Array.from(part)[0].toLocaleUpperCase('en-US')).join('');
    const letters = Array.from(parts[0]);
    return letters[0].toLocaleUpperCase('en-US') + (letters[1] || '').toLocaleLowerCase('en-US');
  }
  function championHue(name) {
    let hash = 0;
    for (const character of String(name || '').trim().toLocaleLowerCase('en-US')) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return hash % 6;
  }
  function championToken(name, className = '') {
    return name ? `<span class="pt-token pt-hue-${championHue(name)}${className ? ` ${className}` : ''}" aria-hidden="true"><b>${esc(championInitials(name))}</b></span>` : `<span class="pt-token pt-token-empty${className ? ` ${className}` : ''}" aria-hidden="true"><b>?</b></span>`;
  }
  const ICONS = Object.freeze({
    maxKills: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3 21 3l0 6.5-9.3 9.3-2.2-2.2L18.8 7.3l-2.1-2.1-9.3 9.3-2.2-2.2Z"/><path d="m4 15 5 5m-6.5-1.5 3-3 3 3-3 3Z"/></svg>',
    maxAssists: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM1.5 20c.6-4 3.2-6 6.5-6s5.9 2 6.5 6m-2-5.2c1-.6 2.2-.8 3.5-.8 3.3 0 5.9 2 6.5 6"/></svg>',
    deathless: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 5v6.5c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5V5Z"/><path d="m8.2 12.2 2.6 2.6 5-5.3"/></svg>'
  });

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
    // Markers are HTML so they stay round (and the Perfect diamond square) while
    // the SVG stretches to the plot width.
    const marks = model.points.map(point => {
      if (point.missing || point.y == null) return '';
      const className = `pi-mark ${point.game.won === true ? 'pi-mark-win' : 'pi-mark-loss'}${point.perfect ? ' pi-mark-perfect' : ''}${point.index === selected ? ' is-selected' : ''}`;
      return `<span class="${className}" data-mark-key="${keyAttr(point.game)}" data-x="${point.x}" data-y="${point.y}" style="left:${pct(point.x, p.width)};top:${pct(point.y, p.height)}"></span>`;
    }).join('');
    const cursorX = model.cursorX ?? (selected >= 0 ? model.points[selected].x : null);
    const cursor = cursorX != null ? `<path class="pi-cursor" data-x="${round(cursorX)}" d="M${round(cursorX)} ${p.perfect}V${p.bottom}"/>` : '';
    return `<svg viewBox="0 0 ${p.width} ${p.height}" preserveAspectRatio="none" aria-hidden="true">${grid}${segments}${cursor}</svg><div class="pi-marks" aria-hidden="true">${marks}</div>${model.metric === 'kda' && model.points.some(point => point.perfect) ? '<span class="pi-perfect-key">◇ Perfect · 수치 축과 별도 표시</span>' : ''}${model.numericCount ? '' : `<span class="pi-chart-empty">${model.measured ? 'Perfect 기록은 위쪽에 별도로 표시합니다.<br>수치형 KDA가 없어 숫자 축은 표시하지 않습니다.' : '이 지표는 아직 수집되지 않았습니다.'}</span>`}<div class="pi-axis-x" aria-hidden="true"><span>${esc(shortDate(model.games[0]?.date))}</span><span>오래된 경기 → 최신</span><span>${esc(shortDate(model.games.at(-1)?.date))}</span></div>`;
  }
  function renderChart(model) {
    return `<div class="pi-chart" aria-label="${esc(chartLabel(model))}"><div class="pi-axis-y" aria-hidden="true">${renderAxis(model)}</div><div class="pi-plot"><div class="pi-drawing" role="img" aria-label="${esc(chartLabel(model))}">${renderDrawing(model)}</div><div class="pi-ghost" aria-hidden="true" hidden><span class="pi-ghost-tip"></span></div><input class="pi-plot-input" type="range" data-insight-range="plot" min="${model.windowStart}" max="${model.windowStart + model.games.length - 1}" step="1" value="${model.selectedGlobalIndex}" aria-label="그래프에서 경기 선택. 좌우로 끌거나 방향키를 누르세요" aria-valuetext="${esc(selectionLabel(model))}"${model.games.length < 2 ? ' disabled' : ''}></div></div>`;
  }
  // Facts about the selected game relative to the current scope's highlights.
  function selectionBadges(model, game) {
    const h = model.highlights;
    if (![game.kills, game.deaths, game.assists].every(integer)) return [];
    const badges = [];
    if (h.maxKills > 0 && game.kills === h.maxKills) badges.push(['maxKills', `최다 킬 ${fmt(game.kills)}`]);
    if (h.maxAssists > 0 && game.assists === h.maxAssists) badges.push(['maxAssists', `최다 어시스트 ${fmt(game.assists)}`]);
    if (game.deaths === 0) badges.push(['deathless', '무데스']);
    return badges;
  }
  function renderSelection(model, index, fresh = false) {
    if (index < 0) return '';
    const point = model.points[index], game = point.game, won = game.won === true;
    const badges = selectionBadges(model, game);
    return `<div class="pi-selection ${won ? 'pi-selection-win' : 'pi-selection-loss'}${fresh ? ' is-fresh' : ''}" aria-live="polite" aria-atomic="true"><span class="pi-verdict" aria-hidden="true">${won ? 'VICTORY' : 'DEFEAT'}</span><div class="pi-selected-title"><span class="pi-result ${won ? 'pi-result-win' : 'pi-result-loss'}">${won ? 'WIN' : 'LOSS'}</span>${championToken(game.champion, 'pt-token-lg')}<div><span class="pi-selected-kicker">GAME ${String(model.windowStart + index + 1).padStart(2, '0')} / ${model.allGames.length}</span><strong>${esc(game.champion || '챔피언 미입력')}</strong><span>${esc(fullDate(game.date))} · ${integer(game.setNumber) ? game.setNumber : '—'}세트 · ${esc(game.position ? String(game.position).toUpperCase() : '포지션 미입력')}</span></div><p><b>${esc(pointLabel(point, model))}</b><small>선택한 경기</small></p></div>${badges.length ? `<p class="pi-badges"><span class="sr-only">현재 조회 범위 기록: </span>${badges.map(([id, label]) => `<span class="pi-badge pi-badge-${id}">${ICONS[id]}${esc(label)}</span>`).join('')}</p>` : ''}<dl class="pi-game-stats"><div><dt>K / D / A</dt><dd>${fmt(game.kills)} / ${fmt(game.deaths)} / ${fmt(game.assists)}</dd></div><div><dt>KDA</dt><dd>${esc(kda(game))}</dd></div><div><dt>CS · 시간</dt><dd>${fmt(game.cs)} · ${time(game.durationSeconds)}</dd></div><div><dt>챔피언 피해량</dt><dd>${fmt(game.damage)}</dd></div></dl></div>`;
  }
  function renderGameButtons(model) {
    return model.points.map(point => `<button type="button" data-insight-game="${point.index}" data-insight-key="${keyAttr(point.game)}" class="${point.game.won === true ? 'pi-pick-win' : 'pi-pick-loss'}" aria-pressed="${point.index === model.selectedIndex}" aria-label="${esc(fullDate(point.game.date))} ${integer(point.game.setNumber) ? point.game.setNumber : '—'}세트, ${point.game.won === true ? '승리' : '패배'}, ${esc(point.game.champion || '챔피언 미입력')}, ${esc(pointLabel(point, model))}">${championToken(point.game.champion, 'pt-token-sm')}<span>${String(point.globalIndex + 1).padStart(2, '0')} <b>${point.game.won === true ? 'W' : 'L'}</b></span><small>${esc(shortDate(point.game.date))}</small></button>`).join('');
  }
  function renderNavigation(model) {
    const index = model.selectedGlobalIndex, previous = model.allGames[index - 1], next = model.allGames[index + 1];
    return `<button type="button" class="pi-step" data-insight-step="previous"${previous ? ` data-insight-key="${keyAttr(previous)}"` : ' disabled'} aria-label="이전 경기 선택">← 이전</button><span class="pi-timeline-count"><b>${index + 1}</b> / ${model.allGames.length}<small>전체 경기 탐색</small></span><button type="button" class="pi-step" data-insight-step="next"${next ? ` data-insight-key="${keyAttr(next)}"` : ' disabled'} aria-label="다음 경기 선택">다음 →</button>`;
  }
  function renderHighlights(model) {
    const h = model.highlights;
    const items = [['maxKills', '한 경기 최다 킬', h.maxKills, 'KILLS'], ['maxAssists', '한 경기 최다 어시스트', h.maxAssists, 'ASSISTS'], ['deathless', '데스 없이 끝낸 경기', h.deathless, 'GAMES']];
    return `<div class="pi-highlights"><div class="pi-highlights-heading"><span>MY HIGHLIGHTS</span><p>현재 조회 범위 · K/D/A가 모두 있는 ${h.games}경기</p></div><div class="pi-highlight-items">${items.map(([id, label, value, unit]) => { const game = model.highlightGames[id]; return `<button type="button" class="pi-highlight"${game ? ` data-insight-key="${keyAttr(game)}" data-highlight="${id}"` : ' disabled'} aria-label="${esc(`${label} ${fmt(value)}${game ? `, ${fullDate(game.date)} ${game.champion || '챔피언 미입력'} 경기 선택` : ', 해당 경기 없음'}`)}"><i class="pi-trophy pi-trophy-${id}" aria-hidden="true">${ICONS[id]}</i><span>${label}</span><strong>${integer(value) ? `<span data-count-key="highlight-${id}" data-count-value="${value}">${fmt(value)}</span>` : fmt(value)}<small>${unit}</small></strong><em>${game ? `${esc(shortDate(game.date))} · ${esc(game.champion || '챔피언 미입력')} <i aria-hidden="true">↗</i>` : '해당 경기 없음'}</em></button>`; }).join('')}</div>${h.deathless > 1 ? '<p class="pi-highlight-note">무데스 하이라이트는 가장 최근 경기를 엽니다. 동일한 최고 기록도 최신 경기로 이동합니다.</p>' : '<p class="pi-highlight-note">하이라이트를 누르면 해당 경기로 이동합니다. 동일한 최고 기록은 최신 경기를 선택합니다.</p>'}</div>`;
  }
  function render(detail, options = {}) {
    const model = buildModel(detail, options.metric, options);
    const metricButtons = Object.entries(METRICS).map(([metric, item]) => `<button type="button" data-insight-metric="${metric}" aria-pressed="${model.metric === metric}">${item.label}</button>`).join('');
    const fields = ['seriesId', 'gameId', 'setNumber', 'date', 'endedAt', 'won', 'champion', 'position', 'kills', 'deaths', 'assists', 'cs', 'durationSeconds', 'damage', 'kda'];
    const source = { metric: model.metric, selectedKey: model.selectedKey, windowStart: model.windowStart, recent: model.allGames.map(game => Object.fromEntries(fields.filter(field => Object.hasOwn(game, field)).map(field => [field, game[field]]))) };
    const data = JSON.stringify(source).replace(/[<>&]/g, character => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' }[character]));
    return `<section class="pi-panel${options.animate === true ? ' is-animated' : ''}" aria-label="경기별 퍼포먼스 추이"><div class="pi-heading"><div><span class="pi-eyebrow">PLAY EXPLORER</span><h3>한 판씩, 나의 플레이 곡선</h3><p>그래프를 좌우로 끌어 경기를 골라보세요.</p></div><div class="pi-metric-tabs" role="group" aria-label="추이 지표 선택">${metricButtons}</div></div>${model.games.length ? `<div data-insight-selection>${renderSelection(model, model.selectedIndex, options.fresh === true)}</div><div class="pi-chart-header"><span data-insight-measured>${esc(model.unit)} · ${model.measured}/${model.games.length}경기 수집</span>${model.allGames.length > 1 ? `<button type="button" class="pi-replay" data-insight-replay="" aria-pressed="${options.replaying === true}" aria-label="${options.replaying === true ? '경기 리플레이 멈추기' : `첫 경기부터 최신 경기까지 ${model.allGames.length}경기를 차례로 넘겨 보기`}"><span aria-hidden="true">${options.replaying === true ? '■' : '▶'}</span>${options.replaying === true ? '멈춤' : '리플레이'}</button>` : ''}<p><i class="pi-legend-win" aria-hidden="true"></i>승리 <i class="pi-legend-loss" aria-hidden="true"></i>패배</p></div>${renderChart(model)}<div class="pi-game-picker" role="group" aria-label="경기 선택">${renderGameButtons(model)}</div><div class="pi-timeline"><div class="pi-timeline-navigation">${renderNavigation(model)}</div><input class="pi-timeline-range" type="range" data-insight-range="all" min="0" max="${model.allGames.length - 1}" step="1" value="${model.selectedGlobalIndex}" aria-label="전체 경기 타임라인. 좌우로 끌거나 방향키를 누르세요" aria-valuetext="${esc(selectionLabel(model))}"${model.allGames.length < 2 ? ' disabled' : ''}><div class="pi-timeline-ends"><span>첫 경기 ${esc(shortDate(model.allGames[0]?.date))}</span><span>최신 ${esc(shortDate(model.allGames.at(-1)?.date))}</span></div></div><p class="pi-hint">그래프를 누르거나 끌어서 탐색 · 전체 타임라인으로 과거 경기 이동 · 미수집 값과 Perfect KDA는 선을 연결하지 않습니다.</p>` : '<div class="pi-empty"><span aria-hidden="true">↗</span><strong>첫 경기부터 나만의 곡선이 시작됩니다.</strong><p>경기 기록이 등록되면 KDA, CS/분, 피해량을 비교할 수 있습니다.</p></div>'}${renderHighlights(model)}<script type="application/json" data-insight-data>${data}</script></section>`;
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
      cancelMorph(container);
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
    // Mouse hover previews the nearest game without selecting it. Touch and
    // active drags keep the native range behaviour only.
    const hideGhost = () => { const ghost = container.querySelector('.pi-ghost'); if (ghost) ghost.hidden = true; };
    const hover = event => {
      const target = event.target;
      if (event.pointerType === 'touch' || event.buttons || !target?.classList?.contains?.('pi-plot-input') || target.disabled) { hideGhost(); return; }
      const plot = container.querySelector('.pi-plot'), ghost = container.querySelector('.pi-ghost'), tip = ghost?.querySelector?.('.pi-ghost-tip');
      if (!plot || !ghost || !tip || typeof plot.getBoundingClientRect !== 'function') return;
      const rect = plot.getBoundingClientRect();
      if (!rect.width) return;
      const x = (event.clientX - rect.left) / rect.width * PLOT.width;
      const point = model.points.reduce((best, item) => !best || Math.abs(item.x - x) < Math.abs(best.x - x) ? item : best, null);
      if (!point) { hideGhost(); return; }
      ghost.hidden = false;
      ghost.style.left = pct(point.x, PLOT.width);
      ghost.classList.toggle('pi-ghost-flip', point.x > PLOT.width * 0.62);
      ghost.classList.toggle('pi-ghost-loss', point.game.won !== true);
      tip.textContent = `${shortDate(point.game.date)} · ${point.game.champion || '챔피언 미입력'} · ${point.game.won === true ? 'WIN' : 'LOSS'} · ${pointLabel(point, model)}`;
    };
    container.addEventListener('input', update);
    container.addEventListener('change', commit);
    container.addEventListener('pointermove', hover);
    container.addEventListener('pointerleave', hideGhost);
    container.addEventListener('pointerdown', hideGhost);
    return () => {
      cancelMorph(container);
      container.removeEventListener('input', update); container.removeEventListener('change', commit);
      container.removeEventListener('pointermove', hover); container.removeEventListener('pointerleave', hideGhost); container.removeEventListener('pointerdown', hideGhost);
    };
  }

  // Captures the drawn marker and cursor positions so a following re-render can
  // glide from them. Only presentation coordinates are read; data stays in the
  // source payload.
  function snapshot(container) {
    const points = new Map();
    const marks = typeof container?.querySelectorAll === 'function' ? Array.from(container.querySelectorAll('.pi-mark[data-mark-key]')) : [];
    for (const mark of marks) {
      let key;
      try { key = decodeURIComponent(mark.getAttribute('data-mark-key')); } catch (_error) { continue; }
      const x = Number(mark.getAttribute('data-x')), y = Number(mark.getAttribute('data-y'));
      if (Number.isFinite(x) && Number.isFinite(y)) points.set(key, { x, y });
    }
    const cursorX = Number(container?.querySelector?.('.pi-cursor')?.getAttribute?.('data-x'));
    return { points, cursorX: Number.isFinite(cursorX) ? cursorX : null };
  }
  function cancelMorph(container) {
    if (container?.__piMorph != null) { root.cancelAnimationFrame?.(container.__piMorph); container.__piMorph = null; }
  }
  // Interpolates the freshly rendered curve from a previous snapshot: a metric
  // change morphs the line, a window shift slides it, a new selection moves the
  // cursor. The final frame is exactly the normal rendering.
  function morph(container, before, options = {}) {
    if (!options.enabled || !before || typeof root.requestAnimationFrame !== 'function') return;
    const drawing = container?.querySelector?.('.pi-drawing'), sourceNode = container?.querySelector?.('[data-insight-data]');
    if (!drawing || !sourceNode) return;
    let source;
    try { source = JSON.parse(sourceNode.textContent); } catch (_error) { return; }
    const target = buildModel(source, source.metric, { selectedKey: source.selectedKey, windowStart: source.windowStart });
    const p = target.plot;
    const from = target.points.map(point => {
      const old = before.points.get(point.key);
      return { x: old ? old.x : point.x, y: point.y == null ? null : old ? old.y : p.bottom };
    });
    const toCursor = target.selectedIndex >= 0 ? target.points[target.selectedIndex].x : null;
    const fromCursor = before.cursorX ?? toCursor;
    const moving = target.points.some((point, index) => point.x !== from[index].x || point.y !== from[index].y) || fromCursor !== toCursor;
    if (!moving) return;
    cancelMorph(container);
    const duration = options.duration || 420;
    let start = null;
    const step = now => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / duration), e = easeOut(t);
      if (t >= 1) { drawing.innerHTML = renderDrawing(target); container.__piMorph = null; return; }
      const points = target.points.map((point, index) => ({ ...point, x: round(from[index].x + (point.x - from[index].x) * e), y: point.y == null ? null : round(from[index].y + (point.y - from[index].y) * e) }));
      const byIndex = new Map(points.map(point => [point.index, point]));
      drawing.innerHTML = renderDrawing({ ...target, points, segments: target.segments.map(segment => segment.map(point => byIndex.get(point.index))), cursorX: toCursor == null ? null : fromCursor + (toCursor - fromCursor) * e });
      container.__piMorph = frame(step);
    };
    container.__piMorph = frame(step);
  }

  const api = Object.freeze({ buildModel, gameKey, selectedIndex, render, bind, snapshot, morph, championToken, championInitials });
  root.LoLPlayerInsights = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
