export interface FileListItem {
  id: string;
  orgId: string;
  noteId: string | null;
  noteTitle: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByLabel: string;
  createdAt: string;
  canDelete: boolean;
}

export interface FilesPage {
  items: FileListItem[];
  nextCursor: string | null;
}
