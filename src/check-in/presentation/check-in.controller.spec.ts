import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { TraceIdMiddleware } from '../../common/middleware/trace-id.middleware';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';

import { GenerateQrCodeUseCase } from '../application/generate-qr-code.use-case';
import { ScanQrCodeUseCase } from '../application/scan-qr-code.use-case';
import { ManualCheckInUseCase } from '../application/manual-check-in.use-case';
import { ListEventCheckInsUseCase } from '../application/list-event-check-ins.use-case';
import { GetUserCheckInUseCase } from '../application/get-user-check-in.use-case';
import { GetStatsUseCase } from '../application/get-stats.use-case';

import { CheckInController } from './check-in.controller';
import { CheckInMethod } from '../domain/check-in.types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const EVENT_ID = 'event-abc';
const USER_ID = 'keycloak-user-xyz';
const STAFF_ID = 'keycloak-staff-001';
const ORG_ID = 'keycloak-org-001';

const baseCheckIn = {
  entityType: 'CheckIn' as const,
  checkInId: 'ci-1',
  eventId: EVENT_ID,
  userId: USER_ID,
  checkedInAt: '2026-06-07T00:00:00.000Z',
  method: CheckInMethod.QrCode,
  scannedBy: STAFF_ID,
  reason: null,
  tokenJti: 'jti-1',
  createdAt: '2026-06-07T00:00:00.000Z',
};

// ─── Mock de usuário autenticado ─────────────────────────────────────────────

type MockUser = { userId: string; scopes: string[]; email?: string };

let currentUser: MockUser = { userId: USER_ID, scopes: ['participant'] };

const mockJwtGuard = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  },
};

// ─── Mocks de use cases ───────────────────────────────────────────────────────

