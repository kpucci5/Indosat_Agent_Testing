// Small DOM helpers shared by every page.
export const $ = (id) => document.getElementById(id);

// h('div', { class: 'x', onclick: fn, text: 'hi' }, child, [children]) -> element
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'class') el.className = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

export function svgChev() {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'chev'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M6 3l5 5-5 5'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2');
  s.appendChild(p);
  return s;
}

export function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return iso; }
}

export function fillSelect(sel, opts, cur) {
  sel.replaceChildren(...opts.map((o) => {
    const v = typeof o === 'string' ? o : o.v, t = typeof o === 'string' ? o : o.t;
    return h('option', { value: v, selected: v === cur }, t);
  }));
}
