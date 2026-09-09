export interface BookMetadata {
  bookHeb: string;
  bookAbbrevEs: string;
  safeFile: string;
  voiceAliases?: string[];
  chapters: Record<string, string[]>;
}

export type AppMetadata = Record<string, BookMetadata>;

const loadedBooks = new Map<string, Promise<unknown[]>>();
let metadataPromise: Promise<AppMetadata> | null = null;

const getBaseUrl = () => import.meta.env.BASE_URL ?? '/';

export const getMetadata = async (): Promise<AppMetadata> => {
  if (!metadataPromise) {
    metadataPromise = fetch(`${getBaseUrl()}metadata.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`No se pudo cargar metadata.json (${response.status})`);
        return response.json() as Promise<AppMetadata>;
      })
      .catch((err) => {
        metadataPromise = null;
        throw err;
      });
  }
  return metadataPromise;
};

export const resolveBookName = (bookToken: string, metadata: AppMetadata): string | null => {
  if (!bookToken) return null;
  if (metadata[bookToken]) return bookToken;

  const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, '');
  const normalizedToken = normalize(bookToken);

  const matchedKey = Object.keys(metadata).find(
    (bookName) => normalize(bookName) === normalizedToken
  );
  if (matchedKey) return matchedKey;

  return Object.keys(metadata).find(
    (bookName) => normalize(metadata[bookName].bookAbbrevEs) === normalizedToken
  ) ?? null;
};

export const loadBookData = async <T>(
  bookToken: string,
  parseBook: (source: string) => T[]
): Promise<T[]> => {
  const metadata = await getMetadata();
  const bookName = resolveBookName(bookToken, metadata);
  if (!bookName) throw new Error(`Libro no encontrado: ${bookToken}`);

  if (loadedBooks.has(bookName)) {
    return loadedBooks.get(bookName) as Promise<T[]>;
  }

  const promise = (async () => {
    const safeFile = metadata[bookName]?.safeFile;
    if (!safeFile) throw new Error(`No hay TSV para el libro: ${bookToken}`);

    const response = await fetch(`${getBaseUrl()}books/${safeFile}.tsv`);
    if (!response.ok) throw new Error(`No se pudo cargar ${safeFile}.tsv (${response.status})`);

    const text = await response.text();
    return parseBook(text);
  })();

  loadedBooks.set(bookName, promise as Promise<unknown[]>);

  try {
    return await promise;
  } catch (err) {
    loadedBooks.delete(bookName);
    throw err;
  }
};