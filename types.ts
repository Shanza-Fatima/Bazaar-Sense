export interface TranslationInfo {
  name: string;
  phonetic: string;
}

export interface VerifiedShop {
  name: string;
  location: string;
  specialty: string;
  discountCode: string;
  rating: number;
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
  verifiedShops?: VerifiedShop[];
}

export interface HistoryItem {
  id: string;
  objectName: string;
  pricePKR: string;
  timestamp: number;
  imageThumbnail?: string;
  result?: AnalysisResult;
}

export enum AppState {
  IDLE = 'IDLE',
  CAPTURING = 'CAPTURING',
  ANALYZING = 'ANALYZING',
  RESULT = 'RESULT',
  ERROR = 'ERROR',
  HISTORY = 'HISTORY'
}