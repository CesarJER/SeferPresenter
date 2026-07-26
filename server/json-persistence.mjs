import fs from 'node:fs'
import path from 'node:path'

const fallbackRenameCodes = new Set(['EBUSY', 'EACCES', 'EPERM', 'EXDEV'])

const makeTemporaryPath = (filePath, label = 'tmp') =>
  `${filePath}.${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

const fsyncDirectory = (directory) => {
  let descriptor
  try {
    descriptor = fs.openSync(directory, 'r')
    fs.fsyncSync(descriptor)
  } catch {
    // Directory fsync is not supported by every platform/filesystem.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

const writePreparedFile = (filePath, contents) => {
  const descriptor = fs.openSync(filePath, 'wx', 0o600)
  try {
    fs.writeFileSync(descriptor, contents, 'utf8')
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

const replaceBackup = (preparedBackup, backupPath) => {
  try {
    fs.renameSync(preparedBackup, backupPath)
  } catch (error) {
    if (!['EEXIST', 'EACCES', 'EPERM'].includes(error?.code) || !fs.existsSync(backupPath)) throw error
    fs.unlinkSync(backupPath)
    fs.renameSync(preparedBackup, backupPath)
  }
}

const writeExistingFileInPlace = (filePath, contents) => {
  const descriptor = fs.openSync(filePath, 'r+')
  try {
    let offset = 0
    const buffer = Buffer.from(contents, 'utf8')
    while (offset < buffer.length) {
      offset += fs.writeSync(descriptor, buffer, offset, buffer.length - offset, offset)
    }
    fs.ftruncateSync(descriptor, buffer.length)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

export const writeJsonSafely = (filePath, value, options = {}) => {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  const directory = path.dirname(filePath)
  const backupPath = options.backupPath || `${filePath}.bak`
  const preparedPath = makeTemporaryPath(filePath)
  const preparedBackup = makeTemporaryPath(backupPath, 'tmp')
  const targetExists = fs.existsSync(filePath)

  writePreparedFile(preparedPath, serialized)
  try {
    if (targetExists) {
      fs.copyFileSync(filePath, preparedBackup, fs.constants.COPYFILE_EXCL)
      const backupDescriptor = fs.openSync(preparedBackup, 'r+')
      try {
        fs.fsyncSync(backupDescriptor)
      } finally {
        fs.closeSync(backupDescriptor)
      }
      replaceBackup(preparedBackup, backupPath)
      fsyncDirectory(directory)
    }

    try {
      if (options.forceInPlaceFallback === true) {
        const error = new Error('Forced bind-mount fallback')
        error.code = 'EBUSY'
        throw error
      }
      fs.renameSync(preparedPath, filePath)
      fsyncDirectory(directory)
      return { mode: 'atomic-rename', backupPath: targetExists ? backupPath : null, limitation: null }
    } catch (error) {
      if (!targetExists || !fallbackRenameCodes.has(error?.code)) throw error

      // A Docker single-file bind mount cannot be replaced with rename(2).
      // The fully fsynced backup is created before this explicit fallback.
      // Power loss during the in-place commit can damage the primary, but the
      // backup remains recoverable while its containing filesystem persists.
      try {
        writeExistingFileInPlace(filePath, serialized)
      } catch (writeError) {
        try {
          writeExistingFileInPlace(filePath, fs.readFileSync(backupPath, 'utf8'))
        } catch {
          // Preserve the original failure; backupPath is returned in its message.
        }
        writeError.message = `${writeError.message}; recovery backup: ${backupPath}`
        throw writeError
      }
      fs.unlinkSync(preparedPath)
      return {
        mode: 'bind-mount-in-place',
        backupPath,
        limitation: 'Primary replacement is not atomic on a single-file bind mount; the fsynced sibling backup must persist for crash recovery.',
      }
    }
  } finally {
    for (const temporaryPath of [preparedPath, preparedBackup]) {
      try {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
      } catch {
        // Best-effort cleanup; never hide the persistence result/error.
      }
    }
  }
}
