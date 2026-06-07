import { CheckInRecord, QrCodeAuditRecord } from '../check-in.types';

export abstract class ICheckInRepository {
  abstract save(record: CheckInRecord): Promise<boolean>;
  abstract findByEventAndUser(eventId: string, userId: string): Promise<CheckInRecord | undefined>;
  abstract listByEvent(
    eventId: string,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<{ items: CheckInRecord[]; lastKey?: Record<string, unknown> }>;
  abstract saveQrAudit(audit: QrCodeAuditRecord): Promise<void>;
  abstract countQrAudits(eventId: string): Promise<number>;
}
