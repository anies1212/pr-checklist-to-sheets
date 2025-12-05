export type Member = {
  name: string;
};

export type ChecklistItem = {
  note: string;
  prUrl: string;
  author: string;
};

export type PrChecklistSource = {
  number: number;
  body: string;
  author: string;
  url: string;
  mergedAt?: string | null;
};
