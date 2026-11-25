export type NavTab =
  | 'overview'
  | 'data'
  | 'auth'
  | 'functions'
  | 'schedules'
  | 'backups'
  | 'storage'
  | 'logs'
  | 'env'
  | 'settings';

export interface LocalAuthAccount {
  id: string;
  email: string;
  displayName: string | null;
  failedLoginAttempts: number;
  lockedUntil: number | null;
  tokenVersion: number;
  createdAt: number;
  consoleRole?: string | null;
  consoleActive?: boolean;
}

export interface SyncChangeRow {
  tableName: string;
  rowId: string;
  operation: string;
  businessId: string;
  updatedAt: number;
}

export interface BackupArchiveRow {
  id: string;
  userId: string;
  fileName: string;
  status: string;
  sizeBytes: number;
  recordCount: number;
  createdAt: number;
}

export interface EndpointItem {
  method?: string;
  path?: string;
}

export interface OverviewData {
  health: Record<string, any>;
  endpoints: { endpoints?: EndpointItem[] } & Record<string, any>;
  dbConnected: boolean;
  dbError: string | null;
  tableCounts: Array<{ table: string; count: number }>;
  localAccounts: LocalAuthAccount[];
  backups: BackupArchiveRow[];
  consoleRole?: 'super_admin' | 'admin' | null;
}

export interface TableBrowserData {
  table: string;
  columns: string[];
  total: number;
  limit: number;
  offset: number;
  rows: Array<Record<string, any>>;
}

export const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  superAdminOnly?: boolean;
}> = [
  { id: 'overview', label: 'Overview' },
  { id: 'data', label: 'Data' },
  { id: 'auth', label: 'Auth & Users' },
  { id: 'functions', label: 'Functions' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'backups', label: 'Backups' },
  { id: 'storage', label: 'Storage' },
  { id: 'logs', label: 'Sync Logs' },
  { id: 'env', label: 'Environment', superAdminOnly: true },
];
