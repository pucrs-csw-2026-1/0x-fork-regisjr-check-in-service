import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

import { AppConfiguration } from '../config/configuration';
import { SecretsManagerService } from '../secrets/secrets-manager.service';

interface AccessTokenPayload {
  sub: string;
  scopes?: string[];
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly secretsManagerService: SecretsManagerService,
    private readonly configService: ConfigService<AppConfiguration>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorizationHeader: string | undefined = request.headers?.authorization;

    if (!authorizationHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const token = authorizationHeader.slice('Bearer '.length).trim();

    const secretId = this.configService.get<string>('authJwtSecretId') ?? '';
    const envSecret = this.configService.get<string>('authJwtSecret') ?? '';
    const secret = await this.secretsManagerService.getSecret(secretId, envSecret);

    if (!secret) {
      throw new UnauthorizedException('Missing auth secret');
    }

    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as AccessTokenPayload;
      request.user = {
        sub: payload.sub,
        scopes: payload.scopes ?? [],
      };

      return true;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Token expired');
      }

      throw new UnauthorizedException('Invalid token');
    }
  }
}
