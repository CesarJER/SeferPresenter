import { pathToFileURL } from 'node:url'

const patterns = {
  ipv4: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
  ipv6: /(?<![A-Fa-f0-9:])(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}(?![A-Fa-f0-9:])/g,
  authorization: /\b(?:Basic\s+[A-Za-z0-9+/=]+|Bearer\s+\S+)/gi,
  jwt: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  sensitiveField: /["'](?:alias|displayName|selectedOptionIds|sessionId|PRIVATE_CONTROL_SIGNAL)["']\s*:/gi,
  tokenQuery: /[?&](?:token|access_token|refresh_token)=[^\s&]+/gi,
}

export const analyseLogText = (text) => Object.fromEntries(
  Object.entries(patterns).map(([name, pattern]) => [name, Array.from(text.matchAll(pattern)).length]),
)

export const hasPotentialPrivacyLeak = (counts) => Object.values(counts).some((count) => count > 0)

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const counts = analyseLogText(Buffer.concat(chunks).toString('utf8'))
  process.stdout.write(`${JSON.stringify({ inspected: true, counts })}\n`)
  if (hasPotentialPrivacyLeak(counts)) process.exitCode = 1
}
