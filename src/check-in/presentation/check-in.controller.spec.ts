import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ScopesGuard } from '../../auth/scopes.guard';
import { SecretsManagerService } from '../../secrets/secrets-manager.service';
import { TraceIdMiddleware } from '../../common/middleware/trace-id.middleware';
import { CheckInMethod } from '../domain/check-in.types';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';

import { GenerateQrCodeUseCase } from '../application/generate-qr-code.use-case';
import { ScanQrCodeUseCase } from '../application/scan-qr-code.use-case';
import { ManualCheckInUseCase } from '../application/manual-check-in.use-case';
import { ListEventCheckInsUseCase } from '../application/list-event-check-ins.use-case';
import { GetUserCheckInUseCase } from '../application/get-user-check-in.use-case';
import { GetStatsUseCase } from '../application/get-stats.use-case';

import { CheckInController } from './check-in.controller';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AUTH_SECRET = 'test-auth-secret';
const EVENT_ID = 'event-abc';
const USER_ID = 'user-xyz';
const STAFF_ID = 'staff-001';
const ORG_ID = 'org-001';

function makeToken(sub: string, scopes: string[], opts: jwt.SignOptions = {}): string {
  return jwt.sign({ sub, scopes }, AUTH_SECRET, { algorithm: 'HS256', expiresIn: 300, ...opts });
}

