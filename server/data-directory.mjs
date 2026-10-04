import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_SEFER_DATA_DIR_NAME = 'data.local'
export const RUNTIME_DATA_DIRECTORIES = Object.freeze([
  'public',
  'tmp',
])

const assertDirectory = (directoryPath, label) => {
  const stats = fs.lstatSync(directoryPath)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${directoryPath}`)
  }
}

const ensureDirectoryTree = (rootPath, relativeDirectory = '') => {
  if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true })
  assertDirectory(rootPath, 'SEFER_DATA_DIR')

  let currentPath = rootPath
  for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment)
    if (!fs.existsSync(currentPath)) fs.mkdirSync(currentPath)
    assertDirectory(currentPath, 'Data subdirectory')
  }
}

const collectExampleFiles = (exampleDir, relativeDirectory = '') => {
  const directoryPath = path.join(exampleDir, relativeDirectory)
  assertDirectory(directoryPath, 'Example data directory')

  return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Example data must not contain symbolic links: ${relativePath}`)
    }
    if (entry.isDirectory()) return collectExampleFiles(exampleDir, relativePath)
    if (!entry.isFile()) throw new Error(`Unsupported example data entry: ${relativePath}`)
    return [relativePath]
  })
}

export const resolveSeferDataDir = ({ rootDir, configuredPath = process.env.SEFER_DATA_DIR } = {}) => {
  if (!rootDir) throw new Error('rootDir is required to resolve SEFER_DATA_DIR')
  const selectedPath = configuredPath?.trim() || DEFAULT_SEFER_DATA_DIR_NAME
  return path.isAbsolute(selectedPath)
    ? path.resolve(selectedPath)
    : path.resolve(rootDir, selectedPath)
}

export const initializeSeferDataDir = ({ dataDir, exampleDir }) => {
  if (!dataDir || !exampleDir) throw new Error('dataDir and exampleDir are required')
  if (!fs.existsSync(exampleDir)) throw new Error(`Example data directory not found: ${exampleDir}`)

  ensureDirectoryTree(dataDir)
  for (const relativeDirectory of RUNTIME_DATA_DIRECTORIES) {
    ensureDirectoryTree(dataDir, relativeDirectory.split('/').join(path.sep))
  }
  const created = []
  const preserved = []

  for (const relativePath of collectExampleFiles(exampleDir)) {
    const sourcePath = path.join(exampleDir, relativePath)
    const targetPath = path.join(dataDir, relativePath)
    ensureDirectoryTree(dataDir, path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath))

    try {
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL)
      created.push(relativePath.replace(/\\/g, '/'))
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const stats = fs.lstatSync(targetPath)
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Existing data target must be a real file: ${targetPath}`)
      }
      preserved.push(relativePath.replace(/\\/g, '/'))
    }
  }

  return { dataDir, created, preserved }
}

export const getSeferDataPaths = (dataDir) => Object.freeze({
  presentationSession: path.join(dataDir, 'presentation-session.json'),
  presentations: path.join(dataDir, 'presentations.json'),
  audioSync: path.join(dataDir, 'audio_sync.json'),
  audienceCacheAssets: path.join(dataDir, 'config', 'audience-cache-assets.txt'),
  public: path.join(dataDir, 'public'),
  legal: path.join(dataDir, 'legal'),
  legalActivation: path.join(dataDir, 'config', 'legal-activation.json'),
  branding: Object.freeze({
    logo: path.join(dataDir, 'branding', 'logo.svg'),
    favicon: path.join(dataDir, 'branding', 'favicon.svg'),
    welcome: path.join(dataDir, 'branding', 'welcome.md'),
  }),
})
