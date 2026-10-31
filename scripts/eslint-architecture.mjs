import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contracts = path.join(root, 'src/types');
const clientOwner = path.join(root, 'src/features/liveAudio/hooks/useLiveAudio.ts');
const serverOwner = path.join(root, 'server/livekit-server.mjs');
const widgets = new Set(['SeferControlPanel.tsx', 'SeferControlPanelMini.tsx']
  .map(name => path.join(root, 'src/components/control', name)));
const controller = path.join(root, 'src/hooks/useSeferControlLogic');
const reader = path.join(root, 'src/hooks/useSeferReader');
const isInside = (directory, file) => file.startsWith(directory + path.sep);
const modulePath = (file, source) => source.startsWith('.')
  ? path.resolve(path.dirname(file), source).replace(/\.(?:[cm]?[jt]sx?)$/, '')
  : null;
const literalValue = source => typeof source?.value === 'string' ? source.value
  : source?.type === 'TemplateLiteral' && source.expressions.length === 0 ? source.quasis[0].value.cooked : null;
const isTypeOnly = node => node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type'
  || (node.specifiers?.length > 0 && node.specifiers.every(specifier => specifier.importKind === 'type' || specifier.exportKind === 'type'));

// One resolved-path rule covers the import forms the built-in import rule omits.
export default {
  rules: {
    'import-boundaries': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          portable: 'Contracts in src/types may depend only on other contracts in src/types; runtime module loading is forbidden.',
          controller: 'Scripture widgets consume the shared controller; only type imports from useSeferControlLogic are allowed.',
          sdkOwner: '{{sdk}} imports belong only to {{owner}}, including type imports and reexports.',
        },
      },
      create(context) {
        const file = path.resolve(context.filename);
        const check = (node, sourceNode = node.source) => {
          const source = literalValue(sourceNode)?.replaceAll('\\', '/') ?? null;
          const target = source === null ? null : modulePath(file, source);
          const runtimeLoad = node.type === 'ImportExpression' || node.type === 'CallExpression';
          if (isInside(contracts, file) && (runtimeLoad || target === null || !isInside(contracts, target))) {
            context.report({ node, messageId: 'portable' });
          }
          if (widgets.has(file) && (target === reader || (target === controller && !isTypeOnly(node)))) {
            context.report({ node, messageId: 'controller' });
          }
          const sdk = source?.match(/^(livekit-client|livekit-server-sdk)(?:\/|$)/)?.[1];
          if (sdk) {
            const owner = sdk === 'livekit-client' ? clientOwner : serverOwner;
            if (file !== owner) context.report({ node, messageId: 'sdkOwner', data: { sdk, owner: path.relative(root, owner).replaceAll('\\', '/') } });
          }
        };
        return {
          ImportDeclaration: check,
          ExportNamedDeclaration(node) { if (node.source) check(node); },
          ExportAllDeclaration: check,
          ImportExpression: check,
          TSImportType: check,
          TSImportEqualsDeclaration(node) {
            if (node.moduleReference.type === 'TSExternalModuleReference') check(node, node.moduleReference.expression);
          },
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]);
          },
        };
      },
    },
  },
};
