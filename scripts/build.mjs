// Generates the static site in /site from the data in /src/data.
// Usage: npm run build
import fs from 'node:fs';
import path from 'node:path';
import {
  SRC, OUT, LAYOUTS, loadProject, resolveWidget, pageHeight,
  pictureRemote, slideRemote, localAssetName,
} from './lib.mjs';

const SITE_URL = 'https://siamoelvira.com';
const config = JSON.parse(fs.readFileSync(path.join(SRC, 'data/config.json'), 'utf8'));
const { project, pages } = loadProject();
const pageById = new Map(pages.map((p) => [p._id, p]));
const textStyles = new Map(project.textStyles.project.map((s) => [s.name, s]));
const usedAssets = new Set();
// Placeholder replaced per page with the relative path to the site root, so pages also open from disk.
const ASSET_ROOT = '%ROOT%';

// ---------- small helpers ----------

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n) => {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(v) ? v : 0;
};
const px = (n) => `${num(n)}px`;

// "RRGGBB" + opacity 0..1
function rgba(hex, alpha = 1) {
  const h = String(hex || '000000').replace('#', '').slice(0, 6).padEnd(6, '0');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = Math.max(0, Math.min(1, alpha));
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${num(a)})`;
}
// "RRGGBBAA" where AA is a hex percentage (64 = 100%)
function rgbaHexPct(v) {
  const s = String(v || '');
  const pct = s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 100;
  return rgba(s.slice(0, 6), pct / 100);
}
const pct = (v, def = 100) => (v === undefined || v === null || v === '' ? def : Number(v)) / 100;

const style = (obj) => Object.entries(obj)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}:${v}`).join(';');

const FONT = 'var(--font)';

// Inter is narrower than Graphik, the original typeface, and the gap grows with font size.
// Extra spacing per character (px), measured against the live site, keeps the same line breaks.
const TRACKING = {
  400: [[12, 0.07], [18, 0.1], [20, 0.4], [26, 0.92], [32, 1.63], [36, 1.78], [56, 2.63], [62, 3.21]],
  500: [[12, 0], [20, 0.27], [36, 1.38], [40, 1.5]],
};
function extraSpacing(size, weight) {
  const table = Number(weight) >= 500 ? TRACKING[500] : TRACKING[400];
  if (size <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [s1, v1] = table[i];
    const [s0, v0] = table[i - 1];
    if (size <= s1) return v0 + ((v1 - v0) * (size - s0)) / (s1 - s0);
  }
  const [sl, vl] = table[table.length - 1];
  return (vl / sl) * size;
}
function track(letterSpacing, size, weight, fit = 0) {
  return px(Number(letterSpacing || 0) + extraSpacing(Number(size || 16), weight || 400) + fit);
}

// Per-element fine-tuning (src/data/text-fit.json), keyed by element id and optional @layout.
const textFit = JSON.parse(fs.readFileSync(path.join(SRC, 'data/text-fit.json'), 'utf8'));
const fitFor = (o, ctx) => textFit[`${o._id}@${ctx.layout.name}`] ?? textFit[o._id] ?? 0;

function asset(url) {
  if (!url) return '';
  const name = localAssetName(url);
  usedAssets.add(name);
  return `${ASSET_ROOT}assets/img/${name}`;
}

// Absolute path of a page on the final domain (canonical URL, sitemap).
function pagePath(page) {
  return page.uri === 'home' ? '/' : `/${page.uri}/`;
}
// Relative link to a page, so the site works on any domain, in a subfolder or from disk.
function pageHref(page) {
  return page.uri === 'home' ? '%ROOT%' : `%ROOT%${page.uri}/`;
}

// Link of an element: page id, page uri or external URL.
function resolveLink(link, target) {
  if (!link) return null;
  const s = String(link);
  if (pageById.has(s)) return { href: pageHref(pageById.get(s)), pageId: s, target: '_self' };
  const byUri = pages.find((p) => p.uri === s);
  if (byUri) return { href: pageHref(byUri), pageId: byUri._id, target: '_self' };
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s)) return { href: `mailto:${s}`, target: '_self' };
  const href = /^(https?:|mailto:|tel:)/.test(s) ? s : `https://${s}`;
  return { href, target: target === '_blank' ? '_blank' : '_self' };
}

const linkAttrs = (l) => (l ? ` href="${esc(l.href)}"${l.target === '_blank' ? ' target="_blank" rel="noopener"' : ''}` : '');

// ---------- per-layout render context ----------

class Ctx {
  constructor(page, layout) {
    this.page = page;
    this.layout = layout;
    this.css = [];
    this.counter = 0;
  }
  id(prefix) { return `${prefix}${this.layout.name[0]}${++this.counter}`; }
}

