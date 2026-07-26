import { build } from 'vite'

const LIVE_AUDIO_ENV = 'VITE_SEFER_LIVE_AUDIO_BUILD'

const buildModuleIds = async (enabled) => {
  process.env[LIVE_AUDIO_ENV] = enabled ? 'true' : 'false'
  const result = await build({
    logLevel: 'silent',
    build: {
      emptyOutDir: false,
      write: false,
    },
  })

  const outputs = Array.isArray(result) ? result : [result]
  return new Set(outputs.flatMap((output) => (
    output.output.flatMap((entry) => (
      entry.type === 'chunk' ? Object.keys(entry.modules) : []
    ))
  )).map((id) => id.replaceAll('\\', '/')))
}

const isLiveAudioRuntimeModule = (id) => (
  id.includes('/node_modules/livekit-client/') ||
  id.endsWith('/src/features/liveAudio/hooks/useLiveAudio.ts') ||
  id.includes('/src/features/liveAudio/components/audience/LiveAudioAudienceContainer.tsx') ||
  id.includes('/src/features/liveAudio/components/control/LiveAudioControlContainer.tsx') ||
  id.includes('/src/features/liveAudio/components/presenter/LiveAudioPresenter.tsx')
)

const previousLiveAudioBuild = process.env[LIVE_AUDIO_ENV]
const disabledModules = await buildModuleIds(false)
const enabledModules = await buildModuleIds(true)
if (previousLiveAudioBuild === undefined) delete process.env[LIVE_AUDIO_ENV]
else process.env[LIVE_AUDIO_ENV] = previousLiveAudioBuild
const disabledRuntimeModules = [...disabledModules].filter(isLiveAudioRuntimeModule)
const enabledRuntimeModules = [...enabledModules].filter(isLiveAudioRuntimeModule)

if (disabledRuntimeModules.length > 0) {
  throw new Error(
    `Live Audio runtime leaked into the disabled build:\n${disabledRuntimeModules.join('\n')}`,
  )
}

if (!enabledRuntimeModules.some((id) => id.includes('/node_modules/livekit-client/'))) {
  throw new Error('The enabled build did not include livekit-client')
}

if (!enabledRuntimeModules.some((id) => id.endsWith('/src/features/liveAudio/hooks/useLiveAudio.ts'))) {
  throw new Error('The enabled build did not include the Live Audio runtime hook')
}

console.log(
  `Live Audio bundle verification passed: disabled=${disabledModules.size} modules, enabled=${enabledModules.size} modules.`,
)
