import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const viteArgs = process.argv.slice(2)

const children = []

const start = (label, command, args) => {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  })

  children.push(child)

  child.on('exit', (code, signal) => {
    if (signal) return
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`)
      shutdown(code)
    }
  })

  return child
}

const shutdown = (code = 0) => {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

start('backend', process.execPath, ['server/local-server.mjs'])
start('vite', process.execPath, [viteBin, ...viteArgs])
