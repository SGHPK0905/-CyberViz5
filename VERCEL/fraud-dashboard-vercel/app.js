'use strict';

const state = { data: null, view: 'manager', ledger: [] };
const palette = { blue: '#1d4ed8', blueFill: '#dbeafe', orange: '#c2410c', orangeFill: '#ffedd5', teal: '#0f766e', grid: '#e1e6ec', muted: '#66758a' };
const tooltip = document.getElementById('tooltip');

const fmtInt = value => new Intl.NumberFormat('vi-VN').format(value);
const fmtPct = value => `${(value * 100).toFixed(2).replace('.', ',')}%`;
const fmtMoney = value => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const safe = value => String(value ?? '—').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function showTooltip(event, html) {
  tooltip.innerHTML = html;
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
  tooltip.classList.add('visible');
}
function hideTooltip() { tooltip.classList.remove('visible'); }

function svgEl(name, attrs = {}, text = '') {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
}

function setupSvg(container, height = 310, width = 900) {
  container.innerHTML = '';
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
  container.appendChild(svg);
  return { svg, width, height };
}

function addGrid(svg, bounds, maxY, ticks = 4, percent = true) {
  const { left, right, top, bottom } = bounds;
  for (let i = 0; i <= ticks; i += 1) {
    const ratio = i / ticks;
    const y = bottom - ratio * (bottom - top);
    svg.appendChild(svgEl('line', { x1: left, y1: y, x2: right, y2: y, class: 'grid-line' }));
    const label = percent ? `${(maxY * ratio * 100).toFixed(0)}%` : (maxY * ratio).toFixed(0);
    svg.appendChild(svgEl('text', { x: left - 9, y: y + 4, 'text-anchor': 'end', class: 'axis-label' }, label));
  }
}

function renderKpis(product = 'ALL') {
  const kpi = state.data.manager.by_product[product].kpi;
  const cards = [
    ['Tổng giao dịch', fmtInt(kpi.total), product === 'ALL' ? 'Toàn bộ tập train' : `ProductCD ${product}`],
    ['Giao dịch fraud', fmtInt(kpi.fraud), `${(kpi.fraud / kpi.total * 100).toFixed(2)}% số giao dịch`],
    ['Tỷ lệ gian lận', fmtPct(kpi.fraud_rate), `95% CI ${fmtPct(kpi.ci_low)} – ${fmtPct(kpi.ci_high)}`],
    ['Giá trị GD gắn nhãn fraud', fmtMoney(kpi.fraud_amount), 'Không đồng nghĩa thiệt hại xác nhận'],
  ];
  document.getElementById('manager-kpis').innerHTML = cards.map(([label, value, note]) => `
    <article class="kpi-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>
  `).join('');
}

