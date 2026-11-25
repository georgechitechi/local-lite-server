export interface NoteRow {
  id: string;
  title: string;
  body: string | null;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  deleted: boolean;
}
