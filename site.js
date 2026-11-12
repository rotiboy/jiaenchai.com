// jiaenchai.com: small enhancements. The page reads fine without any of this.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const ICON = {
    prev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M11 8.5v5M8.5 11h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  /* ── lightbox: one dialog shared by every viewer ── */
  const lb = el('dialog', 'lb');
  lb.setAttribute('aria-label', 'Enlarged screenshot');
  lb.innerHTML = `
    <div class="lb__bar">
      <span class="lb__title"></span>
      <div class="lb__tools">
        <button type="button" data-act="zoom">${ICON.zoom}<span data-zoom-label>Actual size</span></button>
        <button type="button" data-act="close" aria-label="Close">${ICON.close}</button>
      </div>
    </div>
    <div class="lb__pane"><img alt=""></div>
    <div class="lb__foot">
      <span class="lb__cap"></span>
      <div class="lb__tools">
        <button type="button" data-act="prev" aria-label="Previous screen">${ICON.prev}</button>
        <span class="lb__count"></span>
        <button type="button" data-act="next" aria-label="Next screen">${ICON.next}</button>
      </div>
    </div>`;
  document.body.append(lb);
  const pane = $('.lb__pane', lb), big = $('img', pane);
  let set = [], at = 0, onMove = null;

  const setZoom = (on, point) => {
    pane.classList.toggle('is-zoomed', on);
    $('[data-zoom-label]', lb).textContent = on ? 'Fit to screen' : 'Actual size';
    if (on) {
      // scale so one image pixel is one CSS pixel, but never smaller than the fitted view
      const w = Math.max(big.naturalWidth / Math.min(devicePixelRatio || 1, 2), pane.clientWidth * 1.6);
      big.style.width = w + 'px';
      const fx = point ? point.x : .5, fy = point ? point.y : .5;
      requestAnimationFrame(() => {
        pane.scrollLeft = (pane.scrollWidth - pane.clientWidth) * fx;
        pane.scrollTop = (pane.scrollHeight - pane.clientHeight) * fy;
      });
    } else {
      big.style.width = '';
    }
  };
  const show = (i) => {
    at = (i + set.length) % set.length;
    const s = set[at];
    setZoom(false);
    big.src = s.src; big.alt = s.alt;
    $('.lb__title', lb).textContent = s.title;
    $('.lb__cap', lb).textContent = s.cap;
    $('.lb__count', lb).textContent = `${at + 1} / ${set.length}`;
    const many = set.length > 1;
    $$('[data-act="prev"],[data-act="next"],.lb__count', lb).forEach(n => n.hidden = !many);
    if (onMove) onMove(at);
  };
  const open = (shots, i, moved) => { set = shots; onMove = moved; show(i); lb.showModal(); };

  lb.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'close') lb.close();
    if (a === 'prev') show(at - 1);
    if (a === 'next') show(at + 1);
    if (a === 'zoom') setZoom(!pane.classList.contains('is-zoomed'));
  });
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'ArrowRight') show(at + 1);
    if (e.key === 'z' || e.key === 'Z') setZoom(!pane.classList.contains('is-zoomed'));
  });
  // click to zoom in at that point; drag to pan when zoomed; click without drag zooms out
  let drag = null;
  pane.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, l: pane.scrollLeft, t: pane.scrollTop, moved: false };
    if (pane.classList.contains('is-zoomed') && e.pointerType === 'mouse') {
      pane.setPointerCapture(e.pointerId); pane.classList.add('is-drag'); e.preventDefault();
    }
  });
  pane.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (pane.classList.contains('is-drag')) { pane.scrollLeft = drag.l - dx; pane.scrollTop = drag.t - dy; }
  });
  pane.addEventListener('pointerup', (e) => {
    pane.classList.remove('is-drag');
    const d = drag; drag = null;
    if (!d || d.moved) return;
    if (pane.classList.contains('is-zoomed')) return setZoom(false);
    const r = big.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) return lb.close();
    setZoom(true, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  });
  pane.addEventListener('pointercancel', () => { drag = null; pane.classList.remove('is-drag'); });

  /* ── viewers: tabs + stage built from the plain figures ── */
  $$('[data-viewer]').forEach((v, vi) => {
    const title = v.closest('.proj')?.querySelector('h3')?.textContent.trim() || '';
    const shots = $$('.shot', v).map(f => {
      const img = $('img', f);
      return { label: f.dataset.label, fill: 'full' in f.dataset, src: img.getAttribute('src'), alt: img.alt, cap: $('figcaption', f).textContent, title,
               full: img.naturalWidth ? null : null, w: +img.getAttribute('width'), h: +img.getAttribute('height') };
    });
    if (!shots.length) return;
    let cur = 0;

    const tabs = el('div', 'viewer__tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', v.getAttribute('aria-label') || 'Screens');
    const stage = el('button', 'viewer__stage');
    stage.type = 'button';
    stage.id = `stage-${vi}`;
    stage.setAttribute('role', 'tabpanel');
    const img = el('img');
    img.decoding = 'async';
    stage.append(img, el('span', 'viewer__zoom', `${ICON.zoom}Enlarge`));
    const foot = el('div', 'viewer__foot');
    const cap = el('span', 'viewer__cap');
    const nav = el('div', 'viewer__nav');
    const count = el('span', 'viewer__count');
    const prev = el('button', '', ICON.prev), next = el('button', '', ICON.next);
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous screen'); next.setAttribute('aria-label', 'Next screen');
    nav.append(prev, count, next);
    foot.append(cap, nav);

    const btns = shots.map((s, i) => {
      const b = el('button', 'viewer__tab', s.label);
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', stage.id);
      b.addEventListener('click', () => go(i));
      tabs.append(b);
      return b;
    });

    const paint = (i) => {
      const s = shots[i];
      img.src = s.src; img.alt = s.alt;
      // a composite that already has its own dark backdrop fills the stage edge to edge
      img.classList.toggle('is-full', s.fill);
      cap.textContent = s.cap;
      count.textContent = `${i + 1} / ${shots.length}`;
      stage.setAttribute('aria-label', `${s.label}. ${s.cap} Select to enlarge.`);
      btns.forEach((b, j) => { b.setAttribute('aria-selected', j === i); b.tabIndex = j === i ? 0 : -1; });
      // keep the active tab visible by scrolling the tab row only, never the page
      const b = btns[i], l = b.offsetLeft - tabs.offsetLeft, r = l + b.offsetWidth;
      if (l < tabs.scrollLeft) tabs.scrollLeft = l;
      else if (r > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth;
    };
    const go = (i, instant) => {
      i = (i + shots.length) % shots.length;
      if (i === cur && img.src) return;
      cur = i;
      if (instant) return paint(i);
      img.classList.add('is-out');
      setTimeout(() => { paint(i); const done = () => img.classList.remove('is-out'); img.decode ? img.decode().then(done, done) : done(); }, 170);
    };

    tabs.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      go(k === 'Home' ? 0 : k === 'End' ? shots.length - 1 : cur + (k === 'ArrowRight' ? 1 : -1));
      btns[cur].focus();
    });
    prev.addEventListener('click', () => go(cur - 1));
    next.addEventListener('click', () => go(cur + 1));
    stage.addEventListener('click', () => open(shots, cur, (i) => go(i, true)));

    if (shots.length < 2) { tabs.hidden = true; nav.hidden = true; }
    v.replaceChildren(tabs, stage, foot);
    v.classList.add('is-on');
    paint(0);
    // warm the next screens once the page is idle so tab changes feel instant
    const warm = () => shots.slice(1).forEach(s => { const p = new Image(); p.src = s.src; });
    'requestIdleCallback' in window ? requestIdleCallback(warm, { timeout: 4000 }) : setTimeout(warm, 2500);
  });

  /* ── top bar: border once scrolled, and mark the current section ── */
  const top = $('.top');
  if (top) {
    const stuck = () => top.classList.toggle('is-stuck', scrollY > 8);
    addEventListener('scroll', stuck, { passive: true }); stuck();
    const links = $$('.top__nav a');
    const secs = links.map(a => $(a.getAttribute('href'))).filter(Boolean);
    if ('IntersectionObserver' in window && secs.length) {
      const seen = new Map();
      const io = new IntersectionObserver((es) => {
        es.forEach(e => seen.set(e.target, e.isIntersecting));
        const now = secs.filter(s => seen.get(s)).pop();
        links.forEach(a => a.getAttribute('href') === (now ? '#' + now.id : '') ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current'));
      }, { rootMargin: '-35% 0px -55% 0px' });
      secs.forEach(s => io.observe(s));
    }
  }

  /* ── experience: one row open at a time ── */
  const roles = $$('details.role');
  roles.forEach(d => d.addEventListener('toggle', () => { if (d.open) roles.forEach(o => { if (o !== d) o.open = false; }); }));

  /* ── the seal stamps again when pressed ── */
  const seal = $('.seal');
  if (seal) seal.addEventListener('click', () => {
    seal.classList.remove('is-again'); void seal.offsetWidth; seal.classList.add('is-again');
  });
})();
