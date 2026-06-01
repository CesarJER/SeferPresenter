import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import Papa from 'papaparse';

export const toSafeBookFileName = (bookName) =>
  bookName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

export const generateVerses = () => {
  const pathsToTry = [
    join(process.cwd(), '..', 'Sefer-Data', 'data', 'raw', 'protected', 'generated', 'versiculos.tsv'),
    join(process.cwd(), '..', 'Sefer-Data', 'versiculos.tsv'),
    join(process.cwd(), 'public', 'versiculos.tsv')
  ];

  let tsvPath = null;
  for (const p of pathsToTry) {
    if (existsSync(p)) {
      tsvPath = p;
      break;
    }
  }

  if (!tsvPath) {
    throw new Error(`No se encontró el archivo de versículos de origen 'versiculos.tsv' en ninguna de las rutas:\n${pathsToTry.map(p => `  - ${p}`).join('\n')}`);
  }

  console.log(`Cargando datos bíblicos de: ${tsvPath}`);
  const tsv = readFileSync(tsvPath, 'utf8');

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
      metadata[bookEs] = { bookHeb, bookAbbrevEs, safeFile: safeName, chapters: {} };
    }

    if (!metadata[bookEs].chapters[chapter]) {
      metadata[bookEs].chapters[chapter] = [];
    }
    metadata[bookEs].chapters[chapter].push(verse);
  });

  const booksDir = join(process.cwd(), 'public', 'books');
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

  writeFileSync(join(process.cwd(), 'public', 'metadata.json'), JSON.stringify(metadata, null, 2));

  console.log(`✅ Generados ${books.size} archivos TSV por libro y metadata.json en public/ para SeferPresenter.`);
};

if (process.argv[1] && process.argv[1].endsWith('generate-verses.js')) {
  generateVerses();
}
