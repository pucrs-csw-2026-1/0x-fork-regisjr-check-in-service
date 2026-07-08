import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';

import { AppConfiguration } from '../config/configuration';

interface AccessTokenPayload {
  sub: string;
  scopes?: string[];
  iat?: number;
  exp?: number;
}

/**
 * US-08: valida o JWT do usuário contra o **JWKS do Auth (T1)** — RS256, auth
 * único da plataforma. Substitui a validação por segredo HMAC compartilhado.
 * A chave pública é resolvida por `kid` a partir do JWKS remoto (com cache).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private client: JwksClient | null = null;

  constructor(private readonly configService: ConfigService<AppConfiguration>) {}

  private getClient(): JwksClient {
    if (!this.client) {
      const jwksUri = this.configService.get<string>('authJwksUrl') ?? '';
      this.client = new JwksClient({ jwksUri, cache: true, rateLimit: true });
    }
    return this.client;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorizationHeader: string | undefined = request.headers?.authorization;

    if (!authorizationHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const token = authorizationHeader.slice('Bearer '.length).trim();
    const client = this.getClient();

    try {
      const payload = await new Promise<AccessTokenPayload>((resolve, reject) => {
        jwt.verify(
          token,
          (header, callback) => {
            client.getSigningKey(header.kid, (err, key) => {
              if (err || !key) {
                callback(err ?? new Error('signing key not found'));
                return;
              }
              callback(null, key.getPublicKey());
            });
          },
          { algorithms: ['RS256'] },
          (err, decoded) => (err ? reject(err) : resolve(decoded as AccessTokenPayload)),
        );
      });

      request.user = { sub: payload.sub, scopes: payload.scopes ?? [] };
      return true;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Token expired');
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
