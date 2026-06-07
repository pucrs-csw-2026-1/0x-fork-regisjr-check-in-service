import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { AppConfiguration } from '../../config/configuration';

export interface KeycloakJwtPayload {
  sub: string;
  email?: string;
  preferred_username?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
}

export interface AuthenticatedUser {
  keycloakUserId: string;
  email?: string;
  username?: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly clientId: string;

  constructor(configService: ConfigService<AppConfiguration>) {
    const keycloakUrl = configService.get<string>('keycloakUrl') ?? 'http://localhost:8080';
    const issuerUrl = configService.get<string>('keycloakIssuerUrl') ?? keycloakUrl;
    const realm = configService.get<string>('keycloakRealm') ?? 'event-system';
    const clientId = configService.get<string>('keycloakClientId') ?? 'nest-api';
    const issuer = `${issuerUrl}/realms/${realm}`;
    const jwksUri = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri,
      }),
    });

    this.clientId = clientId;
  }

  validate(payload: KeycloakJwtPayload): AuthenticatedUser {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token subject');
    }

    const realmRoles = payload.realm_access?.roles ?? [];
    const clientRoles = payload.resource_access?.[this.clientId]?.roles ?? [];
    const roles = Array.from(new Set([...realmRoles, ...clientRoles]));

    return {
      keycloakUserId: payload.sub,
      email: payload.email,
      username: payload.preferred_username,
      roles,
    };
  }
}
