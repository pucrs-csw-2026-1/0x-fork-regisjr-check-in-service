import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';

import { SecretsManagerService } from '../../../secrets/secrets-manager.service';
import { QrCodeTokenService } from './qr-code-token.service';

const SECRET = 'test-secret';
const EVENT_ID = 'event-123';
const USER_ID = 'user-456';

describe('QrCodeTokenService', () => {
  let service: QrCodeTokenService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        QrCodeTokenService,
        {
          provide: SecretsManagerService,
          useValue: { getSecret: jest.fn().mockResolvedValue(SECRET) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'qrJwtTtlSeconds') return 300;
              if (key === 'qrJwtSecretId') return 'test-secret-id';
              if (key === 'qrJwtSecret') return SECRET;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(QrCodeTokenService);
  });

  it('should issue a valid token', async () => {
    const result = await service.issue(EVENT_ID, USER_ID);

    expect(result.token).toBeDefined();
    expect(result.payload).toMatch(/^checkin:\/\//);
    expect(result.jti).toBeDefined();
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('should verify a valid token and return claims', async () => {
    const { token } = await service.issue(EVENT_ID, USER_ID);
    const claims = await service.verify(token);

    expect(claims.eventId).toBe(EVENT_ID);
    expect(claims.userId).toBe(USER_ID);
    expect(claims.jti).toBeDefined();
  });

  it('should verify a checkin:// prefixed payload', async () => {
    const { payload } = await service.issue(EVENT_ID, USER_ID);
    const claims = await service.verify(payload);

    expect(claims.userId).toBe(USER_ID);
  });

  it('should throw on expired token', async () => {
    const expiredToken = jwt.sign({ eventId: EVENT_ID, userId: USER_ID, jti: 'jti-x' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: -1,
    });

    await expect(service.verify(expiredToken)).rejects.toThrow();
  });

  it('should throw on tampered token', async () => {
    const { token } = await service.issue(EVENT_ID, USER_ID);
    await expect(service.verify(token + 'tampered')).rejects.toThrow();
  });
});
