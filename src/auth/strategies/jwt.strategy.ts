import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { AppConfiguration } from '../../config/configuration';

export interface AuthServiceJwtPayload {
  sub: string;
  scopes: string[];
  principal_type: 'user' | 'service';
  type: 'access' | 'refresh';
  exp: number;
  email?: string;
}

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  scopes: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService<AppConfiguration>) {
    const authServiceUrl = configService.get<string>('authServiceUrl') ?? 'http://localhost:8080';

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${authServiceUrl}/.well-known/jwks.json`,
      }),
    });
  }

  validate(payload: AuthServiceJwtPayload): AuthenticatedUser {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token: missing subject');
    }
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token: not an access token');
    }
    if (payload.principal_type !== 'user') {
      throw new UnauthorizedException('Invalid token: not a user token');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      scopes: payload.scopes ?? [],
    };
  }
}
