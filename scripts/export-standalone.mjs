import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = resolve(projectDirectory, '..', 'outputs', 'CAP.html');
const mimeTypes = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function attribute(attributes, name) {
  const match = attributes.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

function removeAttribute(attributes, name) {
  return attributes.replace(new RegExp('\\s+' + name + '(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))?', 'gi'), '');
}

function isInside(directory, filename) {
  const local = relative(directory, filename);
  return local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local);
}

/** Only read public assets belonging to dist; symlinks may not escape it. */
export async function resolveAsset(distDirectory, reference) {
  if (typeof reference !== 'string' || !reference || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
    throw new Error('Ressource externe ou invalide : ' + reference);
  }
  let decoded;
  try { decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0]); }
  catch { throw new Error('Chemin de ressource mal encodé.'); }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
    throw new Error('Le chemin de ressource sort du dossier compilé.');
  }
  const root = await realpath(distDirectory);
  const candidate = resolve(root, decoded.replace(/^\/+/, ''));
  if (!isInside(root, candidate)) throw new Error('Le chemin de ressource sort du dossier compilé.');
  let actual;
  try { actual = await realpath(candidate); }
  catch { throw new Error('Ressource compilée introuvable : ' + reference); }
  if (!isInside(root, actual) || !(await stat(actual)).isFile()) {
    throw new Error('La ressource doit être un fichier du dossier compilé.');
  }
  return actual;
}

async function readAsset(distDirectory, reference) {
  const filename = await resolveAsset(distDirectory, reference);
  return { filename, bytes: await readFile(filename) };
}

async function asDataUri(distDirectory, reference) {
  const { filename, bytes } = await readAsset(distDirectory, reference);
  const type = mimeTypes[extname(filename).toLowerCase()];
  if (!type) throw new Error('Type de ressource non pris en charge : ' + extname(filename));
  return 'data:' + type + ';base64,' + bytes.toString('base64');
}

function escapeScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

function escapeStyle(source) {
  return source.replace(/<\/style/gi, '\\3c /style');
}

async function inlineStylesheet(distDirectory, reference) {
  const { filename, bytes } = await readAsset(distDirectory, reference);
  let css = bytes.toString('utf8');
  if (/@import\b/i.test(css)) {
    throw new Error('La feuille de style contient un @import non compilé. Relancez la compilation sans dépendance CSS externe.');
  }
  const matches = Array.from(css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi));
  for (const match of matches.reverse()) {
    const asset = (match[1] ?? match[2] ?? match[3]).trim();
    if (asset.startsWith('data:') || asset.startsWith('#')) continue;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(asset)) throw new Error('La feuille de style contient une ressource externe.');
    const assetReference = asset.startsWith('/') ? asset : '/' + relative(distDirectory, resolve(dirname(filename), asset)).split(sep).join('/');
    const data = await asDataUri(distDirectory, assetReference);
    css = css.slice(0, match.index) + 'url("' + data + '")' + css.slice(match.index + match[0].length);
  }
  return escapeStyle(css);
}

/** Build a self-contained document using only public compiled client assets. */
export async function createStandaloneHtml(distDirectory = resolve(projectDirectory, 'dist')) {
  let root;
  try { root = await realpath(distDirectory); }
  catch { throw new Error('Le dossier dist est absent. Exécutez npm run build avant l’export.'); }
  const indexFile = await resolveAsset(root, 'index.html');
  let html = await readFile(indexFile, 'utf8');
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('Le document compilé ne contient pas de balise head.');
  const tokens = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<link\b([^>]*?)\/?\s*>|<img\b([^>]*?)\/?\s*>/gi));
  let scriptCount = 0;
  let stylesheetCount = 0;
  for (const token of tokens.reverse()) {
    let replacement = token[0];
    if (token[1] !== undefined) {
      const source = attribute(token[1], 'src');
      const script = source ? (await readAsset(root, source)).bytes.toString('utf8') : token[2];
      // Fail instead of producing an export that needs unavailable sibling chunks.
      if (/\bimport\s*(?:\(|["'{*])|\bexport\s*(?:\{|default\b|\*)/.test(script)) {
        throw new Error('Un script contient des imports non regroupés. Compilez les modules dans un seul bundle avant l’export.');
      }
      const attributes = removeAttribute(removeAttribute(token[1], 'src'), 'crossorigin');
      replacement = '<script' + attributes + '>' + escapeScript(script) + '</script>';
      scriptCount += 1;
    } else if (token[3] !== undefined) {
      const rel = (attribute(token[3], 'rel') || '').toLowerCase();
      const href = attribute(token[3], 'href');
      if (rel === 'stylesheet') {
        if (!href) throw new Error('Une feuille de style compilée ne contient pas de chemin.');
        const css = await inlineStylesheet(root, href);
        const attributes = removeAttribute(removeAttribute(removeAttribute(token[3], 'href'), 'rel'), 'crossorigin');
        replacement = '<style' + attributes + '>' + css + '</style>';
        stylesheetCount += 1;
      } else if (rel.split(/\s+/).includes('icon') || rel === 'apple-touch-icon') {
        if (!href) throw new Error('Le favicon compilé ne contient pas de chemin.');
        const data = await asDataUri(root, href);
        replacement = '<link' + removeAttribute(token[3], 'href') + ' href="' + data + '">';
      } else if (['manifest', 'modulepreload', 'preload', 'prefetch', 'preconnect', 'dns-prefetch'].includes(rel)) {
        replacement = '';
      } else if (href && /^(?:https?:)?\/\//i.test(href)) {
        throw new Error('Le document contient une ressource externe non intégrée.');
      }
    } else if (token[4] !== undefined) {
      const src = attribute(token[4], 'src');
      if (attribute(token[4], 'srcset')) throw new Error('Une image contient un srcset non compilé.');
      if (src && !src.startsWith('data:')) {
        replacement = '<img' + removeAttribute(token[4], 'src') + ' src="' + await asDataUri(root, src) + '">';
      }
    }
    html = html.slice(0, token.index) + replacement + html.slice(token.index + token[0].length);
  }
  if (scriptCount === 0 || stylesheetCount === 0) throw new Error('Le document compilé doit contenir son JavaScript et sa feuille de style.');
  // Runs immediately, before the deferred inlined module entry.
  return html.replace(/<head(?:\s[^>]*)?>/i, '$&\n    <script>window.__CAP_STANDALONE__=true;</script>');
}

export async function exportStandalone({ distDirectory = resolve(projectDirectory, 'dist'), outputFile = defaultOutput } = {}) {
  const html = await createStandaloneHtml(distDirectory);
  await mkdir(dirname(outputFile), { recursive: true });
  const temporary = outputFile + '.tmp';
  await writeFile(temporary, html, 'utf8');
  await rename(temporary, outputFile);
  return { outputFile, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await exportStandalone();
    console.log('CAP autonome exporté : ' + result.outputFile + ' (' + result.bytes + ' octets).');
  } catch (error) {
    console.error('Export autonome impossible : ' + error.message);
    process.exitCode = 1;
  }
}
