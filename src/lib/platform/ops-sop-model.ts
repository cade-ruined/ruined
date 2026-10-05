export type OpsSopStatus = "draft" | "published" | "archived";

export type OpsSop = {
  id: string;
  title: string;
  summary: string;
  category: string;
  bodyText: string;
  externalUrl: string | null;
  status: OpsSopStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  updatedBy: string | null;
};

export type OpsSopRevision = Pick<OpsSop,
  "revision" | "status" | "title" | "summary" | "category" | "bodyText" |
  "externalUrl" | "updatedAt" | "updatedBy"
>;

export type OpsSopSnapshot = {
  canManage: boolean;
  procedures: OpsSop[];
};

export type OpsSopEditorData = {
  canManage: boolean;
  procedure: OpsSop;
  history: OpsSopRevision[];
};

export type OpsSopInput = {
  id?: string;
  expectedRevision?: number;
  title: string;
  summary: string;
  category: string;
  bodyText: string;
  externalUrl: string | null;
  status: OpsSopStatus;
};
