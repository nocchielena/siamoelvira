// Shared helpers: read the site data and resolve each element for a given layout.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'src');
export const OUT = path.join(ROOT, 'site');

// The three layouts of the original design: canvas width in px.
export const LAYOUTS = [
  { name: 'desktop', key: null, width: 1024 },
  { name: 'tablet', key: 'viewport_tablet_portrait', width: 768 },
  { name: 'phone', key: 'viewport_phone_portrait', width: 320 },
];

export function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadProject() {
  const project = readJSON(path.join(SRC, 'data/project.json'));
  const pages = project.pages.map((p) => ({
    ...p,
    widgets: readJSON(path.join(SRC, 'data/pages', `${p.uri}.json`)),
  }));
  // Shared ("global") elements are stored on one page but appear on every page,
  // subject to their per-page visibility.
  const globals = new Map();
  for (const p of pages) for (const w of p.widgets) if (w.is_global && !globals.has(w._id)) globals.set(w._id, w);
  for (const p of pages) {
    const own = new Set(p.widgets.map((w) => w._id));
    for (const [id, w] of globals) if (!own.has(id)) p.widgets.push(w);
  }
  return { project, pages };
}

// Merge layout-specific overrides and per-page values of shared (global) elements.
export function resolveWidget(w, layout, pageId) {
  const o = layout.key ? { ...w, ...(w[layout.key] || {}) } : { ...w };
  const pick = (list) => {
    if (!Array.isArray(list)) return undefined;
    const hit = list.find((e) => e.pid === pageId) ?? list.find((e) => e.pid === 'default');
    return hit ? hit.value : undefined;
  };
  if (o.is_global) {
    const hidden = pick(o._hidden);
    if (hidden !== undefined && hidden !== null) o.hidden = hidden;
    const z = pick(o._z);
    if (z !== undefined && z !== null) o.z = z;
  }
  return o;
}

export function pageHeight(page, layout) {
  const v = layout.key && page[layout.key];
  return v && v.enabled !== false && v.height ? v.height : page.height;
}

// Picture element -> remote URL of the image as cropped for this layout.
export function pictureRemote(o) {
  const p = o.picture;
  if (!p) return null;
  if (p.type === 'svg' || p.type === 'gif' || o.cropW == null) return p.url;
  const q = new URLSearchParams();
  const want = Math.ceil(o.w * 3);
  if (want < o.cropW) q.set('w', String(want));
  for (const [k, v] of [['cX', o.cropX], ['cY', o.cropY], ['cW', o.cropW], ['cH', o.cropH]]) q.set(k, String(v));
  return `${p.lambdaUrl || p.url}?${q}`;
}

export function slideRemote(pic) {
  return pic.lambdaUrl ? `${pic.lambdaUrl}?w=1800` : pic.url;
}

// Deterministic local file name for a remote asset.
export function localAssetName(url) {
  const clean = url.split('?')[0];
  const base = path.basename(clean).replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
  let ext = (path.extname(clean) || '.jpg').toLowerCase();
  if (ext === '.jpeg') ext = '.jpg';
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${base}-${hash}${ext}`;
}

// Every remote asset the site needs (cropped variants used by the pages).
export function collectAssets({ pages }) {
  const urls = new Set();
  const add = (u) => u && /^https?:/.test(u) && urls.add(u);
  for (const page of pages) {
    for (const layout of LAYOUTS) {
      for (const raw of page.widgets) {
        const o = resolveWidget(raw, layout, page._id);
        if (o.type === 'picture') add(pictureRemote(o));
        if (o.type === 'slideshow') (o.pictures || []).forEach((p) => add(slideRemote(p)));
        if (o.type === 'video' && o.custom_thumbnail && o.picture) add(o.picture.url);
        if (o.type === 'hotspot') { add(o.rasterUrl); add(o.raster2xUrl); add(o.clickRaster2xUrl); }
        if (o.type === 'hotspot') for (const c of o.wids || []) if (c.type === 'picture') add(pictureRemote(c));
        if (o.type === 'button' && o.icon_enabled) add(o.icon_raster2xUrl || o.icon_rasterUrl);
      }
    }
  }
  return [...urls];
}

// Full-resolution originals, kept as an archive of the media you own.
export function collectOriginals({ pages }) {
  const urls = new Set();
  const walk = (v, key) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (typeof v === 'string' && key === 'url' && /rmcdn/.test(v) && !/\/dist\//.test(v)) urls.add(v.split('?')[0]);
  };
  for (const p of pages) walk(p.widgets);
  return [...urls];
}
