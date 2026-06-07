import { Test } from '@nestjs/testing';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { CheckInMethod, CheckInRecord } from '../domain/check-in.types';
import { ListEventCheckInsUseCase } from './list-event-check-ins.use-case';

const EVENT_ID = 'evt-1';

const makeRecord = (userId: string): CheckInRecord => ({
  entityType: 'CheckIn',
  checkInId: `ci-${userId}`,
  eventId: EVENT_ID,
  userId,
  checkedInAt: '2026-06-07T00:00:00.000Z',
  method: CheckInMethod.QrCode,
  scannedBy: 'staff-001',
  reason: null,
  tokenJti: 'jti-1',
  createdAt: '2026-06-07T00:00:00.000Z',
});

const makeRepo = (items: CheckInRecord[]): jest.Mocked<ICheckInRepository> =>
  ({
    listByEvent: jest.fn().mockResolvedValue({ items }),
    findByEventAndUser: jest.fn(),
    save: jest.fn(),
    saveQrAudit: jest.fn(),
    countQrAudits: jest.fn(),
  } as unknown as jest.Mocked<ICheckInRepository>);

async function build(repo: ICheckInRepository) {
  const module = await Test.createTestingModule({
    providers: [
      ListEventCheckInsUseCase,
      { provide: ICheckInRepository, useValue: repo },
    ],
  }).compile();
  return module.get(ListEventCheckInsUseCase);
}

describe('ListEventCheckInsUseCase', () => {
  it('retorna lista completa com paginação padrão (page=1, limit=20)', async () => {
    const records = Array.from({ length: 5 }, (_, i) => makeRecord(`user-${i}`));
    const useCase = await build(makeRepo(records));

    const result = await useCase.execute(EVENT_ID);

    expect(result.data).toHaveLength(5);
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('pagina corretamente: page=2, limit=2 retorna itens 3 e 4', async () => {
    const records = Array.from({ length: 5 }, (_, i) => makeRecord(`user-${i}`));
    const useCase = await build(makeRepo(records));

    const result = await useCase.execute(EVENT_ID, 2, 2);

    expect(result.data).toHaveLength(2);
    expect(result.data[0].userId).toBe('user-2');
    expect(result.data[1].userId).toBe('user-3');
    expect(result.page).toBe(2);
    expect(result.limit).toBe(2);
  });

  it('retorna lista vazia quando não há check-ins no evento', async () => {
    const useCase = await build(makeRepo([]));

    const result = await useCase.execute(EVENT_ID);

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('page além do total retorna lista vazia (sem erro)', async () => {
    const records = Array.from({ length: 3 }, (_, i) => makeRecord(`user-${i}`));
    const useCase = await build(makeRepo(records));

    const result = await useCase.execute(EVENT_ID, 10, 20);

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(3);
  });

  it('passa limit * page ao repositório para buscar itens suficientes', async () => {
    const repo = makeRepo([]);
    const useCase = await build(repo);

    await useCase.execute(EVENT_ID, 3, 10);

    expect(repo.listByEvent).toHaveBeenCalledWith(EVENT_ID, 30);
  });
});
