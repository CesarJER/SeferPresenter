export interface TransliterationConfig {
  qereDivine?: boolean;
  properNamesOnly?: boolean;
  showForteMarker?: boolean;
  forceInitialCapital?: boolean;
  ayinMode?: 'apostrophe' | 'left-single-quote' | 'none';
  finalHeMode?: 'h' | 'silent';
  qamatsQatanInference?: boolean;
}