const mockGenerateQrCode = { execute: jest.fn() };
const mockScanQrCode = { execute: jest.fn() };
const mockManualCheckIn = { execute: jest.fn() };
const mockListEventCheckIns = { execute: jest.fn() };
const mockGetUserCheckIn = { execute: jest.fn() };
const mockGetStats = { execute: jest.fn() };

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('CheckInController (HTTP edge cases)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] })],
      controllers: [CheckInController],
      providers: [
        { provide: GenerateQrCodeUseCase, useValue: mockGenerateQrCode },
        { provide: ScanQrCodeUseCase, useValue: mockScanQrCode },
        { provide: ManualCheckInUseCase, useValue: mockManualCheckIn },
        { provide: ListEventCheckInsUseCase, useValue: mockListEventCheckIns },
        { provide: GetUserCheckInUseCase, useValue: mockGetUserCheckIn },
        { provide: GetStatsUseCase, useValue: mockGetStats },
        RolesGuard,
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile();

    app = module.createNestApplication();
    app.use((req: any, res: any, next: any) => new TraceIdMiddleware().use(req, res, next));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = { userId: USER_ID, scopes: ['participant'] };
  });

  const asUser = (userId: string, roles: string[]) => {
    currentUser = { userId, scopes: roles };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SCOPE ERRORS — 403
  // ═══════════════════════════════════════════════════════════════════════════

  describe('RolesGuard — 403 por role insuficiente', () => {
    it('staff gera QR (requer user/admin)', async () => {
      asUser(STAFF_ID, ['participant','manager']);
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`);
      expect(res.status).toBe(403);
    });

    it('user lista check-ins (requer organizer/admin)', async () => {
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins`);
      expect(res.status).toBe(403);
    });

    it('user vê stats (requer organizer/admin)', async () => {
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins/stats`);
      expect(res.status).toBe(403);
    });

    it('user vê check-in de outro (403 granular no controller)', async () => {
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins/outro-keycloak-id`);
      expect(res.status).toBe(403);
    });

    it('user faz scan (requer staff/organizer/admin)', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan').send({ token: 't', eventId: 'e', scannedBy: 'u' });
      expect(res.status).toBe(403);
    });

    it('user faz manual (requer staff/organizer/admin)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).send({ userId: 'u', performedBy: 'u' });
      expect(res.status).toBe(403);
    });

    it('participant não vê stats (requer manager/admin)', async () => {
      asUser(USER_ID, ['participant']);
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins/stats`);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDAÇÃO DTO — 400
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validação DTO — 400', () => {
    beforeEach(() => asUser(STAFF_ID, ['participant','manager']));

    it('scan sem token', async () => {
      const res = await request(app.getHttpServer()).post('/check-ins/scan').send({ eventId: 'e', scannedBy: 's' });
      expect(res.status).toBe(400);
    });

    it('scan sem eventId', async () => {
      const res = await request(app.getHttpServer()).post('/check-ins/scan').send({ token: 't', scannedBy: 's' });
      expect(res.status).toBe(400);
    });

    it('scan body vazio', async () => {
      const res = await request(app.getHttpServer()).post('/check-ins/scan').send({});
      expect(res.status).toBe(400);
    });

    it('scan token como número (deve ser string)', async () => {
      const res = await request(app.getHttpServer()).post('/check-ins/scan').send({ token: 99, eventId: 'e', scannedBy: 's' });
      expect(res.status).toBe(400);
    });

    it('manual sem userId', async () => {
      const res = await request(app.getHttpServer()).post(`/events/${EVENT_ID}/check-ins/manual`).send({ performedBy: 's' });
      expect(res.status).toBe(400);
    });

    it('manual sem performedBy', async () => {
      const res = await request(app.getHttpServer()).post(`/events/${EVENT_ID}/check-ins/manual`).send({ userId: 'u' });
      expect(res.status).toBe(400);
    });

    it('campos extras são stripados (whitelist)', async () => {
      mockScanQrCode.execute.mockResolvedValue(baseCheckIn);
      await request(app.getHttpServer()).post('/check-ins/scan').send({ token: 't', eventId: 'e', scannedBy: 's', malicious: 'x' });
      const args = mockScanQrCode.execute.mock.calls[0];
      expect(args).not.toContain('malicious');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // QR CODE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/guests/:userId/qr-code', () => {
    it('200 — user gera próprio QR (userId === userId)', async () => {
      mockGenerateQrCode.execute.mockResolvedValue({ token: 'tok', qrPayload: 'checkin://tok', expiresAt: '' });
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`);
      expect(res.status).toBe(200);
    });

    it('403 — user gera QR de outro (userId !== userId, não é admin)', async () => {
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/guests/outro-id/qr-code`);
      expect(res.status).toBe(403);
      expect(mockGenerateQrCode.execute).not.toHaveBeenCalled();
    });

    it('200 — admin gera QR para qualquer userId', async () => {
      asUser('admin-001', ['participant','manager','admin']);
      mockGenerateQrCode.execute.mockResolvedValue({ token: 't', qrPayload: 'c://t', expiresAt: '' });
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/guests/qualquer-user/qr-code`);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCAN
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /check-ins/scan', () => {
    beforeEach(() => asUser(STAFF_ID, ['participant','manager']));

    it('201 — scan bem-sucedido', async () => {
      mockScanQrCode.execute.mockResolvedValue(baseCheckIn);
      const res = await request(app.getHttpServer()).post('/check-ins/scan').send({ token: 'tok', eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(res.status).toBe(201);
      expect(res.body.checkInId).toBe('ci-1');
    });

    it('usa userId como scannedBy (não o campo do body)', async () => {
      mockScanQrCode.execute.mockResolvedValue(baseCheckIn);
      await request(app.getHttpServer()).post('/check-ins/scan').send({ token: 'tok', eventId: EVENT_ID, scannedBy: 'body-value' });
      expect(mockScanQrCode.execute).toHaveBeenCalledWith('tok', EVENT_ID, STAFF_ID);
    });

    it('409 — duplicata retorna registro existente (ADR-004)', async () => {
      const { ConflictException } = await import('@nestjs/common');
      mockScanQrCode.execute.mockRejectedValue(new ConflictException(baseCheckIn));
      const res = await request(app.getHttpServer()).post('/check-ins/scan').send({ token: 'tok', eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(res.status).toBe(409);
      expect(res.body.checkInId).toBe('ci-1');
      expect(res.body).not.toHaveProperty('detail');
    });

    it('401 — QR JWT inválido', async () => {
      const { UnauthorizedException } = await import('@nestjs/common');
      mockScanQrCode.execute.mockRejectedValue(new UnauthorizedException('Invalid QR code'));
      const res = await request(app.getHttpServer()).post('/check-ins/scan').send({ token: 'bad', eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins', () => {
    beforeEach(() => asUser(ORG_ID, ['participant','manager']));

    it('200 — lista com paginação padrão', async () => {
      mockListEventCheckIns.execute.mockResolvedValue({ data: [baseCheckIn], total: 1, page: 1, limit: 20 });
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('page e limit são encaminhados corretamente', async () => {
      mockListEventCheckIns.execute.mockResolvedValue({ data: [], total: 0, page: 2, limit: 5 });
      await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins?page=2&limit=5`);
      expect(mockListEventCheckIns.execute).toHaveBeenCalledWith(EVENT_ID, 2, 5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET USER CHECK-IN
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins/:userId', () => {
    it('200 — user consulta próprio check-in', async () => {
      mockGetUserCheckIn.execute.mockResolvedValue(baseCheckIn);
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins/${USER_ID}`);
      expect(res.status).toBe(200);
    });

    it('200 — organizer consulta check-in de qualquer user', async () => {
      asUser(ORG_ID, ['participant','manager']);
      mockGetUserCheckIn.execute.mockResolvedValue(baseCheckIn);
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins/${USER_ID}`);
      expect(res.status).toBe(200);
    });

    it('404 — check-in não encontrado', async () => {
      asUser(ORG_ID, ['participant','manager']);
      const { NotFoundException } = await import('@nestjs/common');
      mockGetUserCheckIn.execute.mockRejectedValue(new NotFoundException('Check-in not found'));
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins/${USER_ID}`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('detail');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MANUAL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /events/:eventId/check-ins/manual', () => {
    beforeEach(() => asUser(STAFF_ID, ['participant','manager']));

    it('201 — manual com reason', async () => {
      const rec = { ...baseCheckIn, method: CheckInMethod.Manual, reason: 'QR quebrado', tokenJti: null };
      mockManualCheckIn.execute.mockResolvedValue(rec);
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).send({ userId: USER_ID, performedBy: STAFF_ID, reason: 'QR quebrado' });
      expect(res.status).toBe(201);
      expect(res.body.reason).toBe('QR quebrado');
    });

    it('usa userId como performedBy', async () => {
      mockManualCheckIn.execute.mockResolvedValue(baseCheckIn);
      await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).send({ userId: USER_ID, performedBy: 'body-value' });
      expect(mockManualCheckIn.execute).toHaveBeenCalledWith(EVENT_ID, USER_ID, STAFF_ID, undefined);
    });

    it('409 — duplicata retorna registro', async () => {
      const { ConflictException } = await import('@nestjs/common');
      mockManualCheckIn.execute.mockRejectedValue(new ConflictException(baseCheckIn));
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).send({ userId: USER_ID, performedBy: STAFF_ID });
      expect(res.status).toBe(409);
      expect(res.body.checkInId).toBe('ci-1');
    });

    it('422 — participante não inscrito', async () => {
      const { UnprocessableEntityException } = await import('@nestjs/common');
      mockManualCheckIn.execute.mockRejectedValue(new UnprocessableEntityException('not confirmed'));
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).send({ userId: USER_ID, performedBy: STAFF_ID });
      expect(res.status).toBe(422);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins/stats', () => {
    it('200 — retorna breakdown por role organizer', async () => {
      asUser(ORG_ID, ['participant','manager']);
      mockGetStats.execute.mockResolvedValue({ eventId: EVENT_ID, totalCheckIns: 10, byMethod: { qr_code: 8, manual: 2 }, qrAudits: 12 });
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins/stats`);
      expect(res.status).toBe(200);
      expect(res.body.byMethod.qr_code).toBe(8);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMATO DA RESPOSTA (ADR-008)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Formato da resposta (ADR-008)', () => {
    it('erros usam campo "detail" (não "message")', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      asUser(ORG_ID, ['participant','manager']);
      mockGetUserCheckIn.execute.mockRejectedValue(new NotFoundException('not found'));
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/check-ins/${USER_ID}`);
      expect(res.body).toHaveProperty('detail');
      expect(res.body).not.toHaveProperty('message');
    });

    it('x-trace-id é ecoado no response', async () => {
      asUser(ORG_ID, ['participant','manager']);
      mockGetStats.execute.mockResolvedValue({ eventId: EVENT_ID, totalCheckIns: 0, byMethod: {}, qrAudits: 0 });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/stats`).set('x-trace-id', 'trace-keycloak-42');
      expect(res.headers['x-trace-id']).toBe('trace-keycloak-42');
    });

    it('404 — rota inexistente', async () => {
      asUser('admin-001', ['participant','manager','admin']);
      const res = await request(app.getHttpServer()).get('/nao-existe');
      expect(res.status).toBe(404);
    });
  });
});
