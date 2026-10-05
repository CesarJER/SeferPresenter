import fs from 'node:fs'
import path from 'node:path'
import { loadEnvFile } from 'node:process'

export const loadProjectEnvironment = (rootDir) => {
  // Node preserves existing environment values: explicit env > local > base.
  for (const name of ['.env.local', '.env']) {
    const file = path.join(rootDir, name)
    if (fs.existsSync(file)) loadEnvFile(file)
  }
}
