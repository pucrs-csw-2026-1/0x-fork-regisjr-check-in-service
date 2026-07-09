import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IQrCodeTokenService } from '../domain/ports/qr-code-token-service.port';
import { IRegistrationClient } from '../domain/ports/registration-client.port';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { IEventPublisher } from '../domain/ports/event-publisher.port';
import { CheckInMethod, CheckInRecord } from '../domain/check-in.types';

@Injectable()
export class ScanQrCodeUseCase {
  private readonly logger = new Logger(ScanQrCodeUseCase.name);

  constructor(
    private readonly qrCodeTokenService: IQrCodeTokenService,
    private readonly registrationClient: IRegistrationClient,
    private readonly checkInRepository: ICheckInRepository,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  async execute(
    token: string,
    eventId: string,
    scannedBy: string,
    accessToken?: string,
  ): Promise<CheckInRecord> {
    const claims = await this.qrCodeTokenService.verify(token);
    await this.registrationClient.validateRegistration(eventId, claims.userId, accessToken);

    const existing = await this.checkInRepository.findByEventAndUser(eventId, claims.userId);
    if (existing) {
      // ADR-004: return 409 with the existing record so the reader sees who checked in and when
      throw new ConflictException(existing);
    }

    const now = new Date().toISOString();
    const record: CheckInRecord = {
      entityType: 'CheckIn',
      checkInId: randomUUID(),
      eventId,
      userId: claims.userId,
      checkedInAt: now,
      method: CheckInMethod.QrCode,
      scannedBy,
      reason: null,
      tokenJti: claims.jti,
      createdAt: now,
    };

    await this.checkInRepository.save(record);
    void this.publishEvent(record, now);

    return record;
  }

  private async publishEvent(record: CheckInRecord, now: string): Promise<void> {
    try {
      // Envelope canônico (US-08, ADR-0009 do Metrics): flat snake_case + `data`,
      // event_type/tópico que o consumidor de SQS do T2 espera.
      await this.eventPublisher.publish({
        event_id: record.eventId,
        event_type: 'CheckInPerformed',
        source: 'checkin-events',
        occurred_at: now,
        resource_ref: record.checkInId,
        version: '1.0',
        data: {
          event_id: record.eventId,
          attendant_id: record.userId,
          checked_in_at: record.checkedInAt,
          method: record.method,
          scanned_by: record.scannedBy,
          ...(record.reason != null ? { reason: record.reason } : {}),
        },
      });
    } catch (err) {
      this.logger.error('Failed to publish CheckInPerformed to SNS', (err as Error).message);
    }
  }
}
