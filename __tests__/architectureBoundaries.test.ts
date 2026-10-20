import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { beforeAll, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, 'eslint.config.js') });
const ruleId = 'architecture/import-boundaries';
async function lint(file: string, code: string) {
  const results = await eslint.lintText(code, { filePath: path.join(root, file) });
  const messages = results.flatMap(result => result.messages);
  expect(messages.filter(message => message.fatal || !message.ruleId)).toEqual([]);
  return messages.filter(message => message.ruleId === ruleId);
}

it.each([
  'import React from "react";',
  'import type { ReactNode } from "react";',
  'import * as UI from "../components/shared/AutoResizeText";',
  'export { useSeferReader } from "../hooks/useSeferReader";',
  'export * from "../hooks/useSeferReader";',
  'export type * from "../hooks/useSeferReader";',
  'import "dompurify";',
  'import("./scripture");',
  'const name = "../hooks/useSeferReader"; import(name);',
  'type State = import("../hooks/useSeferReader").SeferReaderState;',
  'import type { State } from "./../hooks/useSeferReader";',
  'import type { Headers } from "node:http";',
])('rejects a portable-contract dependency: %s', async code => {
  expect(await lint('src/types/architecture-fixture.ts', code)).toContainEqual(expect.objectContaining({ messageId: 'portable' }));
});

it.each([
  ['src/types/architecture-fixture.ts', 'import type { SeferReaderState } from "./scripture";'],
  ['src/types/architecture-fixture.ts', 'export type { SeferReaderState } from "./scripture";'],
  ['src/types/nested/architecture-fixture.ts', 'type State = import("../scripture").SeferReaderState;'],
  ['src/components/control/SeferControlPanel.tsx', 'import type { SeferControlController } from "../../hooks/useSeferControlLogic";'],
  ['src/components/control/SeferControlPanelMini.tsx', 'import { type SeferControlController } from "../../hooks/useSeferControlLogic";'],
  ['src/components/control/SeferControlPanelMini.tsx', 'type Controller = import("../../hooks/useSeferControlLogic").SeferControlController;'],
  ['src/components/control/SeferControlPanel.tsx', 'import { useState } from "react"; import { useUiTranslation } from "../../i18n/useUiTranslation";'],
  ['src/components/audience/AudienceScreen.tsx', 'import PresenterScreen from "../presenter/PresenterScreen";'],
  ['src/utils/architecture-fixture.ts', 'import DOMPurify from "dompurify";'],
])('allows the legitimate boundary in %s: %s', async (file, code) => {
  expect(await lint(file, code)).toEqual([]);
});

it.each(['SeferControlPanel.tsx', 'SeferControlPanelMini.tsx'])('protects shared ownership in %s', async widget => {
  for (const code of [
    'import { useSeferControlLogic } from "../../hooks/useSeferControlLogic";',
    'import * as controller from "../../hooks/useSeferControlLogic.ts";',
    'export { useSeferControlLogic } from "../../hooks/useSeferControlLogic";',
    'const controller = import("../../hooks/./useSeferControlLogic");',
    'import { useSeferReader } from "../../hooks/useSeferReader";',
  ]) expect(await lint(`src/components/control/${widget}`, code)).toContainEqual(expect.objectContaining({ messageId: 'controller' }));
});

const importForms = [
  'import { Room } from "SDK";',
  'import type { Room } from "SDK";',
  'import * as sdk from "SDK";',
  'export { Room } from "SDK";',
  'export * from "SDK";',
  'export type { Room } from "SDK";',
  'const sdk = import("SDK");',
  'const sdk = import(`SDK`);',
  'type Room = import("SDK").Room;',
  'import sdk = require("SDK");',
  'const sdk = require("SDK");',
];
it.each([
  ['livekit-client', 'src/features/liveAudio/hooks/useLiveAudio.ts'],
  ['livekit-server-sdk', 'server/livekit-server.mjs'],
])('confines every supported import form of %s to %s', async (sdk, owner) => {
  for (const form of importForms) {
    const code = form.replaceAll('SDK', sdk);
    expect(await lint('src/hooks/architecture-fixture.ts', code)).toContainEqual(expect.objectContaining({ messageId: 'sdkOwner' }));
    expect(await lint(owner, code)).toEqual([]);
  }
  expect(await lint('server/architecture-fixture.mjs', `export * from "${sdk}/internal";`)).toContainEqual(expect.objectContaining({ messageId: 'sdkOwner' }));
});
it('does not let an approved adapter import the opposite SDK', async () => {
  expect(await lint('src/features/liveAudio/hooks/useLiveAudio.ts', 'import * as sdk from "livekit-server-sdk";')).toContainEqual(expect.objectContaining({ messageId: 'sdkOwner' }));
  expect(await lint('server/livekit-server.mjs', 'import * as sdk from "livekit-client";')).toContainEqual(expect.objectContaining({ messageId: 'sdkOwner' }));
});