function box(o, extra = {}) {
  return {
    left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h),
    'z-index': o.z ?? 1,
    transform: o.angle ? `rotate(${num(o.angle)}deg)` : undefined,
    ...extra,
  };
}

// ---------- animations ----------

function animAttrs(o, ctx, elId) {
  const list = (o.animation || []).filter((a) => a.steps && a.steps.length);
  if (!list.length) return '';
  const scroll = [];
  for (const a of list) {
    const s = a.steps[0];
    if (a.type === 'load') {
      const from = [];
      const to = [];
      const trans = [];
      const timing = `${num(s.duration ?? 1)}s cubic-bezier(.42,0,.58,1) ${num(s.delay ?? 0)}s`;
      if (s.use_opacity) { from.push(`opacity:${pct(s.from_opacity, 0)}`); to.push(`opacity:${pct(s.opacity)}`); trans.push(`opacity ${timing}`); }
      if (s.use_move) { from.push('translate:0 0'); to.push(`translate:${px(s.dx || 0)} ${px(s.dy || 0)}`); trans.push(`translate ${timing}`); }
      if (s.use_scale) { from.push(`scale:${pct(s.from_scale)}`); to.push(`scale:${pct(s.scale)}`); trans.push(`scale ${timing}`); }
      if (s.use_rotate) { from.push(`rotate:${num(s.from_rotate || 0)}deg`); to.push(`rotate:${num(s.rotate || 0)}deg`); trans.push(`rotate ${timing}`); }
      if (!from.length) continue;
      ctx.css.push(`.js #${elId}{${from.join(';')}}`);
      ctx.css.push(`.js #${elId}.played{${to.join(';')};transition:${trans.join(',')}}`);
      return ` data-load="${s.startWhenInView === false ? 'now' : 'view'}"` + scrollAttr();
    }
    if (a.type === 'hover') {
      const props = [];
      if (s.use_scale) props.push(`scale:${pct(s.scale)}`);
      if (s.use_rotate) props.push(`rotate:${num(s.rotate || 0)}deg`);
      if (s.use_opacity) props.push(`opacity:${pct(s.opacity)}`);
      if (!props.length) continue;
      const dur = `${num(s.duration ?? 1)}s`;
      if (s.loop === 'swing') {
        const kf = `k${elId}`;
        ctx.css.push(`@keyframes ${kf}{from{${s.use_scale ? `scale:${pct(s.from_scale)}` : ''}}to{${props.join(';')}}}`);
        ctx.css.push(`@media (hover:hover){#${elId}:hover{animation:${kf} ${dur} cubic-bezier(.42,0,.58,1) infinite alternate}}`);
      } else {
        ctx.css.push(`#${elId}{transition:scale ${dur} cubic-bezier(.42,0,.58,1),rotate ${dur} cubic-bezier(.42,0,.58,1),opacity ${dur}}`);
        ctx.css.push(`@media (hover:hover){#${elId}:hover{${props.join(';')}}}`);
      }
    }
    if (a.type === 'scroll') {
      for (const st of a.steps) {
        const step = { o: st.start_offset || 0 };
        if (st.use_move) { step.dx = st.dx || 0; step.dy = st.dy || 0; }
        if (st.use_scale) { step.s = [pct(st.from_scale), pct(st.scale)]; }
        if (st.use_rotate) { step.r = [st.from_rotate || 0, st.rotate || 0]; }
        if (st.use_opacity) { step.a = [pct(st.from_opacity), pct(st.opacity)]; }
        const dist = st.use_move ? Math.hypot(st.dx || 0, st.dy || 0) : 300;
        step.d = num(dist / (st.speed || 1));
        scroll.push(step);
      }
    }
  }
  return scrollAttr();

  function scrollAttr() {
    return scroll.length ? ` data-scroll='${JSON.stringify({ y: num(o.y), steps: scroll })}'` : '';
  }
}

// ---------- text ----------

function charStyles(block, st) {
  const len = [...block.text].length;
  const per = Array.from({ length: len }, () => ({}));
  if (!st || !st.inlineStyles) return per;
  const { styles, keys, values } = st.inlineStyles;
  for (const r of styles || []) {
    for (const pair of r.styles) {
      const [ki, vi] = pair.split(';').map(Number);
      for (let i = r.offset; i < Math.min(len, r.offset + r.length); i++) per[i][keys[ki]] = values[vi];
    }
  }
  return per;
}

