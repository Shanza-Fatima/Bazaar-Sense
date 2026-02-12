
export interface TranslationInfo {
  name: string;
  phonetic: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
  type?: 'web' | 'maps';
}

export interface AnalysisResult {
  objectName: string;
  pricePKR: string;
  urdu: TranslationInfo;
  pashto: TranslationInfo;
  description: string;
  locationTips?: string;
  groundingSources?: GroundingSource[];
}

export interface HistoryItem {
  id: string;
  objectName: string;
  pricePKR: string;
  timestamp: number;
}

export enum AppState {
  CONFIG_REQUIRED = 'CONFIG_REQUIRED',
  IDLE = 'IDLE',
  CAPTURING = 'CAPTURING',
  ANALYZING = 'ANALYZING',
  RESULT = 'RESULT',
  ERROR = 'ERROR',
  HISTORY = 'HISTORY'
}
