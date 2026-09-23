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
  /** Stable identifier for one imported workbook/year. */
  datasetId?: string;
  /** User-facing name used in the annual dataset switcher. */
  displayName?: string;
  /** Stable personal WPS file identity used when refreshing the current dataset. */
  sourceFileId?: string;
  sourceDriveId?: string;
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
