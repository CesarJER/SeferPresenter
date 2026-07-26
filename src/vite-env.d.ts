/// <reference types="vite/client" />

interface SeferOperatorConfig {
  schemaVersion: 1;
  operatorName: string;
  legalId: string;
  rightsContact: string;
  website: string;
  legalBasis: string;
  privacyUrl: string;
  recordingAvailable: boolean;
  recordingDefault: 'NOT_RECORDING' | 'RECORDING';
  recordingMutable: boolean;
  accessDefault: 'PUBLIC' | 'CONTROLLED';
}

declare const __SEFER_OPERATOR_CONFIG__: SeferOperatorConfig;
