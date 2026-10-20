import { useTranslation } from 'react-i18next';
import { uiI18n } from './runtime';

export const useUiTranslation = (namespace: string) => useTranslation(namespace, { i18n: uiI18n, useSuspense: false });
