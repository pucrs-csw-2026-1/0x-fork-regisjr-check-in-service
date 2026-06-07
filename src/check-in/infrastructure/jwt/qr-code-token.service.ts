import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

import { AppConfiguration } from '../../../config/configuration';
import { SecretsManagerService } from '../../../secrets/secrets-manager.service';
import { IQrCodeTokenService } from '../../domain/ports/qr-code-token-service.port';

interface QrCodeClaims {
  eventId: string;
  userId: string;
  jti: string;
}

@Injectable()
export class QrCodeTokenService extends IQrCodeTokenService {
  constructor(
    private readonly secretsManagerService: SecretsManagerService,
    private readonly configService: ConfigService<AppConfiguration>,
  ) {
    super();
  }

  async issue(
    eventId: string,
    userId: string,
  ): Promise<{ token: string; payload: string; expiresAt: string; jti: string }> {
    const secret = await this.getSecret();
    const ttlSeconds = this.configService.get<number>('qrJwtTtlSeconds') ?? 300;
    const jti = randomUUID();

    const token = jwt.sign({ eventId, userId, jti } satisfies QrCodeClaims, secret, {
      algorithm: 'HS256',
      expiresIn: ttlSeconds,
    });

    return {
      token,
      payload: `checkin://${token}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      jti,
    };
  }

  async verify(token: string): Promise<QrCodeClaims> {
    const secret = await this.getSecret();
    const normalizedToken = token.startsWith('checkin://') ? token.slice('checkin://'.length) : token;
    try {
      return jwt.verify(normalizedToken, secret, { algorithms: ['HS256'] }) as QrCodeClaims;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('QR code expired');
      }
      throw new UnauthorizedException('Invalid QR code');
    }
  }

  private async getSecret(): Promise<string> {
    const secretId = this.configService.get<string>('qrJwtSecretId') ?? '';
    const envSecret = this.configService.get<string>('qrJwtSecret') ?? '';
    const secret = await this.secretsManagerService.getSecret(secretId, envSecret);

    if (!secret) {
      throw new InternalServerErrorException('Missing QR secret');
    }

    return secret;
  }
}
