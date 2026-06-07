import { Test } from '@nestjs/testing';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { CheckInMethod, CheckInRecord } from '../domain/check-in.types';
import { GetStatsUseCase } from './get-stats.use-case';

const EVENT_ID = 'evt-1';

const makeRecord = (method: CheckInMethod, userId: string): CheckInRecord => ({
  entityType: 'CheckIn',
  checkInId: `ci-${userId}`,
  eventId: EVENT_ID,
  userId,
  checkedInAt: '2026-06-07T00:00:00.000Z',
  method,
  scannedBy: 'staff-001',
  reason: method === CheckInMethod.Manual ? 'QR quebrado' : null,
  tokenJti: method === CheckInMethod.QrCode ? 'jti-1' : null,
  createdAt: '2026-06-07T00:00:00.000Z',
});

async function build(items: CheckInRecord[], qrAudits: number) {
  const repo: jest.Mocked<ICheckInRepository> = {
    listByEvent: jest.fn().mockResolvedValue({ items }),
    countQrAudits: jest.fn().mockResolvedValue(qrAudits),
    findByEventAndUser: jest.fn(),
    save: jest.fn(),
    saveQrAudit: jest.fn(),
  } as unknown as jest.Mocked<ICheckInRepository>;

  const module = await Test.createTestingModule({
    providers: [
      GetStatsUseCase,
      { provide: ICheckInRepository, useValue: repo },
    ],
  }).compile();

  return { useCase: module.get(GetStatsUseCase), repo };
}

describe('GetStatsUseCase', () => {
  it('retorna zeros para evento sem check-ins', async () => {
    const { useCase } = await build([], 0);

    const result = await useCase.execute(EVENT_ID);

    expect(result.totalCheckIns).toBe(0);
    expect(result.byMethod).toEqual({});
    expect(result.qrAudits).toBe(0);
    expect(result.eventId).toBe(EVENT_ID);
  });

  it('calcula totalCheckIns corretamente', async () => {
    const items = [
      makeRecord(CheckInMethod.QrCode, 'u1'),
      makeRecord(CheckInMethod.QrCode, 'u2'),
      makeRecord(CheckInMethod.Manual, 'u3'),
    ];
    const { useCase } = await build(items, 5);

    const result = await useCase.execute(EVENT_ID);

    expect(result.totalCheckIns).toBe(3);
  });

  it('agrupa byMethod corretamente (qr_code e manual)', async () => {
    const items = [
      makeRecord(CheckInMethod.QrCode, 'u1'),
      makeRecord(CheckInMethod.QrCode, 'u2'),
      makeRecord(CheckInMethod.QrCode, 'u3'),
      makeRecord(CheckInMethod.Manual, 'u4'),
    ];
    const { useCase } = await build(items, 10);

    const result = await useCase.execute(EVENT_ID);

    expect(result.byMethod[CheckInMethod.QrCode]).toBe(3);
    expect(result.byMethod[CheckInMethod.Manual]).toBe(1);
  });

  it('retorna qrAudits do repositório (inclui tokens não utilizados)', async () => {
    const items = [makeRecord(CheckInMethod.QrCode, 'u1')];
    const { useCase } = await build(items, 7);

    const result = await useCase.execute(EVENT_ID);

    expect(result.qrAudits).toBe(7);
  });

  it('busca até 1000 check-ins por evento', async () => {
    const { useCase, repo } = await build([], 0);

    await useCase.execute(EVENT_ID);

    expect(repo.listByEvent).toHaveBeenCalledWith(EVENT_ID, 1000);
  });

  it('qrAudits pode ser maior que totalCheckIns (tokens emitidos mas não usados)', async () => {
    const items = [makeRecord(CheckInMethod.QrCode, 'u1')];
    const { useCase } = await build(items, 15);

    const result = await useCase.execute(EVENT_ID);

    expect(result.qrAudits).toBeGreaterThan(result.totalCheckIns);
  });
});
