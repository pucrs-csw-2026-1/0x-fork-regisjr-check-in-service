import { ConflictException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { IEventPublisher } from '../domain/ports/event-publisher.port';
import { IQrCodeTokenService } from '../domain/ports/qr-code-token-service.port';
import { IRegistrationClient } from '../domain/ports/registration-client.port';
import { CheckInMethod } from '../domain/check-in.types';
import { ScanQrCodeUseCase } from './scan-qr-code.use-case';

const EVENT_ID = 'evt-1';
const USER_ID = 'user-xyz';
const STAFF_ID = 'staff-001';

const baseRecord = {
  entityType: 'CheckIn' as const,
  checkInId: 'existing-id',
  eventId: EVENT_ID,
  userId: USER_ID,
  checkedInAt: '2026-01-01T00:00:00.000Z',
  method: CheckInMethod.QrCode,
  scannedBy: STAFF_ID,
  reason: null,
  tokenJti: 'jti-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('ScanQrCodeUseCase', () => {
  let useCase: ScanQrCodeUseCase;
  let repo: jest.Mocked<ICheckInRepository>;
  let qrService: jest.Mocked<IQrCodeTokenService>;
  let registrationClient: jest.Mocked<IRegistrationClient>;
  let eventPublisher: jest.Mocked<IEventPublisher>;

  beforeEach(async () => {
    repo = {
      save: jest.fn().mockResolvedValue(true),
      findByEventAndUser: jest.fn().mockResolvedValue(undefined),
      listByEvent: jest.fn(),
      saveQrAudit: jest.fn(),
      countQrAudits: jest.fn(),
    } as unknown as jest.Mocked<ICheckInRepository>;

    qrService = {
      issue: jest.fn(),
      verify: jest.fn().mockResolvedValue({ eventId: EVENT_ID, userId: USER_ID, jti: 'jti-1' }),
    } as unknown as jest.Mocked<IQrCodeTokenService>;

    registrationClient = {
      validateRegistration: jest.fn().mockResolvedValue({ isRegistered: true, isConfirmed: true }),
    } as unknown as jest.Mocked<IRegistrationClient>;

    eventPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IEventPublisher>;

    const module = await Test.createTestingModule({
      providers: [
        ScanQrCodeUseCase,
        { provide: IQrCodeTokenService, useValue: qrService },
        { provide: IRegistrationClient, useValue: registrationClient },
        { provide: ICheckInRepository, useValue: repo },
        { provide: IEventPublisher, useValue: eventPublisher },
      ],
    }).compile();

    useCase = module.get(ScanQrCodeUseCase);
  });

  it('verifies QR token and validates registration', async () => {
    await useCase.execute('tok', EVENT_ID, STAFF_ID);
    expect(qrService.verify).toHaveBeenCalledWith('tok');
    expect(registrationClient.validateRegistration).toHaveBeenCalledWith(EVENT_ID, USER_ID);
  });

  it('saves a new check-in with correct fields', async () => {
    const result = await useCase.execute('tok', EVENT_ID, STAFF_ID);
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'CheckIn',
      eventId: EVENT_ID,
      userId: USER_ID,
      method: CheckInMethod.QrCode,
      scannedBy: STAFF_ID,
      tokenJti: 'jti-1',
      reason: null,
    }));
    expect(result.method).toBe(CheckInMethod.QrCode);
  });

  it('throws ConflictException with existing record on duplicate scan (ADR-004)', async () => {
    repo.findByEventAndUser.mockResolvedValue(baseRecord);

    const err = await useCase.execute('tok', EVENT_ID, STAFF_ID).catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ checkInId: 'existing-id' });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('publishes CheckInPerformed with the canonical envelope after saving', async () => {
    await useCase.execute('tok', EVENT_ID, STAFF_ID);
    // fire-and-forget — give microtask queue a tick
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(eventPublisher.publish).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'CheckInPerformed',
      source: 'checkin-events',
      event_id: EVENT_ID,
      version: '1.0',
      data: expect.objectContaining({
        event_id: EVENT_ID,
        attendant_id: USER_ID,
        method: CheckInMethod.QrCode,
        scanned_by: STAFF_ID,
      }),
    }));
  });

  it('não quebra a resposta ao cliente quando a publicação no SNS falha, apenas loga (US-08 critério 6)', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    eventPublisher.publish.mockRejectedValue(new Error('sns down'));

    const result = await useCase.execute('tok', EVENT_ID, STAFF_ID);
    // publishEvent é fire-and-forget (`void`) — deixa o catch rodar antes de assertar
    await new Promise((resolve) => setTimeout(resolve, 0));

    // resposta ao cliente não é afetada pela falha de publicação
    expect(result.method).toBe(CheckInMethod.QrCode);
    expect(result.checkInId).toBeDefined();
    // a falha é engolida e logada (não propaga / sem unhandled rejection)
    expect(errorSpy).toHaveBeenCalledWith('Failed to publish CheckInPerformed to SNS', 'sns down');

    errorSpy.mockRestore();
  });
});
