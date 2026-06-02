export interface TransliterationConfig {
  qereDivine?: boolean;
  properNamesOnly?: boolean;
  showForteMarker?: boolean;
  forceInitialCapital?: boolean;
  ayinMode?: 'apostrophe' | 'left-single-quote' | 'none' | 'underline';
  finalHeMode?: 'h' | 'silent';
  qamatsQatanInference?: boolean;
}
