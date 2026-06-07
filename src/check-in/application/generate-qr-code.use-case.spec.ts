import { Test } from '@nestjs/testing';

import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { IQrCodeTokenService } from '../domain/ports/qr-code-token-service.port';
import { IRegistrationClient } from '../domain/ports/registration-client.port';
import { GenerateQrCodeUseCase } from './generate-qr-code.use-case';

const EVENT_ID = 'evt-1';
const USER_ID = 'user-xyz';

const issued = {
  token: 'tok',
  payload: 'checkin://tok',
  expiresAt: '2026-06-07T14:05:00.000Z',
  jti: 'jti-fresh',
};

describe('GenerateQrCodeUseCase', () => {
  let useCase: GenerateQrCodeUseCase;
  let registrationClient: jest.Mocked<IRegistrationClient>;
  let qrService: jest.Mocked<IQrCodeTokenService>;
  let repo: jest.Mocked<ICheckInRepository>;

  beforeEach(async () => {
    registrationClient = {
      validateRegistration: jest.fn().mockResolvedValue({ isRegistered: true, isConfirmed: true }),
    } as unknown as jest.Mocked<IRegistrationClient>;

    qrService = {
      issue: jest.fn().mockResolvedValue(issued),
      verify: jest.fn(),
    } as unknown as jest.Mocked<IQrCodeTokenService>;

    repo = {
      save: jest.fn(),
      findByEventAndUser: jest.fn(),
      listByEvent: jest.fn(),
      saveQrAudit: jest.fn().mockResolvedValue(undefined),
      countQrAudits: jest.fn(),
    } as unknown as jest.Mocked<ICheckInRepository>;

    const module = await Test.createTestingModule({
      providers: [
        GenerateQrCodeUseCase,
        { provide: IRegistrationClient, useValue: registrationClient },
        { provide: IQrCodeTokenService, useValue: qrService },
        { provide: ICheckInRepository, useValue: repo },
      ],
    }).compile();

    useCase = module.get(GenerateQrCodeUseCase);
  });

  it('validates registration before issuing token', async () => {
    await useCase.execute(EVENT_ID, USER_ID);
    expect(registrationClient.validateRegistration).toHaveBeenCalledWith(EVENT_ID, USER_ID);
  });

  it('returns token, qrPayload and expiresAt', async () => {
    const result = await useCase.execute(EVENT_ID, USER_ID);
    expect(result).toEqual({ token: 'tok', qrPayload: 'checkin://tok', expiresAt: issued.expiresAt });
  });

  it('saves QR audit record with entityType and jti', async () => {
    await useCase.execute(EVENT_ID, USER_ID);
    expect(repo.saveQrAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'QrCodeAudit',
      eventId: EVENT_ID,
      userId: USER_ID,
      tokenJti: 'jti-fresh',
    }));
  });

  it('propagates exception when registration is not confirmed', async () => {
    const { UnprocessableEntityException } = await import('@nestjs/common');
    registrationClient.validateRegistration.mockRejectedValue(new UnprocessableEntityException('not confirmed'));
    await expect(useCase.execute(EVENT_ID, USER_ID)).rejects.toThrow(UnprocessableEntityException);
    expect(qrService.issue).not.toHaveBeenCalled();
  });
});
