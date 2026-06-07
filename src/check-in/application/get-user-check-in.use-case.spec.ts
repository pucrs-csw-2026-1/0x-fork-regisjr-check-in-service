import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { CheckInMethod, CheckInRecord } from '../domain/check-in.types';
import { GetUserCheckInUseCase } from './get-user-check-in.use-case';

const EVENT_ID = 'evt-1';
const USER_ID = 'user-xyz';

const existingRecord: CheckInRecord = {
  entityType: 'CheckIn',
  checkInId: 'ci-abc',
  eventId: EVENT_ID,
  userId: USER_ID,
  checkedInAt: '2026-06-07T00:00:00.000Z',
  method: CheckInMethod.QrCode,
  scannedBy: 'staff-001',
  reason: null,
  tokenJti: 'jti-1',
  createdAt: '2026-06-07T00:00:00.000Z',
};

async function build(findResult: CheckInRecord | undefined) {
  const repo: jest.Mocked<ICheckInRepository> = {
    findByEventAndUser: jest.fn().mockResolvedValue(findResult),
    save: jest.fn(),
    listByEvent: jest.fn(),
    saveQrAudit: jest.fn(),
    countQrAudits: jest.fn(),
  } as unknown as jest.Mocked<ICheckInRepository>;

  const module = await Test.createTestingModule({
    providers: [
      GetUserCheckInUseCase,
      { provide: ICheckInRepository, useValue: repo },
    ],
  }).compile();

  return { useCase: module.get(GetUserCheckInUseCase), repo };
}

describe('GetUserCheckInUseCase', () => {
  it('retorna o check-in quando encontrado', async () => {
    const { useCase } = await build(existingRecord);

    const result = await useCase.execute(EVENT_ID, USER_ID);

    expect(result.checkInId).toBe('ci-abc');
    expect(result.userId).toBe(USER_ID);
  });

  it('lança NotFoundException quando check-in não existe', async () => {
    const { useCase } = await build(undefined);

    await expect(useCase.execute(EVENT_ID, USER_ID)).rejects.toThrow(NotFoundException);
  });

  it('consulta o repositório com os IDs corretos', async () => {
    const { useCase, repo } = await build(existingRecord);

    await useCase.execute(EVENT_ID, USER_ID);

    expect(repo.findByEventAndUser).toHaveBeenCalledWith(EVENT_ID, USER_ID);
  });

  it('mantém todos os campos do registro original', async () => {
    const { useCase } = await build(existingRecord);

    const result = await useCase.execute(EVENT_ID, USER_ID);

    expect(result).toMatchObject({
      entityType: 'CheckIn',
      method: CheckInMethod.QrCode,
      tokenJti: 'jti-1',
      reason: null,
    });
  });
});
