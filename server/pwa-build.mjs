import { createHash } from 'node:crypto'

export const createAudienceServiceWorkerSource = (template, bundleFileNames) => {
  const buildAssets = [...new Set(bundleFileNames)]
    .filter((fileName) => fileName.startsWith('assets/'))
    .map((fileName) => `/${fileName}`)
    .sort()
  const buildId = createHash('sha256')
    .update(buildAssets.join('\n'))
    .digest('hex')
    .slice(0, 16)

  return template
    .replace("const SW_VERSION = 'dev';", `const SW_VERSION = '${buildId}';`)
    .replace('const BUILD_ASSETS = [];', `const BUILD_ASSETS = ${JSON.stringify(buildAssets, null, 2)};`)
}
