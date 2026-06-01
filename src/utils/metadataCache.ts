export interface BookMetadata {
  bookHeb: string;
  bookAbbrevEs: string;
  safeFile: string;
  chapters: Record<string, string[]>;
}

export type AppMetadata = Record<string, BookMetadata>;

const loadedBooks = new Map<string, unknown[]>();
let metadataPromise: Promise<AppMetadata> | null = null;

const getBaseUrl = () => import.meta.env.BASE_URL ?? '/';

export const getMetadata = async (): Promise<AppMetadata> => {
  if (!metadataPromise) {
    metadataPromise = fetch(`${getBaseUrl()}metadata.json`).then((response) => {
      if (!response.ok) throw new Error(`No se pudo cargar metadata.json (${response.status})`);
      return response.json() as Promise<AppMetadata>;
    });
  }
  return metadataPromise;
};

export const resolveBookName = (bookToken: string, metadata: AppMetadata): string | null => {
  if (!bookToken) return null;
  if (metadata[bookToken]) return bookToken;
  return Object.keys(metadata).find((bookName) => metadata[bookName].bookAbbrevEs === bookToken) ?? null;
};

export const loadBookData = async <T>(
  bookToken: string,
  parseBook: (source: string) => T[]
): Promise<T[]> => {
  const metadata = await getMetadata();
  const bookName = resolveBookName(bookToken, metadata);
  if (!bookName) throw new Error(`Libro no encontrado: ${bookToken}`);

  const cached = loadedBooks.get(bookName);
  if (cached) return cached as T[];

  const safeFile = metadata[bookName]?.safeFile;
  if (!safeFile) throw new Error(`No hay TSV para el libro: ${bookToken}`);

  const response = await fetch(`${getBaseUrl()}books/${safeFile}.tsv`);
  if (!response.ok) throw new Error(`No se pudo cargar ${safeFile}.tsv (${response.status})`);

  const text = await response.text();
  const parsed = parseBook(text);
  loadedBooks.set(bookName, parsed as unknown[]);
  return parsed;
};