function inlineCss(s, base, def, fit) {
  const out = {};
  if (s.FONT_SIZE) out['font-size'] = px(s.FONT_SIZE);
  if (s.COLOR) out.color = rgbaHexPct(s.COLOR);
  if (s.FONT_WEIGHT) out['font-weight'] = s.FONT_WEIGHT;
  if (s.FONT_STYLE) out['font-style'] = s.FONT_STYLE;
  out['letter-spacing'] = track(s.LETTER_SPACING ?? def.ls, s.FONT_SIZE ?? def.size, s.FONT_WEIGHT ?? def.weight, fit);
  if (s.DECORATION) out['text-decoration'] = s.DECORATION;
  if (s.TEXT_TRANSFORM) out['text-transform'] = s.TEXT_TRANSFORM;
  // drop values equal to the block defaults to keep markup small
  for (const k of Object.keys(out)) if (base[k] === out[k]) delete out[k];
  return out;
}

function linkStyleCss() {
  const rules = [];
  for (const ls of project.linkStyles.project) {
    const cls = `.${ls.name}`;
    const part = (p) => {
      const underline = p.type === 'Solid'
        ? `linear-gradient(${rgbaHexPct(p.color)},${rgbaHexPct(p.color)}) 0 100%/1px ${px(p.size || 1)} repeat-x`
        : 'none';
      return `color:${rgbaHexPct(p.textColor)};background:${underline};padding-bottom:${px((p.padding || 0) + 1)}`;
    };
    const { link, hover, current } = ls.style;
    rules.push(`${cls}{text-decoration:none;${part(link)}}`);
    rules.push(`${cls} span{color:inherit!important}`);
    rules.push(`${cls}:hover{${part(hover)}}`);
    rules.push(`${cls}.current{${part(current)}}`);
  }
  return rules.join('\n');
}

function renderBlocks(o, ctx) {
  const meta = new Map((o.blocksMeta || []).map((m) => [m.key, m.data || {}]));
  const stl = new Map((o.styles || []).map((s) => [s.key, s]));
  const entities = o.entityMap || {};
  const fit = fitFor(o, ctx);
  return (o.blocks || []).map((block) => {
    const data = meta.get(block.key) || {};
    const ts = textStyles.get(data.textStyle);
    const tsp = ts ? ts.cssProperties : {};
    const tag = ts && /^h[1-6]$/.test(ts.tag) ? ts.tag : 'p';
    const chars = charStyles(block, stl.get(block.key));
    const first = chars[0] || {};
    const pad = data.paddings || {};
    const align = (data.align || '').replace('align-', '') || tsp.textAlign || 'left';
    const def = {
      size: first.FONT_SIZE ?? tsp.fontSize ?? 16,
      weight: first.FONT_WEIGHT ?? tsp.fontWeight ?? 400,
      ls: first.LETTER_SPACING ?? tsp.letterSpacing ?? 0,
    };
    const blockCss = {
      'font-family': FONT,
      'font-size': px(def.size),
      'font-weight': def.weight,
      'font-style': first.FONT_STYLE ?? tsp.fontStyle ?? 'normal',
      color: rgbaHexPct(first.COLOR ?? tsp.color ?? '00000064'),
      'letter-spacing': track(def.ls, def.size, def.weight, fit),
      'line-height': px(data.lineHeight ?? tsp.lineHeight ?? 20),
      'text-align': align,
      'text-transform': tsp.textTransform && tsp.textTransform !== 'none' ? tsp.textTransform : undefined,
      'padding-top': pad.top ? px(pad.top) : (tsp.paddingTop ? px(tsp.paddingTop) : undefined),
      'padding-bottom': pad.bottom ? px(pad.bottom) : undefined,
      'padding-left': pad.left ? px(pad.left) : undefined,
      'padding-right': pad.right ? px(pad.right) : undefined,
    };
    const text = [...block.text];
    if (!text.length) return `<${tag} style="${style(blockCss)}"><br></${tag}>`;

    // entity (link) per character
    const ent = new Array(text.length).fill(null);
    for (const r of block.entityRanges || []) {
      for (let i = r.offset; i < Math.min(text.length, r.offset + r.length); i++) ent[i] = r.key;
    }
    // group consecutive characters with same style + entity
    const runs = [];
    for (let i = 0; i < text.length; i++) {
      const sig = JSON.stringify(chars[i]) + '|' + ent[i];
      const last = runs[runs.length - 1];
      if (last && last.sig === sig) last.text += text[i];
      else runs.push({ sig, text: text[i], st: chars[i], ent: ent[i] });
    }
    let html = '';
    let openLink = null;
    for (const run of runs) {
      if (openLink !== run.ent) {
        if (openLink !== null) html += '</a>';
        openLink = run.ent;
        if (run.ent !== null) {
          const e = entities[run.ent] || entities[String(run.ent)];
          const d = (e && e.data) || {};
          const target = resolveLink(d.type === 'Page' ? (d.pageId || d.pageUri || d.url) : d.url, d.target);
          const current = target && target.pageId === ctx.page._id ? ' current' : '';
          const close = d.closeTip ? ' data-close-menu' : '';
          html += `<a class="${esc(d.linkStyle || 'link-1')}${current}"${linkAttrs(target)}${close}>`;
        }
      }
      const css = style(inlineCss(run.st, blockCss, def, fit));
      const t = esc(run.text).replace(/\r?\n|\r/g, '<br>');
      html += css ? `<span style="${css}">${t}</span>` : t;
    }
    if (openLink !== null) html += '</a>';
    // a trailing carriage return opens an empty last line in the original
    if (block.text.endsWith('\r')) html += '<br>';
    return `<${tag} style="${style(blockCss)}">${html}</${tag}>`;
  }).join('');
}

