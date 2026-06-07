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
import { CheckInService } from '../check-in.service';
import { CheckInMethod } from '../domain/check-in.types';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { CheckInController } from './check-in.controller';

// ─── Secrets usados nos testes ────────────────────────────────────────────────

const AUTH_SECRET = 'test-auth-secret';

// ─── Helpers para gerar tokens ────────────────────────────────────────────────

function makeToken(sub: string, scopes: string[], opts: jwt.SignOptions = {}): string {
  return jwt.sign({ sub, scopes }, AUTH_SECRET, { algorithm: 'HS256', expiresIn: 300, ...opts });
}

const userToken = () => makeToken(USER_ID, ['user']);
const staffToken = () => makeToken(STAFF_ID, ['staff']);
const orgToken = () => makeToken(ORG_ID, ['organizer']);
const adminToken = () => makeToken('admin-001', ['admin']);

const EVENT_ID = 'event-abc';
const USER_ID = 'user-xyz';
const STAFF_ID = 'staff-001';
const ORG_ID = 'org-001';

// ─── Fixture de check-in retornado pelo serviço ───────────────────────────────

const baseCheckIn = {
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

// ─── Mock do CheckInService ───────────────────────────────────────────────────

const mockCheckInService = {
  generateQrCode: jest.fn(),
  scan: jest.fn(),
  listEventCheckIns: jest.fn(),
  getUserCheckIn: jest.fn(),
  manualCheckIn: jest.fn(),
  getStats: jest.fn(),
};

// ─── Setup da aplicação ───────────────────────────────────────────────────────

describe('CheckInController (HTTP edge cases)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mockSecretsManager = {
      getSecret: jest.fn().mockResolvedValue(AUTH_SECRET),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, unknown> = {
          authJwtSecretId: 'auth-secret-id',
          authJwtSecret: AUTH_SECRET,
          qrJwtSecretId: 'qr-secret-id',
          qrJwtSecret: 'test-qr-secret',
          qrJwtTtlSeconds: 300,
        };
        return config[key];
      }),
    };

    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
      ],
      controllers: [CheckInController],
      providers: [
        { provide: CheckInService, useValue: mockCheckInService },
        { provide: SecretsManagerService, useValue: mockSecretsManager },
        { provide: ConfigService, useValue: mockConfigService },
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

  beforeEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH — edge cases de token
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Auth guard edge cases', () => {
    it('401 — sem header Authorization', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`);
      expect(res.status).toBe(401);
    });

    it('401 — header sem prefixo Bearer', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', userToken());
      expect(res.status).toBe(401);
    });

    it('401 — token expirado', async () => {
      const expiredToken = makeToken(USER_ID, ['user'], { expiresIn: -1 });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('401 — token assinado com secret errado', async () => {
      const wrongToken = jwt.sign({ sub: USER_ID, scopes: ['user'] }, 'wrong-secret', { algorithm: 'HS256' });
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', `Bearer ${wrongToken}`);
      expect(res.status).toBe(401);
    });

    it('401 — token malformado (string aleatória)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', 'Bearer not.a.valid.jwt');
      expect(res.status).toBe(401);
    });

    it('401 — Bearer com token vazio', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', 'Bearer ');
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCOPE guard — acesso negado por escopo insuficiente
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scope guard edge cases', () => {
    it('403 — staff tenta gerar QR (requer user ou admin)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', `Bearer ${staffToken()}`);
      expect(res.status).toBe(403);
    });

    it('403 — user tenta escanear QR (requer staff/organizer/admin)', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({ token: 'any', eventId: EVENT_ID, scannedBy: USER_ID });
      expect(res.status).toBe(403);
    });

    it('403 — user tenta listar check-ins do evento (requer organizer/admin)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins`)
        .set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it('403 — user tenta ver check-in de outro usuário', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/outro-usuario`)
        .set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it('403 — user tenta check-in manual (requer staff/organizer/admin)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${userToken()}`)
        .send({ userId: USER_ID, performedBy: USER_ID });
      expect(res.status).toBe(403);
    });

    it('403 — user tenta ver estatísticas (requer organizer/admin)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/stats`)
        .set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it('403 — staff tenta ver estatísticas (requer organizer/admin)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/stats`)
        .set('Authorization', `Bearer ${staffToken()}`);
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // QR CODE — geração
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/guests/:userId/qr-code', () => {
    const qrResponse = {
      token: 'tok-123',
      qrPayload: 'checkin://tok-123',
      expiresAt: '2026-06-07T00:05:00.000Z',
    };

    it('200 — user gera seu próprio QR', async () => {
      mockCheckInService.generateQrCode.mockResolvedValue(qrResponse);

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`)
        .set('Authorization', `Bearer ${userToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ token: 'tok-123', qrPayload: expect.stringContaining('checkin://') });
    });

    it('200 — admin gera QR para qualquer usuário', async () => {
      mockCheckInService.generateQrCode.mockResolvedValue(qrResponse);

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/outro-usuario/qr-code`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
    });

    it('403 — user tenta gerar QR para outro usuário', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/outro-usuario/qr-code`)
        .set('Authorization', `Bearer ${userToken()}`);

      expect(res.status).toBe(403);
      expect(mockCheckInService.generateQrCode).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCAN — validação de body e edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /check-ins/scan', () => {
    it('201 — scan bem-sucedido', async () => {
      mockCheckInService.scan.mockResolvedValue(baseCheckIn);

      const res = await request(app.getHttpServer())
        .post('/check-ins/scan')
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 'valid-tok', eventId: EVENT_ID, scannedBy: STAFF_ID });

      expect(res.status).toBe(201);
      expect(res.body.checkInId).toBe('ci-1');
    });

    it('201 — scan duplicado retorna mesmo check-in (idempotência)', async () => {
      mockCheckInService.scan.mockResolvedValue(baseCheckIn);

      for (let i = 0; i < 2; i++) {
        const res = await request(app.getHttpServer())
          .post('/check-ins/scan')
          .set('Authorization', `Bearer ${staffToken()}`)
          .send({ token: 'valid-tok', eventId: EVENT_ID, scannedBy: STAFF_ID });
        expect(res.status).toBe(201);
        expect(res.body.checkInId).toBe('ci-1');
      }
    });

    it('400 — body sem campo token', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan')
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(res.status).toBe(400);
    });

    it('400 — body sem campo eventId', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan')
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 'tok', scannedBy: STAFF_ID });
      expect(res.status).toBe(400);
    });

    it('400 — body completamente vazio', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan')
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('400 — campo token com tipo errado (número)', async () => {
      const res = await request(app.getHttpServer())
        .post('/check-ins/scan')
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 12345, eventId: EVENT_ID, scannedBy: STAFF_ID });
      expect(res.status).toBe(400);
    });

    it('campos extras no body são removidos (whitelist)', async () => {
      mockCheckInService.scan.mockResolvedValue(baseCheckIn);

      await request(app.getHttpServer())
        .post('/check-ins/scan')
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 'tok', eventId: EVENT_ID, scannedBy: STAFF_ID, campoMalicioso: 'injeção' });

      const callArg = mockCheckInService.scan.mock.calls[0]?.[0];
      expect(callArg).not.toHaveProperty('campoMalicioso');
    });

    it('422 — QR token expirado (service lança UnprocessableEntityException)', async () => {
      const { UnprocessableEntityException } = await import('@nestjs/common');
      mockCheckInService.scan.mockRejectedValue(
        new UnprocessableEntityException('Token expired or invalid'),
      );

      const res = await request(app.getHttpServer())
        .post('/check-ins/scan')
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ token: 'expired-tok', eventId: EVENT_ID, scannedBy: STAFF_ID });

      expect(res.status).toBe(422);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST CHECK-INS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins', () => {
    it('200 — lista com paginação padrão', async () => {
      mockCheckInService.listEventCheckIns.mockResolvedValue({ data: [baseCheckIn], total: 1, page: 1, limit: 20 });

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins`)
        .set('Authorization', `Bearer ${orgToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('200 — lista vazia para evento sem check-ins', async () => {
      mockCheckInService.listEventCheckIns.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

      const res = await request(app.getHttpServer())
        .get('/events/evento-sem-checkins/check-ins')
        .set('Authorization', `Bearer ${orgToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('200 — paginação customizada (page=2&limit=5)', async () => {
      mockCheckInService.listEventCheckIns.mockResolvedValue({ data: [], total: 10, page: 2, limit: 5 });

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins?page=2&limit=5`)
        .set('Authorization', `Bearer ${orgToken()}`);

      expect(res.status).toBe(200);
      expect(mockCheckInService.listEventCheckIns).toHaveBeenCalledWith(EVENT_ID, 2, 5);
    });

    it('200 — admin também pode listar check-ins', async () => {
      mockCheckInService.listEventCheckIns.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET CHECK-IN DE USUÁRIO ESPECÍFICO
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins/:userId', () => {
    it('200 — user consulta seu próprio check-in', async () => {
      mockCheckInService.getUserCheckIn.mockResolvedValue(baseCheckIn);

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/${USER_ID}`)
        .set('Authorization', `Bearer ${userToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(USER_ID);
    });

    it('200 — organizer consulta check-in de qualquer usuário', async () => {
      mockCheckInService.getUserCheckIn.mockResolvedValue(baseCheckIn);

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/${USER_ID}`)
        .set('Authorization', `Bearer ${orgToken()}`);

      expect(res.status).toBe(200);
    });

    it('200 — admin consulta check-in de qualquer usuário', async () => {
      mockCheckInService.getUserCheckIn.mockResolvedValue(baseCheckIn);

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/${USER_ID}`)
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
    });

    it('404 — check-in não encontrado', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockCheckInService.getUserCheckIn.mockRejectedValue(new NotFoundException('Check-in not found'));

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/${USER_ID}`)
        .set('Authorization', `Bearer ${orgToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECK-IN MANUAL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /events/:eventId/check-ins/manual', () => {
    it('201 — check-in manual com reason', async () => {
      const manualRecord = { ...baseCheckIn, method: CheckInMethod.Manual, reason: 'QR reader broken', tokenJti: null };
      mockCheckInService.manualCheckIn.mockResolvedValue(manualRecord);

      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ userId: USER_ID, performedBy: STAFF_ID, reason: 'QR reader broken' });

      expect(res.status).toBe(201);
      expect(res.body.method).toBe(CheckInMethod.Manual);
      expect(res.body.reason).toBe('QR reader broken');
    });

    it('201 — check-in manual sem reason (campo opcional)', async () => {
      const manualRecord = { ...baseCheckIn, method: CheckInMethod.Manual, reason: null, tokenJti: null };
      mockCheckInService.manualCheckIn.mockResolvedValue(manualRecord);

      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ userId: USER_ID, performedBy: STAFF_ID });

      expect(res.status).toBe(201);
      expect(res.body.reason).toBeNull();
    });

    it('201 — organizer também pode fazer check-in manual', async () => {
      const manualRecord = { ...baseCheckIn, method: CheckInMethod.Manual, reason: null, tokenJti: null };
      mockCheckInService.manualCheckIn.mockResolvedValue(manualRecord);

      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${orgToken()}`)
        .send({ userId: USER_ID, performedBy: ORG_ID });

      expect(res.status).toBe(201);
    });

    it('400 — body sem userId', async () => {
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ performedBy: STAFF_ID });
      expect(res.status).toBe(400);
    });

    it('400 — body sem performedBy', async () => {
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ userId: USER_ID });
      expect(res.status).toBe(400);
    });

    it('400 — body vazio', async () => {
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('422 — usuário não inscrito no evento', async () => {
      const { UnprocessableEntityException } = await import('@nestjs/common');
      mockCheckInService.manualCheckIn.mockRejectedValue(
        new UnprocessableEntityException('User not registered for event'),
      );

      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ userId: 'usuario-nao-inscrito', performedBy: STAFF_ID });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/not registered/i);
    });

    it('503 — Registration Service indisponível', async () => {
      const { ServiceUnavailableException } = await import('@nestjs/common');
      mockCheckInService.manualCheckIn.mockRejectedValue(
        new ServiceUnavailableException('Registration Service unavailable'),
      );

      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/manual`)
        .set('Authorization', `Bearer ${staffToken()}`)
        .send({ userId: USER_ID, performedBy: STAFF_ID });

      expect(res.status).toBe(503);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTATÍSTICAS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /events/:eventId/check-ins/stats', () => {
    it('200 — estatísticas com check-ins', async () => {
      mockCheckInService.getStats.mockResolvedValue({
        eventId: EVENT_ID,
        totalCheckIns: 42,
        byMethod: { qr_code: 38, manual: 4 },
        qrAudits: 50,
      });

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/stats`)
        .set('Authorization', `Bearer ${orgToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalCheckIns).toBe(42);
      expect(res.body.byMethod.qr_code).toBe(38);
      expect(res.body.byMethod.manual).toBe(4);
      expect(res.body.qrAudits).toBe(50);
    });

    it('200 — estatísticas zeradas (evento sem check-ins)', async () => {
      mockCheckInService.getStats.mockResolvedValue({
        eventId: 'evento-vazio',
        totalCheckIns: 0,
        byMethod: {},
        qrAudits: 0,
      });

      const res = await request(app.getHttpServer())
        .get('/events/evento-vazio/check-ins/stats')
        .set('Authorization', `Bearer ${orgToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalCheckIns).toBe(0);
      expect(res.body.byMethod).toEqual({});
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMATO DA RESPOSTA E HEADERS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Response format and headers', () => {
    it('erros incluem statusCode e message', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('statusCode', 401);
      expect(res.body).toHaveProperty('message');
    });

    it('x-trace-id do request é ecoado no response', async () => {
      mockCheckInService.getStats.mockResolvedValue({
        eventId: EVENT_ID, totalCheckIns: 0, byMethod: {}, qrAudits: 0,
      });

      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/check-ins/stats`)
        .set('Authorization', `Bearer ${orgToken()}`)
        .set('x-trace-id', 'meu-trace-id-123');

      expect(res.headers['x-trace-id']).toBe('meu-trace-id-123');
    });

    it('Content-Type é application/json', async () => {
      const res = await request(app.getHttpServer())
        .get(`/events/${EVENT_ID}/guests/${USER_ID}/qr-code`);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROTA INEXISTENTE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Unknown routes', () => {
    it('404 — rota não existente', async () => {
      const res = await request(app.getHttpServer())
        .get('/rota-que-nao-existe')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(404);
    });

    it('404 — método HTTP errado (POST em rota GET)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/events/${EVENT_ID}/check-ins/stats`)
        .set('Authorization', `Bearer ${orgToken()}`);
      expect(res.status).toBe(404);
    });
  });
});
