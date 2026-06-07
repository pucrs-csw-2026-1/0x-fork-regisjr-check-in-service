import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IRegistrationClient } from '../domain/ports/registration-client.port';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { IEventPublisher } from '../domain/ports/event-publisher.port';
import { CheckInMethod, CheckInRecord } from '../domain/check-in.types';

@Injectable()
export class ManualCheckInUseCase {
  private readonly logger = new Logger(ManualCheckInUseCase.name);

  constructor(
    private readonly registrationClient: IRegistrationClient,
    private readonly checkInRepository: ICheckInRepository,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  async execute(
    eventId: string,
    userId: string,
    performedBy: string,
    reason?: string,
  ): Promise<CheckInRecord> {
    await this.registrationClient.validateRegistration(eventId, userId);

    const existing = await this.checkInRepository.findByEventAndUser(eventId, userId);
    if (existing) {
      throw new ConflictException(existing);
    }

    const now = new Date().toISOString();
    const record: CheckInRecord = {
      entityType: 'CheckIn',
      checkInId: randomUUID(),
      eventId,
      userId,
      checkedInAt: now,
      method: CheckInMethod.Manual,
      scannedBy: performedBy,
      reason: reason ?? null,
      tokenJti: null,
      createdAt: now,
    };

    await this.checkInRepository.save(record);
    void this.publishEvent(record, now);

    return record;
  }

  private async publishEvent(record: CheckInRecord, now: string): Promise<void> {
    try {
      await this.eventPublisher.publish({
        eventType: 'CheckInCompleted',
        version: '1.0',
        occurredAt: now,
        data: {
          checkInId: record.checkInId,
          eventId: record.eventId,
          userId: record.userId,
          checkedInAt: record.checkedInAt,
          method: record.method,
          scannedBy: record.scannedBy,
        },
      });
    } catch (err) {
      this.logger.error('Failed to publish CheckInCompleted to SNS', (err as Error).message);
    }
  }
}