function renderText(o, ctx) {
  const id = ctx.id('t');
  const anim = animAttrs(o, ctx, id);
  const align = o.verticalAlign === 'middle' ? 'center' : o.verticalAlign === 'bottom' ? 'flex-end' : undefined;
  return `<div id="${id}" data-id="${o._id}" class="w text" style="${style(box(o, { 'justify-content': align }))}"${anim}>${renderBlocks(o, ctx)}</div>`;
}

// ---------- shapes ----------

function renderShape(o, ctx) {
  const id = ctx.id('s');
  const link = resolveLink(o.clickLink || o.clickPage, o.clickTarget);
  const tag = link ? 'a' : 'div';
  const anim = animAttrs(o, ctx, id);
  let inner = '';
  const css = box(o);
  if (o.tp === 'line') {
    const weight = o.weight || 1;
    inner = `<i style="${style({ top: px((o.h - weight) / 2), 'border-top': `${px(weight)} ${o.stroke || 'solid'} ${rgba(o.bg_color || o.color, o.bg_opacity ?? 1)}` })}"></i>`;
    css.class = undefined;
  } else {
    const r = o.radius_rect_independent
      ? [o.radius_rect_tl, o.radius_rect_tr, o.radius_rect_br, o.radius_rect_bl].map(px).join(' ')
      : px(o.radius || 0);
    Object.assign(css, {
      background: rgba(o.bg_color, o.bg_opacity ?? 1),
      'border-radius': r,
      border: o.borders ? `${px(o.borders)} solid ${rgba(o.color, o.opacity ?? 1)}` : undefined,
    });
  }
  return `<${tag} id="${id}" class="w shape${o.tp === 'line' ? ' line' : ''}"${linkAttrs(link)} style="${style(css)}"${anim}>${inner}</${tag}>`;
}

// ---------- pictures ----------

function shadowCss(o) {
  if (!o.isShadowEnabled || !o.shadow) return undefined;
  const s = o.shadow;
  return `drop-shadow(${px(s.x || 0)} ${px(s.y || 0)} ${px(s.blur || 0)} ${rgbaHexPct(s.color)})`;
}

function renderPicture(o, ctx) {
  const id = ctx.id('p');
  const link = resolveLink(o.clickLink, o.clickTarget);
  const tag = link ? 'a' : 'div';
  const anim = animAttrs(o, ctx, id);
  const src = asset(pictureRemote(o));
  const isSvg = o.picture && o.picture.type === 'svg';
  const radius = [o.border_radius_tl, o.border_radius_tr, o.border_radius_br, o.border_radius_bl];
  const css = box(o, {
    'border-radius': radius.some(Boolean) ? radius.map((r) => px(r || 0)).join(' ') : (o.border_radius ? px(o.border_radius) : undefined),
    opacity: o.opacity !== undefined && o.opacity !== 1 ? o.opacity : undefined,
    filter: shadowCss(o),
  });
  const imgCss = style({
    'object-fit': isSvg ? 'contain' : 'cover',
    opacity: o.pic_opacity !== undefined && o.pic_opacity !== 1 ? o.pic_opacity : undefined,
  });
  const label = link ? ` aria-label="${esc(o.name || 'Apri')}"` : '';
  return `<${tag} id="${id}" class="w pic"${linkAttrs(link)}${label} style="${style(css)}"${anim}><img src="${src}" alt="" loading="lazy" decoding="async" style="${imgCss}"></${tag}>`;
}

// ---------- buttons ----------

