import { lstat, mkdir, realpath, rename, rm, stat, readdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const topLevelFiles = [
  'README.md', '.env.example', '.gitignore', '.dockerignore', 'Dockerfile',
  'compose.yaml', 'Caddyfile', 'render.yaml', 'package.json', 'package-lock.json', 'index.html',
  'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'playwright.protected.config.ts',
];
const sourceDirectories = ['src', 'server', 'public', 'scripts', 'tests', 'docs'];
const sourceExtensions = new Set(['.ts', '.tsx', '.mjs', '.js', '.css', '.svg', '.png', '.ico', '.webmanifest', '.md', '.txt', '.html', '.json']);
const excludedDirectories = new Set(['node_modules', 'data', 'dist', '.git', '.cache', 'attachments', 'test-results', 'playwright-report']);

function isWithinProject(path) {
  const rel = relative(projectRoot, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function collectDirectory(directory, files) {
  for (const entry of await readdir(resolve(projectRoot, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excludedDirectories.has(entry.name)) continue;
    const name = `${directory}/${entry.name}`;
    const fullPath = resolve(projectRoot, name);
    const metadata = await lstat(fullPath);
    if (metadata.isSymbolicLink()) throw new Error(`Lien symbolique refusé dans les sources : ${name}`);
    if (!isWithinProject(await realpath(fullPath))) throw new Error(`Chemin de source hors du projet : ${name}`);
    if (metadata.isDirectory()) await collectDirectory(name, files);
    else if (metadata.isFile() && sourceExtensions.has(extname(entry.name))) files.push(name);
  }
}

export async function packageRelease(outputPath = resolve(projectRoot, '..', 'outputs', 'CAP-application.tar.gz')) {
  const target = resolve(outputPath);
  if (!target.endsWith('.tar.gz')) throw new Error('Le fichier de sortie doit se terminer par .tar.gz.');
  if (isWithinProject(target)) throw new Error('Conserver l’archive de livraison en dehors du dépôt.');
  const files = [];
  for (const name of topLevelFiles) {
    const path = resolve(projectRoot, name);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Source attendue illisible : ${name}`);
    files.push(name);
  }
  for (const name of sourceDirectories) await collectDirectory(name, files);
  files.sort();
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    const result = spawnSync('tar', [
      '--create', '--gzip', '--file', temporary, '--directory', projectRoot,
      '--no-recursion', '--null', '--files-from', '-', '--transform', 's,^,CAP/,',
    ], { input: `${files.join('\0')}\0`, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (result.error) throw new Error(`Impossible de lancer tar : ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Échec de l’archivage : ${result.stderr.trim()}`);
    await rename(temporary, target);
    return { path: target, files: files.length, bytes: (await stat(target)).size };
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await packageRelease(process.argv[2]);
    console.log(`Livraison créée : ${result.path} (${result.files} fichiers de sources, ${result.bytes} octets).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
