import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { RegistrationServiceClient } from '../http-clients/registration-service.client';
import { SnsPublisherService } from '../messaging/sns-publisher.service';
import { CheckInMethod, CheckInRecord, QrCodeAuditRecord } from './domain/check-in.types';
import { CheckInRepository } from './infrastructure/repository/check-in.repository';
import { QrCodeTokenService } from './infrastructure/jwt/qr-code-token.service';

export interface GenerateQrCodeResponse {
  token: string;
  qrPayload: string;
  expiresAt: string;
}

export interface CheckInResponse {
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

export interface CheckInListResponse {
  data: CheckInResponse[];
  total: number;
  page: number;
  limit: number;
}

export interface CheckInStatsResponse {
  eventId: string;
  totalCheckIns: number;
  byMethod: Record<string, number>;
  qrAudits: number;
}

interface ScanPayload {
  token: string;
  eventId: string;
  scannedBy: string;
}

interface ManualCheckInPayload {
  userId: string;
  performedBy: string;
  reason?: string;
}

@Injectable()
export class CheckInService {
  private readonly logger = new Logger(CheckInService.name);

  constructor(
    private readonly qrCodeTokenService: QrCodeTokenService,
    private readonly registrationServiceClient: RegistrationServiceClient,
    private readonly snsPublisherService: SnsPublisherService,
    private readonly checkInRepository: CheckInRepository,
  ) {}

  async generateQrCode(eventId: string, userId: string): Promise<GenerateQrCodeResponse> {
    await this.registrationServiceClient.validateRegistration(eventId, userId);

    const issued = await this.qrCodeTokenService.issue(eventId, userId);
    const audit: QrCodeAuditRecord = {
      eventId,
      userId,
      tokenJti: issued.jti,
      issuedAt: new Date().toISOString(),
      expiresAt: issued.expiresAt,
    };

    await this.checkInRepository.saveQrAudit(audit);

    return {
      token: issued.token,
      qrPayload: issued.payload,
      expiresAt: issued.expiresAt,
    };
  }

  async scan(payload: ScanPayload): Promise<CheckInResponse> {
    const tokenClaims = await this.qrCodeTokenService.verify(payload.token);
    await this.registrationServiceClient.validateRegistration(payload.eventId, tokenClaims.userId);

    return this.persistCheckIn({
      eventId: payload.eventId,
      userId: tokenClaims.userId,
      method: CheckInMethod.QrCode,
      scannedBy: payload.scannedBy,
      reason: null,
      tokenJti: tokenClaims.jti,
    });
  }

  async manualCheckIn(eventId: string, payload: ManualCheckInPayload): Promise<CheckInResponse> {
    await this.registrationServiceClient.validateRegistration(eventId, payload.userId);

    return this.persistCheckIn({
      eventId,
      userId: payload.userId,
      method: CheckInMethod.Manual,
      scannedBy: payload.performedBy,
      reason: payload.reason ?? null,
      tokenJti: null,
    });
  }

  async listEventCheckIns(eventId: string, page = 1, limit = 20): Promise<CheckInListResponse> {
    const { items } = await this.checkInRepository.listByEvent(eventId, limit * page);
    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);

    return {
      data: pageItems,
      total: items.length,
      page,
      limit,
    };
  }

  async getUserCheckIn(eventId: string, userId: string): Promise<CheckInResponse> {
    const record = await this.checkInRepository.findByEventAndUser(eventId, userId);

    if (!record) {
      throw new NotFoundException('Check-in not found');
    }

    return record;
  }

  async getStats(eventId: string): Promise<CheckInStatsResponse> {
    const { items } = await this.checkInRepository.listByEvent(eventId, 1000);
    const qrAudits = await this.checkInRepository.countQrAudits(eventId);

    return {
      eventId,
      totalCheckIns: items.length,
      byMethod: items.reduce<Record<string, number>>((acc, item) => {
        acc[item.method] = (acc[item.method] ?? 0) + 1;
        return acc;
      }, {}),
      qrAudits,
    };
  }

  private async persistCheckIn(input: {
    eventId: string;
    userId: string;
    method: CheckInMethod;
    scannedBy: string;
    reason: string | null;
    tokenJti: string | null;
  }): Promise<CheckInResponse> {
    const existing = await this.checkInRepository.findByEventAndUser(input.eventId, input.userId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: CheckInRecord = {
      checkInId: randomUUID(),
      eventId: input.eventId,
      userId: input.userId,
      checkedInAt: now,
      method: input.method,
      scannedBy: input.scannedBy,
      reason: input.reason,
      tokenJti: input.tokenJti,
      createdAt: now,
    };

    await this.checkInRepository.save(record);

    void this.publishEvent(record, now);

    return record;
  }

  private async publishEvent(record: CheckInRecord, now: string): Promise<void> {
    try {
      await this.snsPublisherService.publish({
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
      this.logger.error('Failed to publish CheckInCompleted event to SNS', (err as Error).message);
    }
  }
}