function buttonState(o, prefix = '') {
  const g = (k) => o[`${prefix}${k}`];
  const out = {};
  if (g('background-color') !== undefined) out.background = rgba(g('background-color'), pct(g('background-color-opacity')));
  if (g('border-width') !== undefined) out['border-width'] = px(g('border-width'));
  if (g('border-color') !== undefined) out['border-color'] = rgba(g('border-color'), pct(g('border-color-opacity')));
  if (g('border-radius') !== undefined) out['border-radius'] = px(g('border-radius'));
  if (g('color') !== undefined) out.color = rgba(g('color'), pct(g('color-opacity')));
  if (g('font-size') !== undefined) out['font-size'] = px(g('font-size'));
  if (g('font-weight') !== undefined) out['font-weight'] = g('font-weight');
  if (g('font-style') !== undefined) out['font-style'] = g('font-style');
  if (g('letter-spacing') !== undefined || g('font-size') !== undefined) {
    out['letter-spacing'] = track(g('letter-spacing') ?? o['letter-spacing'], g('font-size') ?? o['font-size'], g('font-weight') ?? o['font-weight']);
  }
  return out;
}

function renderButton(o, ctx, fixed = false) {
  const id = ctx.id('b');
  const link = resolveLink(o.clickLink, o.clickTarget);
  // like the original, only shared navigation elements show the "current page" state
  const isCurrent = !!(o.is_global && link && link.pageId === ctx.page._id);
  const base = buttonState(o);
  const hover = buttonState(o, 'hover-');
  const current = buttonState(o, 'current-');
  const shift = o.baselineShift ? `translateY(${px(-o.baselineShift)})` : undefined;
  const css = fixed ? fixedBox(o, ctx) : box(o);
  if (o.transition) css.transition = `all ${num(o.transitionTime || 0.2)}s`;
  ctx.css.push(`#${id}{${style({ ...base, 'border-style': 'solid' })}}`);
  if (Object.keys(hover).length) ctx.css.push(`@media (hover:hover){#${id}:hover{${style(hover)}}}`);
  if (isCurrent && Object.keys(current).length) ctx.css.push(`#${id}.current{${style(current)}}`);
  const tag = link ? 'a' : 'span';
  return `<${tag} id="${id}" class="w btn${isCurrent ? ' current' : ''}"${linkAttrs(link)} style="${style(css)}"><span style="${style({ transform: shift })}">${esc(o.text)}</span></${tag}>`;
}

// Fixed elements live in a viewport-sized layer that uses the same scale as the page.
// x/y are offsets from the anchor: edges for corners/sides, element centre for centred anchors.
function fixedBox(o, ctx) {
  const pos = o.fixed_position;
  const css = { width: px(o.w), height: px(o.h), 'z-index': o.z ?? 1 };
  if (/^[ns]$|^c$/.test(pos)) css.left = px(ctx.layout.width / 2 + o.x - o.w / 2);
  if (/e$/.test(pos)) css.right = px(o.x);
  if (/w$/.test(pos)) css.left = px(o.x);
  if (/^n/.test(pos)) css.top = px(o.y);
  if (/^s/.test(pos)) css.bottom = px(o.y);
  if (pos === 'c' || pos === 'e' || pos === 'w') css.top = `calc(50% + ${px(o.y - o.h / 2)})`;
  return css;
}

// ---------- video ----------

function videoEmbed(o) {
  if (o.provider_name === 'Vimeo') {
    const id = (o.video_id || String(o.url).match(/vimeo\.com\/(\d+)/)?.[1]);
    const q = new URLSearchParams({ title: '0', byline: '0', portrait: '0', color: o.color || '000', dnt: '1' });
    if (o.autoplay) { q.set('autoplay', '1'); q.set('autopause', '0'); }
    if (o.mute || o.autoplay) q.set('muted', '1');
    if (o.loop) q.set('loop', '1');
    return `https://player.vimeo.com/video/${id}?${q}`;
  }
  const id = o.video_id || String(o.url).match(/[?&]v=([\w-]+)/)?.[1];
  const q = new URLSearchParams({ rel: '0', playsinline: '1' });
  return `https://www.youtube-nocookie.com/embed/${id}?${q}`;
}

function renderVideo(o, ctx) {
  const id = ctx.id('v');
  const anim = animAttrs(o, ctx, id);
  const vs = o.video_styles || {};
  const css = box(o, { 'border-radius': vs.radius ? px(vs.radius) : undefined, background: '#000' });
  const src = videoEmbed(o);
  const title = esc(o.title || 'Video');
  let inner;
  if (o.custom_thumbnail && o.picture && !o.autoplay) {
    // Thumbnail first; the player loads only when the visitor presses play.
    const auto = src + (src.includes('?') ? '&' : '?') + 'autoplay=1';
    inner = `<button class="video-poster" type="button" data-src="${esc(auto)}" data-title="${title}" aria-label="Riproduci: ${title}"><img src="${asset(o.picture.url)}" alt="" loading="lazy" decoding="async"><span class="play" aria-hidden="true"></span></button>`;
  } else {
    inner = `<iframe src="${esc(src)}" title="${title}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>`;
  }
  return `<div id="${id}" class="w video" style="${style(css)}"${anim}>${inner}</div>`;
}

