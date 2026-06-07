import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { RegistrationServiceClient } from '../http-clients/registration-service.client';
import { SnsPublisherService } from '../messaging/sns-publisher.service';
import { CheckInService } from './check-in.service';
import { CheckInMethod } from './domain/check-in.types';
import { CheckInRepository } from './infrastructure/repository/check-in.repository';
import { QrCodeTokenService } from './infrastructure/jwt/qr-code-token.service';

const EVENT_ID = 'event-abc';
const USER_ID = 'user-xyz';
const STAFF_ID = 'staff-001';

describe('CheckInService', () => {
  let service: CheckInService;
  let repo: jest.Mocked<CheckInRepository>;
  let qrService: jest.Mocked<QrCodeTokenService>;
  let registrationClient: jest.Mocked<RegistrationServiceClient>;

  beforeEach(async () => {
    repo = {
      save: jest.fn().mockResolvedValue(true),
      findByEventAndUser: jest.fn().mockResolvedValue(undefined),
      listByEvent: jest.fn().mockResolvedValue({ items: [] }),
      saveQrAudit: jest.fn().mockResolvedValue(undefined),
      countQrAudits: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<CheckInRepository>;

    qrService = {
      issue: jest.fn().mockResolvedValue({
        token: 'tok',
        payload: 'checkin://tok',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        jti: 'jti-1',
      }),
      verify: jest.fn().mockResolvedValue({ eventId: EVENT_ID, userId: USER_ID, jti: 'jti-1' }),
    } as unknown as jest.Mocked<QrCodeTokenService>;

    registrationClient = {
      validateRegistration: jest.fn().mockResolvedValue({ isRegistered: true, isConfirmed: true }),
    } as unknown as jest.Mocked<RegistrationServiceClient>;

    const module = await Test.createTestingModule({
      providers: [
        CheckInService,
        { provide: CheckInRepository, useValue: repo },
        { provide: QrCodeTokenService, useValue: qrService },
        { provide: RegistrationServiceClient, useValue: registrationClient },
        { provide: SnsPublisherService, useValue: { publish: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(CheckInService);
  });

  describe('generateQrCode', () => {
    it('should validate registration and return QR token', async () => {
      const result = await service.generateQrCode(EVENT_ID, USER_ID);
      expect(registrationClient.validateRegistration).toHaveBeenCalledWith(EVENT_ID, USER_ID);
      expect(repo.saveQrAudit).toHaveBeenCalled();
      expect(result.token).toBe('tok');
    });
  });

  describe('scan', () => {
    it('should verify token, validate registration, and persist check-in', async () => {
      const result = await service.scan({ token: 'tok', eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(qrService.verify).toHaveBeenCalledWith('tok');
      expect(repo.save).toHaveBeenCalled();
      expect(result.method).toBe(CheckInMethod.QrCode);
    });

    it('should return existing check-in on duplicate scan (idempotency)', async () => {
      const existing = {
        checkInId: 'existing-id',
        eventId: EVENT_ID,
        userId: USER_ID,
        checkedInAt: new Date().toISOString(),
        method: CheckInMethod.QrCode,
        scannedBy: STAFF_ID,
        reason: null,
        tokenJti: 'jti-1',
        createdAt: new Date().toISOString(),
      };
      repo.findByEventAndUser.mockResolvedValue(existing);

      const result = await service.scan({ token: 'tok', eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(result.checkInId).toBe('existing-id');
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('manualCheckIn', () => {
    it('should create a manual check-in', async () => {
      const result = await service.manualCheckIn(EVENT_ID, {
        userId: USER_ID,
        performedBy: STAFF_ID,
        reason: 'QR reader broken',
      });
      expect(result.method).toBe(CheckInMethod.Manual);
      expect(result.reason).toBe('QR reader broken');
    });
  });

  describe('getUserCheckIn', () => {
    it('should return existing check-in', async () => {
      const record = {
        checkInId: 'id-1',
        eventId: EVENT_ID,
        userId: USER_ID,
        checkedInAt: new Date().toISOString(),
        method: CheckInMethod.Manual,
        scannedBy: STAFF_ID,
        reason: null,
        tokenJti: null,
        createdAt: new Date().toISOString(),
      };
      repo.findByEventAndUser.mockResolvedValue(record);

      const result = await service.getUserCheckIn(EVENT_ID, USER_ID);
      expect(result.checkInId).toBe('id-1');
    });

    it('should throw NotFoundException when check-in does not exist', async () => {
      repo.findByEventAndUser.mockResolvedValue(undefined);
      await expect(service.getUserCheckIn(EVENT_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
