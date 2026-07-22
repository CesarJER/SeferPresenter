import path from 'node:path'

export const isPathInsideRoot = (rootPath, candidatePath) => {
  const root = path.resolve(rootPath)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(root, candidate)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export const resolvePathInsideRoot = (rootPath, requestedPath) => {
  if (typeof requestedPath !== 'string') return null
  const relativeRequest = requestedPath.replace(/^[/\\]+/, '')
  const candidate = path.resolve(rootPath, relativeRequest)
  return isPathInsideRoot(rootPath, candidate) ? candidate : null
}
