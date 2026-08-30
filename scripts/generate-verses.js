import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'path';
import { loadEnvFile } from 'node:process';
import Papa from 'papaparse';
import { resolveSeferDataDir } from '../server/data-directory.mjs';



export const toSafeBookFileName = (bookName) =>
  bookName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

export const generateVerses = () => {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) loadEnvFile(envPath);

  const configuredSource = process.env.SEFER_VERSES_SOURCE?.trim();
  if (!configuredSource) {
    console.warn('SEFER_VERSES_SOURCE no está configurado; no se ha generado ningún archivo.');
    return;
  }

  const tsvPath = isAbsolute(configuredSource)
    ? resolve(configuredSource)
    : resolve(process.cwd(), configuredSource);
  if (!existsSync(tsvPath)) {
    console.warn(`SEFER_VERSES_SOURCE no existe: ${tsvPath}`);
    return;
  }

  const dataDir = resolveSeferDataDir({ rootDir: process.cwd() });
  const outputDir = join(dataDir, 'public');
  const booksDir = join(outputDir, 'books');
  const hashPath = join(dataDir, 'config', 'verses-source.sha256');
  const aliasesPath = join(dataDir, 'config', 'voice_aliases.json');
  
  let extraAliases = {};
  if (existsSync(aliasesPath)) {
    try {
      // ponytail: parseo simple sin schema, asume que el usuario escribió bien un Record<string, string[]>
      extraAliases = JSON.parse(readFileSync(aliasesPath, 'utf8'));
    } catch (e) {
      console.warn(`Error leyendo voice_aliases.json:`, e.message);
    }
  }

  const source = readFileSync(tsvPath);
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (
    existsSync(hashPath)
    && readFileSync(hashPath, 'utf8').trim() === sourceHash
    && existsSync(join(outputDir, 'metadata.json'))
    && existsSync(booksDir)
  ) {
    console.log('Sin cambios en SEFER_VERSES_SOURCE; se conserva el corpus existente.');
    return;
  }

  console.log(`Cargando datos bíblicos de: ${tsvPath}`);
  const tsv = source.toString('utf8');

  const parsed = Papa.parse(tsv, {
    header: true,
    delimiter: '\t',
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    const errorMessage = parsed.errors.map((e) => `${e.type}:${e.code} at row ${e.row}`).join('; ');
    throw new Error(`Error parseando TSV: ${errorMessage}`);
  }

  const rows = parsed.data;
  const headers = parsed.meta.fields ?? [];
  const requiredHeaders = ['bookEs', 'bookAbbrevEs', 'bookHeb', 'chapter', 'verse'];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Faltan cabeceras requeridas en TSV: ${missingHeaders.join(', ')}`);
  }

  const books = new Map();
  const metadata = {};
  const seenVerseKeys = new Set();

  rows.forEach((row) => {
    const bookEs = String(row.bookEs ?? '').trim();
    const bookHeb = String(row.bookHeb ?? '').trim();
    const bookAbbrevEs = String(row.bookAbbrevEs ?? '').trim();
    const chapter = String(row.chapter ?? '').trim();
    const verse = String(row.verse ?? '').trim();

    if (!bookEs || !chapter || !verse) return;

    const uniqueVerseKey = `${bookEs}|${chapter}|${verse}`;
    if (seenVerseKeys.has(uniqueVerseKey)) {
      throw new Error(`Versículo duplicado detectado: ${uniqueVerseKey}`);
    }
    seenVerseKeys.add(uniqueVerseKey);

    const safeName = toSafeBookFileName(bookEs);
    if (!books.has(bookEs)) books.set(bookEs, []);
    books.get(bookEs).push(row);

    if (!metadata[bookEs]) {
      const voiceAliases = extraAliases[bookEs] || [];
      metadata[bookEs] = { bookHeb, bookAbbrevEs, safeFile: safeName, voiceAliases, chapters: {} };
    }

    if (!metadata[bookEs].chapters[chapter]) {
      metadata[bookEs].chapters[chapter] = [];
    }
    metadata[bookEs].chapters[chapter].push(verse);
  });

  if (!existsSync(booksDir)) {
    mkdirSync(booksDir, { recursive: true });
  }

  for (const [bookName, bookLines] of books.entries()) {
    const safeName = metadata[bookName].safeFile;
    const bookTsv = Papa.unparse(bookLines, {
      delimiter: '\t',
      header: true,
      columns: headers,
      newline: '\n',
    });
    writeFileSync(join(booksDir, `${safeName}.tsv`), bookTsv);
  }

  writeFileSync(join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  mkdirSync(join(dataDir, 'config'), { recursive: true });
  writeFileSync(hashPath, `${sourceHash}\n`);

  console.log(`✅ Generados ${books.size} archivos TSV por libro y metadata.json en ${outputDir}.`);
};

if (process.argv[1] && process.argv[1].endsWith('generate-verses.js')) {
  generateVerses();
}