const userToken = () => makeToken(USER_ID, ['user']);
const staffToken = () => makeToken(STAFF_ID, ['staff']);
const orgToken = () => makeToken(ORG_ID, ['organizer']);
const adminToken = () => makeToken('admin-001', ['admin']);

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
        { provide: SecretsManagerService, useValue: { getSecret: jest.fn().mockResolvedValue(AUTH_SECRET), refreshSecret: jest.fn().mockResolvedValue('') } },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => k === 'authJwtSecretId' ? 'id' : k === 'authJwtSecret' ? AUTH_SECRET : undefined) } },
        JwtAuthGuard,
        ScopesGuard,
        Reflector,
      ],
    }).compile();

    app = module.createNestApplication();
    app.use((req: any, res: any, next: any) => new TraceIdMiddleware().use(req, res, next));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH (401)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Auth guard edge cases', () => {
    it('401 — sem Authorization', async () => {
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('detail');
    });

    it('401 — sem prefixo Bearer', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', userToken());
      expect(res.status).toBe(401);
    });

    it('401 — token expirado', async () => {
      const expired = makeToken(USER_ID, ['user'], { expiresIn: -1 });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
      expect(res.body.detail).toMatch(/expired/i);
    });

    it('401 — secret errado', async () => {
      const wrong = jwt.sign({ sub: USER_ID, scopes: ['user'] }, 'errado', { algorithm: 'HS256' });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', `Bearer ${wrong}`);
      expect(res.status).toBe(401);
    });

    it('401 — JWT malformado', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', 'Bearer not.a.valid.jwt');
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCOPE (403)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scope guard edge cases', () => {
    it('403 — staff gera QR (requer user/admin)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', `Bearer ${staffToken()}`);
      expect(res.status).toBe(403);
    });

    it('403 — user faz scan (requer staff/org/admin)', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan').set('Authorization', `Bearer ${userToken()}`)
        .send({ token: 't', eventId: 'e', scannedBy: 'u' });
      expect(res.status).toBe(403);
    });

    it('403 — user lista check-ins (requer org/admin)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins`).set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it('403 — user vê check-in de outro', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/outro`).set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it('403 — user faz manual (requer staff/org/admin)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).set('Authorization', `Bearer ${userToken()}`)
        .send({ userId: 'u', performedBy: 'u' });
      expect(res.status).toBe(403);
    });

    it('403 — user vê stats (requer org/admin)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/stats`).set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // QR CODE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/guests/:userId/qr-code', () => {
    it('200 — user gera próprio QR', async () => {
      mockGenerateQrCode.execute.mockResolvedValue({ token: 'tok', qrPayload: 'checkin://tok', expiresAt: '' });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`).set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(200);
    });

    it('403 — user gera QR de outro', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/outro/qr-code`).set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
      expect(mockGenerateQrCode.execute).not.toHaveBeenCalled();
    });

    it('200 — admin gera QR para qualquer user', async () => {
      mockGenerateQrCode.execute.mockResolvedValue({ token: 't', qrPayload: 'c://t', expiresAt: '' });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/outro/qr-code`).set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCAN
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /check-ins/scan', () => {
    it('201 — scan bem-sucedido', async () => {
      mockScanQrCode.execute.mockResolvedValue(baseCheckIn);
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan').set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 'tok', eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(res.status).toBe(201);
    });

    it('409 — scan duplicado retorna registro existente (ADR-004)', async () => {
      const { ConflictException } = await import('@nestjs/common');
      mockScanQrCode.execute.mockRejectedValue(new ConflictException(baseCheckIn));
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan').set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 'tok', eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(res.status).toBe(409);
      expect(res.body.checkInId).toBe('ci-1');
      expect(res.body).not.toHaveProperty('detail');
    });

    it('400 — body sem token', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan').set('Authorization', `Bearer ${staffToken()}`)
        .send({ eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(res.status).toBe(400);
    });

    it('400 — body sem eventId', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan').set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 'tok', scannedBy: STAFF_ID });
      expect(res.status).toBe(400);
    });

    it('400 — body vazio', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan').set('Authorization', `Bearer ${staffToken()}`).send({});
      expect(res.status).toBe(400);
    });

    it('campos extras são stripados (whitelist)', async () => {
      mockScanQrCode.execute.mockResolvedValue(baseCheckIn);
      await request(app.getHttpServer())
        .post('/check-ins/scan').set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 'tok', eventId: EVENT_ID, scannedBy: STAFF_ID, malicious: 'x' });
      const arg = mockScanQrCode.execute.mock.calls[0];
      expect(arg).not.toContain('malicious');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins', () => {
    it('200 — paginação padrão', async () => {
      mockListEventCheckIns.execute.mockResolvedValue({ data: [baseCheckIn], total: 1, page: 1, limit: 20 });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins`).set('Authorization', `Bearer ${orgToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('200 — page=2&limit=5 encaminha parâmetros corretos', async () => {
      mockListEventCheckIns.execute.mockResolvedValue({ data: [], total: 10, page: 2, limit: 5 });
      await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins?page=2&limit=5`).set('Authorization', `Bearer ${orgToken()}`);
      expect(mockListEventCheckIns.execute).toHaveBeenCalledWith(EVENT_ID, 2, 5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET USER CHECK-IN
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins/:userId', () => {
    it('200 — user consulta próprio', async () => {
      mockGetUserCheckIn.execute.mockResolvedValue(baseCheckIn);
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/${USER_ID}`).set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(200);
    });

    it('404 — não encontrado', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockGetUserCheckIn.execute.mockRejectedValue(new NotFoundException('Check-in not found'));
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/${USER_ID}`).set('Authorization', `Bearer ${orgToken()}`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('detail');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MANUAL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /events/:eventId/check-ins/manual', () => {
    it('201 — com reason', async () => {
      mockManualCheckIn.execute.mockResolvedValue({ ...baseCheckIn, method: CheckInMethod.Manual, reason: 'QR quebrado' });
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).set('Authorization', `Bearer ${staffToken()}`)
        .send({ userId: USER_ID, performedBy: STAFF_ID, reason: 'QR quebrado' });
      expect(res.status).toBe(201);
      expect(res.body.reason).toBe('QR quebrado');
    });

    it('409 — duplicata retorna registro existente', async () => {
      const { ConflictException } = await import('@nestjs/common');
      mockManualCheckIn.execute.mockRejectedValue(new ConflictException(baseCheckIn));
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).set('Authorization', `Bearer ${staffToken()}`)
        .send({ userId: USER_ID, performedBy: STAFF_ID });
      expect(res.status).toBe(409);
      expect(res.body.checkInId).toBe('ci-1');
    });

    it('400 — sem userId', async () => {
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).set('Authorization', `Bearer ${staffToken()}`)
        .send({ performedBy: STAFF_ID });
      expect(res.status).toBe(400);
    });

    it('422 — participante não inscrito', async () => {
      const { UnprocessableEntityException } = await import('@nestjs/common');
      mockManualCheckIn.execute.mockRejectedValue(new UnprocessableEntityException('not confirmed'));
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`).set('Authorization', `Bearer ${staffToken()}`)
        .send({ userId: USER_ID, performedBy: STAFF_ID });
      expect(res.status).toBe(422);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins/stats', () => {
    it('200 — retorna breakdown por método', async () => {
      mockGetStats.execute.mockResolvedValue({ eventId: EVENT_ID, totalCheckIns: 10, byMethod: { qr_code: 8, manual: 2 }, qrAudits: 12 });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/stats`).set('Authorization', `Bearer ${orgToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.byMethod.qr_code).toBe(8);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSE FORMAT (ADR-008: campo "detail")
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Response format (ADR-008)', () => {
    it('erros usam campo "detail" e não "message"', async () => {
      const res = await request(app.getHttpServer()).get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('detail');
      expect(res.body).not.toHaveProperty('message');
    });

    it('x-trace-id é ecoado no response', async () => {
      mockGetStats.execute.mockResolvedValue({ eventId: EVENT_ID, totalCheckIns: 0, byMethod: {}, qrAudits: 0 });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/stats`).set('Authorization', `Bearer ${orgToken()}`)
        .set('x-trace-id', 'trace-42');
      expect(res.headers['x-trace-id']).toBe('trace-42');
    });

    it('404 rota inexistente', async () => {
      const res = await request(app.getHttpServer()).get('/nao-existe').set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(404);
    });
  });
});