function renderWeekly(product = 'ALL') {
  const data = state.data.manager.by_product[product].weekly;
  const container = document.getElementById('weekly-chart');
  const { svg, width, height } = setupSvg(container, 310, 940);
  const b = { left: 56, right: width - 20, top: 20, bottom: height - 42 };
  const maxY = Math.max(...data.map(d => d.ci_high)) * 1.08;
  const x = i => b.left + (i / Math.max(1, data.length - 1)) * (b.right - b.left);
  const y = value => b.bottom - value / maxY * (b.bottom - b.top);
  addGrid(svg, b, maxY, 4, true);

  const baseline = state.data.manager.by_product[product].kpi.fraud_rate;
  svg.appendChild(svgEl('line', { x1: b.left, y1: y(baseline), x2: b.right, y2: y(baseline), class: 'baseline' }));
  svg.appendChild(svgEl('text', { x: b.right - 4, y: y(baseline) - 6, 'text-anchor': 'end', class: 'axis-label' }, `Mức nền ${fmtPct(baseline)}`));

  const upper = data.map((d, i) => `${x(i)},${y(d.ci_high)}`).join(' ');
  const lower = [...data].reverse().map((d, reverseIndex) => {
    const i = data.length - 1 - reverseIndex;
    return `${x(i)},${y(d.ci_low)}`;
  }).join(' ');
  svg.appendChild(svgEl('polygon', { points: `${upper} ${lower}`, fill: palette.blueFill, opacity: '.9' }));
  const path = data.map((d, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(d.fraud_rate)}`).join(' ');
  svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: palette.blue, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  data.forEach((d, i) => {
    const point = svgEl('circle', { cx: x(i), cy: y(d.fraud_rate), r: 4, fill: palette.blue, tabindex: 0 });
    const html = `<strong>Tuần tương đối ${d.RelativeWeek}</strong><br>Ngày ${d.day_start}–${d.day_end}<br>${fmtInt(d.fraud)}/${fmtInt(d.total)} fraud<br>Tỷ lệ ${fmtPct(d.fraud_rate)}<br>95% CI ${fmtPct(d.ci_low)} – ${fmtPct(d.ci_high)}`;
    point.addEventListener('mousemove', event => showTooltip(event, html));
    point.addEventListener('mouseleave', hideTooltip);
    point.addEventListener('focus', event => showTooltip(event, html));
    point.addEventListener('blur', hideTooltip);
    svg.appendChild(point);
    if (i % 4 === 0 || i === data.length - 1) svg.appendChild(svgEl('text', { x: x(i), y: b.bottom + 20, 'text-anchor': 'middle', class: 'axis-label' }, `${d.RelativeWeek}`));
  });
  svg.appendChild(svgEl('text', { x: (b.left + b.right) / 2, y: height - 8, 'text-anchor': 'middle', class: 'axis-label' }, 'Tuần tương đối'));
}

function renderCycle() {
  const data = state.data.manager.relative_cycle;
  const container = document.getElementById('cycle-chart');
  const { svg, width, height } = setupSvg(container, 260, 560);
  const b = { left: 48, right: width - 18, top: 18, bottom: height - 38 };
  const maxY = Math.max(...data.map(d => d.ci_high)) * 1.1;
  const band = (b.right - b.left) / data.length;
  const y = value => b.bottom - value / maxY * (b.bottom - b.top);
  addGrid(svg, b, maxY, 4, true);
  data.forEach((d, i) => {
    const barWidth = band * .55;
    const x = b.left + band * i + (band - barWidth) / 2;
    const rect = svgEl('rect', { x, y: y(d.fraud_rate), width: barWidth, height: b.bottom - y(d.fraud_rate), rx: 3, fill: palette.orange });
    rect.addEventListener('mousemove', event => showTooltip(event, `<strong>Vị trí ${d.cycle_day}</strong><br>n = ${fmtInt(d.total)}<br>Tỷ lệ ${fmtPct(d.fraud_rate)}<br>95% CI ${fmtPct(d.ci_low)} – ${fmtPct(d.ci_high)}`));
    rect.addEventListener('mouseleave', hideTooltip);
    svg.appendChild(rect);
    const cx = x + barWidth / 2;
    svg.appendChild(svgEl('line', { x1: cx, y1: y(d.ci_low), x2: cx, y2: y(d.ci_high), stroke: '#7c2d12', 'stroke-width': 1.5 }));
    svg.appendChild(svgEl('line', { x1: cx - 4, y1: y(d.ci_low), x2: cx + 4, y2: y(d.ci_low), stroke: '#7c2d12' }));
    svg.appendChild(svgEl('line', { x1: cx - 4, y1: y(d.ci_high), x2: cx + 4, y2: y(d.ci_high), stroke: '#7c2d12' }));
    svg.appendChild(svgEl('text', { x: cx, y: b.bottom + 19, 'text-anchor': 'middle', class: 'axis-label' }, String(d.cycle_day)));
  });
}

function renderIdentity() {
  const data = state.data.manager.product_identity;
  const products = [...new Set(data.map(d => d.product))].sort();
  const container = document.getElementById('identity-chart');
  const { svg, width, height } = setupSvg(container, 260, 560);
  const b = { left: 48, right: width - 18, top: 18, bottom: height - 38 };
  const maxY = Math.max(...data.map(d => d.ci_high)) * 1.12;
  const groupBand = (b.right - b.left) / products.length;
  const y = value => b.bottom - value / maxY * (b.bottom - b.top);
  addGrid(svg, b, maxY, 4, true);
  products.forEach((product, i) => {
    const rows = data.filter(d => d.product === product);
    rows.forEach(d => {
      const shift = d.has_identity ? groupBand * .14 : -groupBand * .14;
      const cx = b.left + groupBand * (i + .5) + shift;
      const cy = y(d.fraud_rate);
      svg.appendChild(svgEl('line', { x1: cx, y1: y(d.ci_low), x2: cx, y2: y(d.ci_high), stroke: d.has_identity ? palette.blue : palette.orange, 'stroke-width': 2 }));
      const shape = d.has_identity
        ? svgEl('circle', { cx, cy, r: 5, fill: palette.blue })
        : svgEl('rect', { x: cx - 5, y: cy - 5, width: 10, height: 10, fill: palette.orange });
      shape.addEventListener('mousemove', event => showTooltip(event, `<strong>${product} · ${d.has_identity ? 'Có' : 'Không có'} identity</strong><br>n = ${fmtInt(d.total)}<br>Tỷ lệ ${fmtPct(d.fraud_rate)}<br>95% CI ${fmtPct(d.ci_low)} – ${fmtPct(d.ci_high)}`));
      shape.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(shape);
    });
    svg.appendChild(svgEl('text', { x: b.left + groupBand * (i + .5), y: b.bottom + 19, 'text-anchor': 'middle', class: 'axis-label' }, product));
  });
}

function renderAmountHistogram() {
  const series = state.data.investigator.amount_histogram;
  const allBins = series.flatMap(item => item.bins);
  const minX = Math.log10(Math.min(...allBins.map(d => d.x0)));
  const maxX = Math.log10(Math.max(...allBins.map(d => d.x1)));
  const maxY = Math.max(...allBins.map(d => d.share)) * 1.08;
  const container = document.getElementById('amount-histogram');
  const { svg, width, height } = setupSvg(container, 310, 940);
  const b = { left: 56, right: width - 20, top: 20, bottom: height - 44 };
  const x = value => b.left + (Math.log10(value) - minX) / (maxX - minX) * (b.right - b.left);
  const y = value => b.bottom - value / maxY * (b.bottom - b.top);
  addGrid(svg, b, maxY, 4, true);

  series.forEach(item => {
    const color = item.class_value === 1 ? palette.orange : palette.blue;
    const path = item.bins.map((d, i) => `${i ? 'L' : 'M'} ${x(Math.sqrt(d.x0 * d.x1))} ${y(d.share)}`).join(' ');
    svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2.4, 'stroke-dasharray': item.class_value === 1 ? '6 4' : '0' }));
    item.bins.forEach(d => {
      const point = svgEl('circle', { cx: x(Math.sqrt(d.x0 * d.x1)), cy: y(d.share), r: 3.2, fill: color, opacity: .9 });
      point.addEventListener('mousemove', event => showTooltip(event, `<strong>${item.label}</strong><br>${fmtMoney(d.x0)} – ${fmtMoney(d.x1)}<br>${(d.share * 100).toFixed(2)}% trong lớp<br>n = ${fmtInt(d.count)}`));
      point.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(point);
    });
  });
  [1, 10, 100, 1000, 10000].filter(v => Math.log10(v) >= minX && Math.log10(v) <= maxX).forEach(v => {
    svg.appendChild(svgEl('text', { x: x(v), y: b.bottom + 20, 'text-anchor': 'middle', class: 'axis-label' }, `$${fmtInt(v)}`));
  });
  svg.appendChild(svgEl('line', { x1: b.left, y1: b.top + 8, x2: b.left + 26, y2: b.top + 8, stroke: palette.blue, 'stroke-width': 2.5 }));
  svg.appendChild(svgEl('text', { x: b.left + 33, y: b.top + 12, class: 'axis-label' }, 'Hợp lệ'));
  svg.appendChild(svgEl('line', { x1: b.left + 92, y1: b.top + 8, x2: b.left + 118, y2: b.top + 8, stroke: palette.orange, 'stroke-width': 2.5, 'stroke-dasharray': '6 4' }));
  svg.appendChild(svgEl('text', { x: b.left + 125, y: b.top + 12, class: 'axis-label' }, 'Gian lận'));
}

function renderAmountBins() {
  const data = state.data.investigator.amount_bins;
  const maxRate = Math.max(...data.map(d => d.ci_high));
  document.getElementById('amount-bin-chart').innerHTML = data.map(d => `
    <div class="bar-row" title="95% CI ${fmtPct(d.ci_low)} – ${fmtPct(d.ci_high)}">
      <div class="bar-label"><strong>$${safe(d.label)}</strong><span>n = ${fmtInt(d.total)} · ${fmtInt(d.fraud)} fraud</span></div>
      <div class="bar-track"><span class="bar-fill" style="width:${clamp(d.fraud_rate / maxRate * 100, 0, 100)}%"></span></div>
      <div class="bar-value">${fmtPct(d.fraud_rate)}</div>
    </div>`).join('');
}

function renderMissing() {
  const data = state.data.investigator.missing_effects.slice(0, 7);
  const maxRate = Math.max(...data.flatMap(d => [d.missing.fraud_rate, d.present.fraud_rate])) * 1.08;
  document.getElementById('missing-chart').innerHTML = data.map(d => {
    const a = d.present.fraud_rate / maxRate * 100;
    const b = d.missing.fraud_rate / maxRate * 100;
    const left = Math.min(a, b);
    const width = Math.abs(a - b);
    return `<div class="comparison-row">
      <div class="comparison-label"><strong>${safe(d.column)}</strong><span>Thiếu ${fmtPct(d.missing_pct)} · chênh ${d.rate_gap >= 0 ? '+' : ''}${fmtPct(d.rate_gap)}</span></div>
      <div class="comparison-track" title="Có dữ liệu: ${fmtPct(d.present.fraud_rate)} (n=${fmtInt(d.present.total)}); Thiếu: ${fmtPct(d.missing.fraud_rate)} (n=${fmtInt(d.missing.total)})">
        <span class="comparison-link" style="left:${left}%;width:${width}%"></span>
        <span class="comparison-mark present" style="left:${a}%"></span>
        <span class="comparison-mark missing" style="left:${b}%"></span>
      </div>
      <div class="legend"><span><i class="legend-dot blue"></i>Có dữ liệu ${fmtPct(d.present.fraud_rate)}</span><span><i class="legend-square orange"></i>Thiếu ${fmtPct(d.missing.fraud_rate)}</span></div>
    </div>`;
  }).join('');
}

function renderSegments() {
  const body = document.querySelector('#segment-table tbody');
  body.innerHTML = state.data.investigator.segments.slice(0, 12).map(d => `
    <tr><td><strong>${safe(d.product)}</strong> · ${safe(d.device)}</td><td class="num">${fmtInt(d.total)}</td><td class="num">${fmtInt(d.fraud)}</td><td class="num"><strong>${fmtPct(d.fraud_rate)}</strong></td><td class="num">${fmtPct(d.ci_low)} – ${fmtPct(d.ci_high)}</td></tr>
  `).join('');
}

function renderLedger() {
  const query = document.getElementById('ledger-search').value.trim().toLowerCase();
  const label = document.getElementById('ledger-label').value;
  const product = document.getElementById('ledger-product').value;
  const rows = state.ledger.filter(d =>
    (!query || String(d.transaction_id).toLowerCase().includes(query)) &&
    (label === 'ALL' || String(d.is_fraud) === label) &&
    (product === 'ALL' || d.product === product)
  );
  document.querySelector('#ledger-table tbody').innerHTML = rows.map(d => `
    <tr><td><strong>${safe(d.transaction_id)}</strong></td><td><span class="label-pill ${d.is_fraud ? 'fraud' : 'legit'}">${d.is_fraud ? 'Fraud' : 'Hợp lệ'}</span></td><td class="num">${safe(d.relative_day)}</td><td class="num">${fmtMoney(d.amount)}</td><td>${safe(d.product)}</td><td>${safe(d.card4)} · ${safe(d.card6)}</td><td>${safe(d.device)}</td><td class="num">${d.d1 == null ? '—' : safe(d.d1)}</td></tr>
  `).join('') || '<tr><td colspan="8">Không có giao dịch phù hợp bộ lọc.</td></tr>';
}

function renderManager() {
  const product = document.getElementById('manager-product').value;
  renderKpis(product);
  renderWeekly(product);
  renderCycle();
  renderIdentity();
}

function renderInvestigator() {
  renderAmountHistogram();
  renderAmountBins();
  renderMissing();
  renderSegments();
  renderLedger();
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('hidden', section.id !== `${view}-view`));
  document.querySelectorAll('.nav-button').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (view === 'investigator') renderInvestigator(); else renderManager();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadData() {
  let response;
  try {
    response = await fetch('/api/dashboard');
    if (!response.ok) throw new Error('API unavailable');
  } catch (_error) {
    response = await fetch('./data/dashboard.json');
  }
  if (!response.ok) throw new Error(`Không tải được dữ liệu (${response.status})`);
  state.data = await response.json();
  state.ledger = state.data.investigator.ledger_sample;

  document.getElementById('source-rows').textContent = fmtInt(state.data.metadata.source_rows);
  document.getElementById('data-status').textContent = `${fmtInt(state.data.metadata.source_rows)} dòng · ${state.data.metadata.loaded_columns.length}/${state.data.metadata.source_columns} cột`;
  document.getElementById('manager-story').textContent = state.data.user_stories.manager;
  document.getElementById('investigator-story').textContent = state.data.user_stories.investigator;
  document.getElementById('method-note').textContent = state.data.metadata.analysis_note;

  const products = Object.keys(state.data.manager.by_product).filter(key => key !== 'ALL');
  document.getElementById('manager-product').insertAdjacentHTML('beforeend', products.map(p => `<option value="${safe(p)}">ProductCD ${safe(p)}</option>`).join(''));
  document.getElementById('ledger-product').insertAdjacentHTML('beforeend', products.map(p => `<option value="${safe(p)}">ProductCD ${safe(p)}</option>`).join(''));
  renderManager();
}

document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.getElementById('manager-product').addEventListener('change', renderManager);
document.getElementById('ledger-search').addEventListener('input', renderLedger);
document.getElementById('ledger-label').addEventListener('change', renderLedger);
document.getElementById('ledger-product').addEventListener('change', renderLedger);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.data && (state.view === 'manager' ? renderManager() : renderInvestigator()), 120);
});

loadData().catch(error => {
  document.getElementById('data-status').textContent = 'Lỗi nạp dữ liệu';
  document.getElementById('main-content').insertAdjacentHTML('afterbegin', `<div class="panel"><strong>Không thể mở dashboard.</strong><p>${safe(error.message)}. Hãy chạy bằng máy chủ HTTP theo README.</p></div>`);
});
