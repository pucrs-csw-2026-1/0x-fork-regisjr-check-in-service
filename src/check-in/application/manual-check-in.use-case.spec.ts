import { ConflictException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { IEventPublisher } from '../domain/ports/event-publisher.port';
import { IRegistrationClient } from '../domain/ports/registration-client.port';
import { CheckInMethod } from '../domain/check-in.types';
import { ManualCheckInUseCase } from './manual-check-in.use-case';

const EVENT_ID = 'evt-1';
const USER_ID = 'user-xyz';
const STAFF_ID = 'staff-001';

describe('ManualCheckInUseCase', () => {
  let useCase: ManualCheckInUseCase;
  let repo: jest.Mocked<ICheckInRepository>;
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

    registrationClient = {
      validateRegistration: jest.fn().mockResolvedValue({ isRegistered: true, isConfirmed: true }),
    } as unknown as jest.Mocked<IRegistrationClient>;

    eventPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IEventPublisher>;

    const module = await Test.createTestingModule({
      providers: [
        ManualCheckInUseCase,
        { provide: IRegistrationClient, useValue: registrationClient },
        { provide: ICheckInRepository, useValue: repo },
        { provide: IEventPublisher, useValue: eventPublisher },
      ],
    }).compile();

    useCase = module.get(ManualCheckInUseCase);
  });

  it('saves a manual check-in with reason and correct fields', async () => {
    const result = await useCase.execute(EVENT_ID, USER_ID, STAFF_ID, 'QR reader broken');
    expect(result.method).toBe(CheckInMethod.Manual);
    expect(result.reason).toBe('QR reader broken');
    expect(result.tokenJti).toBeNull();
    expect(result.entityType).toBe('CheckIn');
  });

  it('saves a manual check-in without reason (optional)', async () => {
    const result = await useCase.execute(EVENT_ID, USER_ID, STAFF_ID);
    expect(result.reason).toBeNull();
  });

  it('throws ConflictException with existing record on duplicate (ADR-004)', async () => {
    const existing = {
      entityType: 'CheckIn' as const,
      checkInId: 'existing-id',
      eventId: EVENT_ID, userId: USER_ID,
      checkedInAt: '', method: CheckInMethod.Manual,
      scannedBy: STAFF_ID, reason: null, tokenJti: null, createdAt: '',
    };
    repo.findByEventAndUser.mockResolvedValue(existing);

    const err = await useCase.execute(EVENT_ID, USER_ID, STAFF_ID).catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ checkInId: 'existing-id' });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('validates registration before saving', async () => {
    await useCase.execute(EVENT_ID, USER_ID, STAFF_ID);
    expect(registrationClient.validateRegistration).toHaveBeenCalledWith(EVENT_ID, USER_ID, undefined);
  });

  it('publishes CheckInPerformed with the canonical envelope + reason', async () => {
    await useCase.execute(EVENT_ID, USER_ID, STAFF_ID, 'QR reader broken');
    // fire-and-forget — give microtask queue a tick
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'CheckInPerformed',
        source: 'checkin-events',
        version: '1.0',
        data: expect.objectContaining({
          event_id: EVENT_ID,
          attendant_id: USER_ID,
          method: CheckInMethod.Manual,
          scanned_by: STAFF_ID,
          reason: 'QR reader broken',
        }),
      }),
    );
  });

  it('não quebra a resposta ao cliente quando a publicação no SNS falha, apenas loga (US-08 critério 6)', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    eventPublisher.publish.mockRejectedValue(new Error('sns down'));

    const result = await useCase.execute(EVENT_ID, USER_ID, STAFF_ID, 'QR reader broken');
    // publishEvent é fire-and-forget (`void`) — deixa o catch rodar antes de assertar
    await new Promise((resolve) => setTimeout(resolve, 0));

    // resposta ao cliente não é afetada pela falha de publicação
    expect(result.method).toBe(CheckInMethod.Manual);
    expect(result.checkInId).toBeDefined();
    // a falha é engolida e logada (não propaga / sem unhandled rejection)
    expect(errorSpy).toHaveBeenCalledWith('Failed to publish CheckInPerformed to SNS', 'sns down');

    errorSpy.mockRestore();
  });
});
