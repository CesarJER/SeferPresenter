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

export const readVoiceAliases = (aliasesPath) => {
  if (!existsSync(aliasesPath)) return {};

  const parsed = JSON.parse(readFileSync(aliasesPath, 'utf8'));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('voice_aliases.json debe ser un objeto de libro a lista de aliases');
  }

  return Object.fromEntries(Object.entries(parsed).map(([book, aliases]) => {
    if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== 'string' || !alias.trim())) {
      throw new Error(`Aliases de voz inválidos para ${book}`);
    }
    return [book, [...new Set(aliases.map((alias) => alias.trim()))]];
  }));
};

export const createGenerationHash = (source, aliasesSource = Buffer.alloc(0)) => createHash('sha256')
  .update('sefer-scripture-inputs-v2\0')
  .update(source)
  .update('\0voice-aliases\0')
  .update(aliasesSource)
  .digest('hex');

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
  
  const source = readFileSync(tsvPath);
  const aliasesSource = existsSync(aliasesPath) ? readFileSync(aliasesPath) : Buffer.alloc(0);
  const extraAliases = readVoiceAliases(aliasesPath);
  const sourceHash = createGenerationHash(source, aliasesSource);
  if (
    existsSync(hashPath)
    && readFileSync(hashPath, 'utf8').trim() === sourceHash
    && existsSync(join(outputDir, 'metadata.json'))
    && existsSync(booksDir)
  ) {
    console.log('Sin cambios en el corpus ni en sus aliases privados; se conserva la generación existente.');
    return;
  }

  console.log(`Cargando corpus de textos desde: ${tsvPath}`);
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