// ---------- slideshow ----------

function renderSlideshow(o, ctx) {
  const id = ctx.id('g');
  const t = o.theme_data || {};
  const pics = [...(o.pictures || [])].sort((a, b) => (a.num ?? 0) - (b.num ?? 0));
  const h = o.images_h || o.h;
  const css = box({ ...o, h });
  const slides = pics.map((p, i) => `<div class="slide"${i ? ' aria-hidden="true"' : ''}><img src="${asset(slideRemote(p))}" alt="" loading="lazy" decoding="async" style="object-fit:${t.fill === false ? 'contain' : 'cover'}"></div>`).join('');
  const ctrl = rgba(t.controls_color || 'ffffff', t.controls_opacity ?? 1);
  const arrows = t.arrows !== false && pics.length > 1
    ? `<button class="arrow prev" type="button" aria-label="Immagine precedente" style="color:${ctrl}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M19 7 10 16l9 9" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="arrow next" type="button" aria-label="Immagine successiva" style="color:${ctrl}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m13 7 9 9-9 9" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
    : '';
  const radius = px(t.radius ?? 0);
  const thumbs = t.thumbnails && pics.length > 1
    ? `<div class="thumbs" style="${style({ left: px(o.x), top: px(o.y + h + 12), width: px(o.w), 'z-index': o.z ?? 1 })}" data-for="${id}">` +
      pics.map((p, i) => `<button type="button" aria-label="Immagine ${i + 1}"${i ? '' : ' aria-current="true"'}><img src="${asset(slideRemote(p))}" alt="" loading="lazy" decoding="async"></button>`).join('') + '</div>'
    : '';
  return `<div id="${id}" class="w slideshow${t.show_on_hover ? ' hover-controls' : ''}" role="region" aria-roledescription="carosello" aria-label="Galleria" style="${style({ ...css, 'border-radius': radius })}" data-speed="${num(t.slider_transition ?? 0.5)}"><div class="track">${slides}</div>${arrows}</div>${thumbs}`;
}

// ---------- form ----------

function renderForm(o, ctx) {
  const id = ctx.id('f');
  const anim = animAttrs(o, ctx, id);
  const st = o.style || 'colored';
  const f = o[`style-${st}-fields`] || {};
  const bd = o[`style-${st}-button-default`] || {};
  const bh = o[`style-${st}-button-hover`] || {};
  const inherit = (v, fallback) => (v === 'inherit' || v === undefined ? fallback : v);
  const fieldH = 39;
  const gutter = f.gutter ?? 8;
  const font = {
    'font-family': FONT,
    'font-weight': f['font-weight'] ?? 400,
    'font-style': f['font-style'] ?? 'normal',
    'font-size': px(f['font-size'] ?? 12),
    'letter-spacing': track(f['letter-spacing'], f['font-size'] ?? 12, f['font-weight']),
  };
  const field = {
    background: rgba(f.color, pct(f.opacity)),
    'border-radius': px(f['border-radius'] ?? 0),
    'box-shadow': f['border-width'] ? `inset 0 0 0 ${px(f['border-width'])} ${rgba(f['border-color'], pct(f['border-opacity']))}` : 'none',
    color: rgba(f['text-color'], pct(f['text-opacity'])),
    'text-align': f['text-align'] || 'left',
    'margin-bottom': px(gutter),
    ...font,
  };
  ctx.css.push(`#${id} .field{${style(field)}}`);
  ctx.css.push(`#${id} .field::placeholder{color:${rgba(f['text-color'], pct(f['text-opacity']))};opacity:1}`);
  const btn = {
    background: rgba(bd.color, pct(bd.opacity)),
    color: rgba(bd['text-color'], pct(bd['text-opacity'])),
    'border-radius': px(inherit(bd['border-radius'], f['border-radius'] ?? 0)),
    'box-shadow': bd['border-width'] ? `inset 0 0 0 ${px(bd['border-width'])} ${rgba(bd['border-color'], pct(bd['border-opacity']))}` : 'none',
    'text-align': bd['text-align'] || 'center',
    ...font,
    'font-size': px(inherit(bd['font-size'], f['font-size'] ?? 12)),
    transition: bh.transition ? 'background-color .3s, color .3s' : undefined,
  };
  ctx.css.push(`#${id} .submit{${style(btn)}}`);
  const hov = {};
  if (bh.color && bh.color !== 'inherit') hov.background = rgba(bh.color, pct(inherit(bh.opacity, 100)));
  if (bh['text-color'] && bh['text-color'] !== 'inherit') hov.color = rgba(bh['text-color'], pct(inherit(bh['text-opacity'], 100)));
  if (Object.keys(hov).length) ctx.css.push(`@media (hover:hover){#${id} .submit:hover{${style(hov)}}}`);

  const fields = [...(o.fields || [])].sort((a, b) => a.sort - b.sort).map((fd, i) => {
    const name = esc(fd.caption);
    const req = fd.optional ? '' : ' required';
    const fid = `${id}-${i}`;
    const label = `<label class="sr-only" for="${fid}">${name}</label>`;
    if (fd.tp === 'text') {
      const rows = fd.rows || 1;
      const h = rows > 1 ? 95 : fieldH;
      return `${label}<textarea class="field" id="${fid}" name="${name}" placeholder="${name}" rows="${rows}" style="height:${px(h)}"${req}></textarea>`;
    }
    const type = fd.tp === 'email' ? 'email' : fd.tp === 'phone' ? 'tel' : 'text';
    const ac = fd.tp === 'email' ? 'email' : fd.tp === 'name' ? 'name' : 'off';
    return `${label}<input class="field" id="${fid}" type="${type}" name="${name}" placeholder="${name}" autocomplete="${ac}" style="height:${px(fieldH)}"${req}>`;
  }).join('');
  const action = esc(config.formEndpoint);
  return `<form id="${id}" class="w form" method="post" action="${action}" style="${style(box(o, { height: 'auto' }))}"${anim}>` +
    `<input type="hidden" name="_subject" value="Nuovo messaggio dal sito (${esc(ctx.page.title)})">` +
    `<input type="text" name="_honey" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">` +
    fields +
    `<button class="submit" type="submit" style="height:${px(fieldH)}" data-sent="${esc(o.button_caption_after_submit || config.formThanks)}">${esc(o['button-caption'] || 'Invia')}</button>` +
    `<p class="form-status" role="status" aria-live="polite"></p></form>`;
}

