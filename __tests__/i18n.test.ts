import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadI18nConfig, normalizeI18nConfig } from '../server/i18n-config.mjs';
import { isPublicApiRequest } from '../server/authUtils.mjs';
import { validateCatalogs, readCatalogs, inspectSource } from '../scripts/i18n-check.mjs';
import { fingerprint, planTranslations, applyTranslations } from '../scripts/i18n-translate.mjs';
import { i18nOptions, loadCatalog, makeI18n, resolveLocale, storageKey } from '../src/i18n/runtime';
import type { Locale, UiRole } from '../src/i18n/runtime';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('UI language configuration and catalogs', () => {
  it('falls back safely without configuration, without exposing other fields', () => {
    expect(normalizeI18nConfig(null).i18n.defaultLocale).toBe('es');
    for (const config of [null, {}, {i18n:{defaultLocale:'zz',supportedLocales:['es']}}, {i18n:{defaultLocale:'he',supportedLocales:['he']}}]) {
      expect(resolveLocale(null, config)).toBe('es');
    }
    const config={i18n:{defaultLocale:'fr',supportedLocales:['es','fr','he']},secret:'private'};
    expect(normalizeI18nConfig(config)).toEqual({i18n:config.i18n});
    expect(resolveLocale(null,config)).toBe('fr');
    expect(resolveLocale('he',config)).toBe('he');
    expect(resolveLocale('en',config)).toBe('fr');
    expect(isPublicApiRequest('/api/public-config','GET')).toBe(true);
    expect(isPublicApiRequest('/api/public-config','POST')).toBe(false);
  });

  it('reads an optional JSON file and tolerates absent or malformed configuration', () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sefer-i18n-')); directories.push(directory);
    const file=path.join(directory,'config.json');
    expect(loadI18nConfig(file).i18n.defaultLocale).toBe('es');
    fs.writeFileSync(file,'{'); expect(loadI18nConfig(file).i18n.defaultLocale).toBe('es');
    fs.writeFileSync(file,JSON.stringify({i18n:{defaultLocale:'he',supportedLocales:['es','he']},password:'secret'}));
    expect(loadI18nConfig(file)).toEqual({i18n:{defaultLocale:'he',supportedLocales:['es','he']}});
  });

  it.each(['es','en','fr','he'] as Locale[])('loads %s catalogs and locale-specific plurals', async locale => {
    const instance=makeI18n(); await instance.init({...i18nOptions,lng:locale});
    expect(instance.t('language')).toBe((await loadCatalog(locale,'common')).language);
    expect(instance.t('items',{count:2})).toContain('2');
    expect(instance.t('items',{count:1})).not.toContain('{{');
    expect(instance.dir()).toBe(locale==='he'?'rtl':'ltr');
    expect(instance.hasResourceBundle(locale,'liveAudio')).toBe(false);
    await instance.loadNamespaces('control'); expect(instance.hasResourceBundle(locale,'control')).toBe(true);
  });

  it('uses Spanish for a missing translation, and a supplied message for an unknown key', async () => {
    const instance=makeI18n(); await instance.init({...i18nOptions,lng:'fr'});
    instance.addResource('es','common','fallbackTest','Hola {{name}}');
    expect(instance.t('fallbackTest',{name:'Ana'})).toBe('Hola Ana');
    expect(instance.t('unknown',{defaultValue:'Mensaje disponible'})).toBe('Mensaje disponible');
  });

  it('keeps role preferences and language instances independent', async () => {
    const roles: UiRole[]=['control','presenter','audience'];
    const preferences=['en','fr','he'];
    const saved=new Map(roles.map((role,index)=>[storageKey(role),preferences[index]]));
    const instances=await Promise.all(roles.map(async role=>{
      const instance=makeI18n();await instance.init({...i18nOptions,lng:resolveLocale(saved.get(storageKey(role)),null)});return instance;
    }));
    await instances[0].changeLanguage('es');
    expect(instances.map(instance=>instance.language)).toEqual(['es','fr','he']);
    expect(saved.get(storageKey('audience'))).toBe('he');
  });
});

describe('i18n validation and incremental translation', () => {
  it('validates every shipped catalog, interpolation and required plural categories', () => {
    const catalogs=readCatalogs();expect(validateCatalogs(catalogs).errors).toEqual([]);
    const broken=structuredClone(catalogs);broken.fr.common.items_one='{{unexpected}}';
    expect(validateCatalogs(broken).errors.some(error=>error.includes('incompatible interpolation'))).toBe(true);
    delete broken.he.common.items_two;
    expect(validateCatalogs(broken).errors.some(error=>error.includes('missing plural category two'))).toBe(true);
    broken.fr.common.language='<script>alert(1)</script>';
    expect(validateCatalogs(broken).errors.some(error=>error.includes('HTML'))).toBe(true);
  });

  it('detects JSX text, accessibility labels and dialogs without flagging CSS or translation fallback literals', () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sefer-i18n-'));directories.push(directory);
    const file=path.join(directory,'example.tsx');
    fs.writeFileSync(file,`const View = () => <button className="fixed left-2" aria-label="Open menu" onClick={() => alert('Confirm?')}>New label {translate('common:known', 'Texto')}</button>`);
    const result=inspectSource([file]);
    expect(result.literals.map(item=>item.text)).toEqual(expect.arrayContaining(['Open menu','New label','Confirm?']));
    expect(result.literals.some(item=>item.text.includes('fixed'))).toBe(false);
    expect(result.references).toEqual(['common:known']);
  });

  const input=()=>({catalogs:{en:{common:{message:'Hello {{name}}'}},es:{common:{message:'Hola {{name}}'}},fr:{common:{}},he:{common:{}}},manifest:{'common:message':{context:'Greeting',status:{en:'reviewed',es:'reviewed'},cache:{}}}});
  it('detects source, context and settings changes, respects budgets and protects reviewed translations', () => {
    const value=input();
    const plan=planTranslations({...value,maxCharacters:100,maxMessages:1});
    expect(plan.pending).toHaveLength(1);expect(plan.protectedEntries).toHaveLength(1);
    const message=plan.pending[0];
    expect(fingerprint({...message,context:'Other'})).not.toBe(message.fingerprint);
    expect(fingerprint({...message,settings:{revision:'2'}})).not.toBe(message.fingerprint);
    expect(planTranslations({...value,maxCharacters:0}).pending).toHaveLength(0);
    value.manifest['common:message'].status.en='machine';
    expect(planTranslations(value).pending).toHaveLength(0);
  });
  it('batches only changed messages, caches them and rejects unsafe provider output before writing', async () => {
    const value=input(), plan=planTranslations(value);
    const output=await applyTranslations({...value,pending:plan.pending,batchSize:1,provider:{translateBatch:async batch=>batch.map(()=> 'Bonjour {{name}}')}});
    expect(output.manifest['common:message'].status.fr).toBe('machine');
    expect(planTranslations(output).pending).toHaveLength(0);
    output.catalogs.en.common.message='Welcome {{name}}';
    expect(planTranslations(output).pending).toHaveLength(2);
    output.manifest['common:message'].status.fr='reviewed';
    expect(planTranslations(output).pending).toHaveLength(1);
    expect(value.catalogs.fr.common).toEqual({});
    await expect(applyTranslations({...value,pending:plan.pending,provider:{translateBatch:async batch=>batch.map(()=> 'Bonjour {{other}}')}})).rejects.toThrow('incompatible interpolation');
  });
});
