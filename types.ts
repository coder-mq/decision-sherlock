export interface DecisionCriteria {
  id: string;
  name: string;
  weight: number; // 1-10
  description?: string;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  data: string; // Base64
}

export interface DecisionOption {
  id: string;
  name: string;
  description: string;
  attachments: Attachment[];
}

export interface CriteriaAnalysis {
  criteriaId: string;
  score: number; // 0-100
  reasoning: string;
}

export interface OptionAnalysis {
  optionId: string;
  criteriaAnalysis: CriteriaAnalysis[];
  pros: string[];
  cons: string[];
  totalWeightedScore: number;
}

export interface AnalysisResult {
  analysis: OptionAnalysis[];
  verdict: string;
  winnerId: string;
  recommendation: string;
}

export interface DecisionState {
  title: string;
  description: string;
  criteria: DecisionCriteria[];
  options: DecisionOption[];
  result: AnalysisResult | null;
}