// ---------- hotspot (mobile menu) ----------

function renderHotspot(o, ctx) {
  const id = ctx.id('m');
  const css = fixedBox(o, ctx);
  const tipBg = rgba(o['tip_background-color'] || 'ffffff', pct(o['tip_background-color-opacity']));
  // children are laid out from the top of the panel
  const kids = (o.wids || []).map((c) => resolveWidget(c, ctx.layout, ctx.page._id)).filter((c) => !c.hidden);
  const top = Math.min(...kids.map((c) => c.y ?? 0));
  const children = kids.map((c) => renderWidget({ ...c, x: c.x ?? 0, y: (c.y ?? 0) - top }, ctx)).join('');
  const fullscreen = !!o['tip_box-fullscreen'];
  const tipCss = style({
    width: px(o.tip_w), height: px(o.tip_h), background: tipBg,
    'border-radius': px(o['tip_border-radius'] || 0),
    'box-shadow': o['tip_box-shadow'] ? '0 4px 24px rgba(0,0,0,.18)' : undefined,
    left: fullscreen ? undefined : px(o.tip_x), top: fullscreen ? undefined : px(o.tip_y),
  });
  const color = rgba(o.bg_color || '37E1A9', o.bg_opacity ?? 1);
  return `<button id="${id}" class="w menu-btn" type="button" aria-expanded="false" aria-controls="${id}-tip" aria-label="Menu" style="${style({ ...css, color })}">` +
    '<svg viewBox="0 0 24 20" aria-hidden="true"><rect y="0" width="24" height="4" rx="2"/><rect y="8" width="24" height="4" rx="2"/><rect y="16" width="24" height="4" rx="2"/></svg></button>' +
    `<div id="${id}-tip" class="menu-tip${fullscreen ? ' fullscreen' : ''}" hidden><div class="menu-panel" style="${tipCss}">${children}` +
    '<button class="menu-close" type="button" aria-label="Chiudi menu"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div></div>';
}

// ---------- dispatcher ----------

function renderWidget(o, ctx) {
  switch (o.type) {
    case 'text': return renderText(o, ctx);
    case 'shape': return renderShape(o, ctx);
    case 'picture': return renderPicture(o, ctx);
    case 'button': return renderButton(o, ctx);
    case 'video': return renderVideo(o, ctx);
    case 'slideshow': return renderSlideshow(o, ctx);
    case 'form': return renderForm(o, ctx);
    default: return '';
  }
}

