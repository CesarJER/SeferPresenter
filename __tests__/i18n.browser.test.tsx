// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiLocaleProvider } from '../src/i18n/UiLocaleProvider';
import { i18nOptions, loadCatalog, readPreference, savePreference, storageKey, translate, uiI18n } from '../src/i18n/runtime';
import { useUiTranslation } from '../src/i18n/useUiTranslation';
import AutoResizeText from '../src/components/shared/AutoResizeText';
import * as runtime from '../src/i18n/runtime';
import { PrivateControlInbox } from '../src/features/liveAudio/components/control/PrivateControlInbox';

beforeEach(()=>{
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(async()=>{
  cleanup();vi.unstubAllGlobals();localStorage.clear();
  vi.restoreAllMocks();
  document.documentElement.dir='ltr';document.documentElement.lang='es';
  if(uiI18n.isInitialized)await uiI18n.changeLanguage('es');
});
const Sample=()=>{useUiTranslation('common');return <>
  <span>{translate('common:language','Idioma de la interfaz')}</span>
  <AutoResizeText text="Escucha Israel" dir="ltr" />
  <AutoResizeText text="שְׁמַע יִשְׂרָאֵל" dir="rtl" lang="he" />
</>;};

it('labels the composer in Hebrew and preserves automatic direction for private text and aliases', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ i18n: { defaultLocale: 'he', supportedLocales: ['es','en','fr','he'] } }) }));
  render(<UiLocaleProvider role="control"><PrivateControlInbox
    isOpen={true}
    isControlAuthorized={true}
    conversationRecipients={[{ participantId: 'audience', alias: 'משתתף', eligible: true }]}
    messages={[{ id: 'message', fromAlias: 'משתתף', content: 'שלום', timestamp: 1, isControlToAudience: true, toAlias: 'משתתף' }]}
    authorizationRequests={[]}
    onApproveRequest={vi.fn()}
    onRejectRequest={vi.fn()}
    onDismissMessage={vi.fn()}
    onSendConversation={vi.fn().mockResolvedValue({ audienceQueued: false, controlsQueued: false })} /></UiLocaleProvider>);
  await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
  const recipient = await screen.findByRole('combobox', { name: 'נמען' });
  fireEvent.change(recipient, { target: { value: 'audience' } });
  expect(screen.getByText('שלום').getAttribute('dir')).toBe('auto');
  expect(screen.getByRole('textbox', { name: 'הודעה' }).getAttribute('dir')).toBe('auto');
  expect(screen.getByRole('button', { name: 'שליחה' })).toBeTruthy();
});

it('loads the server default, preserves biblical direction and changes only this role’s preference',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({i18n:{defaultLocale:'he',supportedLocales:['es','en','fr','he']}})}));
  render(<UiLocaleProvider role="control"><Sample /></UiLocaleProvider>);
  await waitFor(()=>expect(document.documentElement.dir).toBe('rtl'));
  expect(document.documentElement.lang).toBe('he');
  expect(screen.getByText('Escucha Israel').getAttribute('dir')).toBe('ltr');
  expect(screen.getByText('שְׁמַע יִשְׂרָאֵל').getAttribute('dir')).toBe('rtl');
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'fr'}});
  await waitFor(()=>expect(document.documentElement.lang).toBe('fr'));
  expect(localStorage.getItem(storageKey('control'))).toBe('fr');
  expect(localStorage.getItem(storageKey('audience'))).toBeNull();
  expect(screen.getByText('שְׁמַע יִשְׂרָאֵל').textContent).toBe('שְׁמַע יִשְׂרָאֵל');
});

it('honors a persisted choice without using browser locale',async()=>{
  localStorage.setItem(storageKey('audience'),'en');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({i18n:{defaultLocale:'fr',supportedLocales:['es','en','fr','he']}})}));
  render(<UiLocaleProvider role="audience"><Sample /></UiLocaleProvider>);
  await waitFor(()=>expect(screen.getByRole('combobox')).toHaveProperty('value','en'));
});

it('keeps Spanish available when the public configuration is offline',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')));
  render(<UiLocaleProvider role="catalog"><Sample /></UiLocaleProvider>);
  await waitFor(()=>expect(screen.getByRole('combobox')).toHaveProperty('value','es'));
  expect(screen.getByText('Idioma de la interfaz',{selector:'span:not(.sr-only)'})).toBeTruthy();
});

it('uses safe storage fallbacks, interpolates safely as React text and loads fallback resources',async()=>{
  const storage={getItem:()=>{throw Error('disabled');},setItem:()=>{throw Error('disabled');}} as unknown as Storage;
  expect(readPreference(storage,'control')).toBeNull();
  expect(()=>savePreference(storage,'control','en')).not.toThrow();
  await uiI18n.init({...i18nOptions,lng:'en'});
  uiI18n.addResource('en','common','safe','Hello {{name}}');
  const {container}=render(<p>{translate('common:safe','Hola {{name}}',{name:'<img src=x onerror=alert(1)>'})}</p>);
  expect(container.querySelector('img')).toBeNull();
  expect(await loadCatalog('es','common')).toHaveProperty('language');
});

it('keeps the current locale when a requested language resource is unavailable offline',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('offline')));
  render(<UiLocaleProvider role="control"><Sample /></UiLocaleProvider>);
  await waitFor(()=>expect(screen.getByRole('combobox')).toHaveProperty('value','es'));
  vi.spyOn(runtime,'loadCatalog').mockRejectedValue(new TypeError('uncached locale'));
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'fr'}});
  await screen.findByText('No se pudo cargar el idioma. Se conserva el actual.');
  expect(screen.getByRole('combobox')).toHaveProperty('value','es');
  expect(localStorage.getItem(storageKey('control'))).toBeNull();
});
