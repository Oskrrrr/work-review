export type StepKind = 'text' | 'image';

export interface WorkStep {
  id: string;
  order: number;
  kind: StepKind;
  text?: string;
  imageId?: string;
  imageName?: string;
}

export interface WorkRecord {
  id: string;
  sourceRow: number;
  date: string;
  weekday: string;
  title: string;
  originalCategory: string;
  effectiveCategory: string;
  steps: WorkStep[];
  caseId?: string;
  sourceSignature: string;
}

export interface CaseItem {
  id: string;
  title: string;
  categoryOverride?: string;
  recordIds: string[];
  status: 'confirmed' | 'suggested';
  createdAt: string;
}

export interface DatasetMeta {
  sourceName: string;
  sheetName: string;
  year: number;
  importedAt: string;
  sourceMode: 'demo' | 'local' | 'personal-wps' | 'wps';
  imageCount: number;
  warnings: string[];
  categoryGroups?: Record<string, string[]>;
  customAssociations?: CustomAssociationRule[];
  associationExclusions?: string[];
}

export interface CustomAssociationRule {
  id: string;
  caseId: string;
  title: string;
  keywords: string[];
  recordIds: string[];
  createdAt: string;
}

export interface WorkDataset {
  meta: DatasetMeta;
  records: WorkRecord[];
  cases: CaseItem[];
}