function renderLayout(page, layout) {
  const ctx = new Ctx(page, layout);
  const height = pageHeight(page, layout);
  const widgets = page.widgets
    .map((w) => resolveWidget(w, layout, page._id))
    .filter((o) => !o.hidden && o.type !== 'background')
    .map((o) => {
      // elements pinned to the bottom (e.g. the footer) keep their distance from the page end
      if (o.sticked === 'bottom' && o.sticked_margin != null && !o.fixed_position) return { ...o, y: height - o.sticked_margin - o.h };
      if (o.sticked === 'top' && o.sticked_margin != null && !o.fixed_position) return { ...o, y: o.sticked_margin };
      return o;
    });
  const bg = page.widgets.find((w) => w.type === 'background');
  const bgColor = bg ? rgba(resolveWidget(bg, layout, page._id).color || 'ffffff', 1) : '#fff';

  const fixed = [];
  const flow = [];
  for (const o of widgets.sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
    if (o.type === 'hotspot') fixed.push(renderHotspot(o, ctx));
    else if (o.fixed_position) fixed.push(o.type === 'button' ? renderButton(o, ctx, true) : renderWidget(o, ctx));
    else flow.push(renderWidget(o, ctx));
  }
  const html = `<div class="layout layout-${layout.name}" data-width="${layout.width}" style="--w:${layout.width}px;--h:${px(height)};background:${bgColor}">` +
    `<div class="fixed-layer"><div class="fixed-canvas">${fixed.join('')}</div></div>` +
    `<main class="canvas">${flow.join('')}</main></div>`;
  return { html, css: ctx.css.join('\n'), bgColor };
}

// ---------- page ----------

function seoText(page) {
  // Plain text of the page, for search engines and screen readers (desktop layout).
  return page.widgets.filter((w) => w.type === 'text' && !w.hidden)
    .map((w) => w.blocks.map((b) => b.text).join(' ')).join(' ').slice(0, 155);
}

function renderPage(page) {
  const layouts = LAYOUTS.map((l) => renderLayout(page, l));
  const isHome = page.uri === 'home';
  const title = isHome ? project.title : `${page.title} — ${project.title}`;
  const description = isHome ? (project.description || seoText(page)) : seoText(page);
  const url = SITE_URL + pagePath(page);
  return `<!doctype html>
<html lang="it" data-root="%ROOT%">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(project.title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/assets/og-image.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="%ROOT%favicon.svg" type="image/svg+xml">
<link rel="preload" href="%ROOT%assets/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="%ROOT%assets/css/site.css">
<script>(function(){var d=document.documentElement,m=window.matchMedia,w=d.clientWidth,c=m('(max-width:767.98px)').matches?320:m('(min-width:768px) and (max-width:1023.98px) and (pointer:coarse)').matches?768:1024;if(c===1024)w=Math.min(Math.max(w,769),3600);d.style.setProperty('--z',w/c);d.classList.add('js')})();</script>
<script src="%ROOT%assets/js/site.js" defer></script>
<style>
${linkStyleCss()}
${layouts.map((l) => l.css).join('\n')}
</style>
</head>
<body style="background:${layouts[0].bgColor}">
${layouts.map((l) => l.html).join('\n')}
</body>
</html>
`;
}

// ---------- write output ----------

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const page of pages) {
  const dir = page.uri === 'home' ? OUT : path.join(OUT, page.uri);
  fs.mkdirSync(dir, { recursive: true });
  const root = page.uri === 'home' ? './' : '../';
  fs.writeFileSync(path.join(dir, 'index.html'), renderPage(page).replaceAll('%ROOT%', root));
}

// 404 page reuses the home layout
fs.copyFileSync(path.join(OUT, 'index.html'), path.join(OUT, '404.html'));

// static assets
const copy = (from, to) => fs.cpSync(path.join(SRC, from), path.join(OUT, to), { recursive: true });
copy('assets/css', 'assets/css');
copy('assets/js', 'assets/js');
copy('assets/fonts', 'assets/fonts');
fs.mkdirSync(path.join(OUT, 'assets/img'), { recursive: true });
const missing = [];
for (const name of usedAssets) {
  const from = path.join(SRC, 'assets/img', name);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, 'assets/img', name));
  else missing.push(name);
}
for (const [from, to] of [['assets/favicon.svg', 'favicon.svg'], ['assets/og-image.jpg', 'assets/og-image.jpg']]) {
  if (fs.existsSync(path.join(SRC, from))) fs.copyFileSync(path.join(SRC, from), path.join(OUT, to));
}
for (const f of ['CNAME', 'robots.txt']) {
  const from = path.join(SRC, f);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, f));
}
fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${SITE_URL}${pagePath(p)}</loc></url>`).join('\n')}\n</urlset>\n`);

console.log(`Built ${pages.length} pages, ${usedAssets.size} images → ${path.relative(process.cwd(), OUT) || OUT}`);
if (missing.length) {
  console.log(`Missing ${missing.length} images (run npm run download):`);
  missing.forEach((m) => console.log('  ', m));
  process.exitCode = 1;
}