const contractFiles = fs.readdirSync(path.join(root, 'src/types'), { recursive: true, withFileTypes: true })
  .filter(file => file.isFile() && /\.[cm]?[jt]sx?$/.test(file.name)).map(file => path.join(file.parentPath, file.name));
const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2023.d.ts'], types: [], noEmit: true, skipLibCheck: false, allowJs: true, checkJs: true,
};
// Existing local browser types, not wire fields. Every exception is consumed once.
const browserExceptions = [
  'src/types/liveAudio.ts:LiveAudioMicrophoneDiagnostics.permissionState:PermissionState',
  'src/types/liveAudio.ts:LiveAudioRemoteTrack.track:MediaStreamTrack',
  'src/types/liveAudio.ts:LiveAudioRemoteTrack.attach:HTMLMediaElement',
  'src/types/liveAudio.ts:LiveAudioRemoteTrack.detach:HTMLMediaElement',
];
let baseline: ts.Program;
function compile(overrides: Record<string, string> = {}) {
  const canonical = (file: string) => path.resolve(file).replaceAll('\\', '/');
  const sources = new Map(Object.entries(overrides).map(([file, text]) => [canonical(path.join(root, file)), text]));
  const host = ts.createCompilerHost(compilerOptions, true);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, fresh) => sources.has(canonical(file))
    ? ts.createSourceFile(file, sources.get(canonical(file))!, version, true)
    : baseline?.getSourceFile(file) ?? readSource(file, version, onError, fresh);
  return ts.createProgram([...new Set([...contractFiles, ...sources.keys()])], compilerOptions, host);
}
function portableViolations(program: ts.Program) {
  const remaining = new Set(browserExceptions);
  const violations: string[] = [];
  if (program.getSourceFiles().some(file => /\/lib\.(dom|webworker)\./.test(file.fileName.replaceAll('\\', '/')))) {
    violations.push('Browser libraries must not be referenced by portable contracts.');
  }
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const source = diagnostic.file;
    let property: ts.Node | undefined;
    if (source && diagnostic.start !== undefined) {
      const find = (node: ts.Node) => {
        if (node.pos <= diagnostic.start! && diagnostic.start! < node.end) {
          if (ts.isPropertySignature(node)) property = node;
          ts.forEachChild(node, find);
        }
      };
      find(source);
    }
    if (source && property && ts.isPropertySignature(property) && ts.isInterfaceDeclaration(property.parent) && diagnostic.code === 2304) {
      const file = path.relative(root, source.fileName).replaceAll('\\', '/');
      const token = source.text.slice(diagnostic.start!, diagnostic.start! + diagnostic.length!);
      const key = `${file}:${property.parent.name.text}.${property.name.getText(source)}:${token}`;
      if (remaining.delete(key)) continue;
    }
    violations.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }
  return [...violations, ...[...remaining].map(key => `Unused browser exception: ${key}`)];
}
beforeAll(() => { baseline = compile(); });

it('compiles all current contracts without DOM with only the four exact browser exceptions', () => {
  expect(portableViolations(baseline)).toEqual([]);
});
it.each(['HTMLElement', 'Document', 'MediaStreamTrack'])('rejects a new portable-contract use of %s', name => {
  const program = compile({ 'src/types/architecture-fixture.ts': `export interface NewDto { element: ${name}; }` });
  expect(portableViolations(program)).toContain(`Cannot find name '${name}'.`);
});
it.each([
  ['track: MediaStreamTrack;', 'track: HTMLElement;', "Cannot find name 'HTMLElement'."],
  ['track: MediaStreamTrack;', 'track: MediaStreamTrack; extra: HTMLMediaElement;', "Cannot find name 'HTMLMediaElement'."],
  ['attach: (element: HTMLMediaElement) => void;', 'attach: (element: HTMLMediaElement, extra: HTMLMediaElement) => void;', "Cannot find name 'HTMLMediaElement'."],
  ['track: MediaStreamTrack;', 'track: string;', 'Unused browser exception: src/types/liveAudio.ts:LiveAudioRemoteTrack.track:MediaStreamTrack'],
])('keeps browser exceptions exact when changing %s', (before, after, expected) => {
  const source = fs.readFileSync(path.join(root, 'src/types/liveAudio.ts'), 'utf8');
  expect(source).toContain(before);
  expect(portableViolations(compile({ 'src/types/liveAudio.ts': source.replace(before, after) }))).toContain(expected);
});
it('does not exempt unrelated TypeScript errors', () => {
  expect(portableViolations(compile({ 'src/types/architecture-fixture.ts': 'export const invalid: number = "text";' })))
    .toContain("Type 'string' is not assignable to type 'number'.");
});
it('rejects a reference directive that would silently enable DOM', () => {
  expect(portableViolations(compile({ 'src/types/architecture-fixture.ts': '/// <reference lib="dom" />\nexport interface NewDto { element: HTMLElement; }' })))
    .toContain('Browser libraries must not be referenced by portable contracts.');
});
