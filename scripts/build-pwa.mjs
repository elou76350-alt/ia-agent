import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicFiles = ['index.html', 'manifest.webmanifest', 'favicon.svg', 'icons/cap-192.png', 'icons/cap-512.png', 'icons/cap-maskable-512.png', 'icons/apple-touch-icon.png'];

export async function buildPwa({ distDirectory = resolve(root, 'dist'), templatePath = resolve(root, 'public/sw.js') } = {}) {
  const dist = await realpath(distDirectory);
  const paths = [...publicFiles];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('PWA static assets must not be symbolic links');
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(?:js|css|png|svg|webp|avif|jpg|jpeg|woff2?)$/.test(entry.name)) paths.push(relative(dist, path).split(sep).join('/'));
    }
  }
  await visit(resolve(dist, 'assets'));
  paths.sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    const resolved = await realpath(resolve(dist, path));
    if (!resolved.startsWith(dist + sep)) throw new Error('PWA static asset escapes the build directory');
    hash.update(path).update(await readFile(resolved));
  }
  const cacheName = `cap-static-${hash.digest('hex').slice(0, 16)}`;
  const template = await readFile(templatePath, 'utf8');
  if (!template.includes("/*__CAP_CACHE_NAME__*/ 'cap-static-unbuilt'") || !template.includes('/*__CAP_PRECACHE__*/ []')) throw new Error('PWA template markers are missing');
  const script = template.replace("/*__CAP_CACHE_NAME__*/ 'cap-static-unbuilt'", JSON.stringify(cacheName)).replace('/*__CAP_PRECACHE__*/ []', JSON.stringify(paths.map(path => '/' + path)));
  await writeFile(resolve(dist, 'sw.js'), script);
  return { cacheName, paths: paths.map(path => '/' + path) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = await buildPwa();
  console.log(`CAP PWA : ${built.paths.length} ressources publiques préparées.`);
}
