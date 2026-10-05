// Private to this page: never persist or broadcast the connection credential.
let credential: string | null = null;
export const setOperatorCredential = (value: unknown) => { credential = typeof value === 'string' ? value : null; };
export const getOperatorHeaders = (): Record<string, string> => credential ? { 'X-Sefer-Operator-Credential': credential } : {};
