export enum CheckInMethod {
  QrCode = 'qr_code',
  Manual = 'manual',
}

export interface CheckInRecord {
  entityType: 'CheckIn';
  checkInId: string;
  eventId: string;
  userId: string;
  checkedInAt: string;
  method: CheckInMethod;
  scannedBy: string | null;
  reason: string | null;
  tokenJti: string | null;
  createdAt: string;
}

export interface QrCodeAuditRecord {
  entityType: 'QrCodeAudit';
  eventId: string;
  userId: string;
  tokenJti: string;
  issuedAt: string;
  expiresAt: string;
}
