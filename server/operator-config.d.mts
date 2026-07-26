export type OperatorRecordingState = 'NOT_RECORDING' | 'RECORDING'
export type OperatorAccessMode = 'PUBLIC' | 'CONTROLLED'

export interface OperatorManifest {
  schemaVersion: 1
  operatorName: string
  legalId: string
  rightsContact: string
  website: string
  legalBasis: string
  privacyUrl: string
  recordingAvailable: boolean
  recordingDefault: OperatorRecordingState
  recordingMutable: boolean
  accessDefault: OperatorAccessMode
}

export function buildOperatorManifest(
  env: Record<string, string | undefined>,
): OperatorManifest

export function validateOperatorManifestFile(
  staticDir: string,
  runtimeEnv?: Record<string, string | undefined>,
): OperatorManifest

export function readPrivacyLocalMarkdown(filePath?: string): string | null
