import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { AppConfiguration } from '../config/configuration';

@Injectable()
export class SecretsManagerService implements OnModuleInit {
  private readonly logger = new Logger(SecretsManagerService.name);
  private readonly cache = new Map<string, string>();
  private client: SecretsManagerClient | null = null;

  constructor(private readonly configService: ConfigService<AppConfiguration>) {}

  onModuleInit(): void {
    const endpoint = this.configService.get<string>('secretsManagerEndpoint');
    const region = this.configService.get<string>('awsRegion') ?? 'us-east-1';

    if (endpoint) {
      this.client = new SecretsManagerClient({ region, endpoint });
      this.logger.log(`Secrets Manager client configured with endpoint ${endpoint}`);
    } else {
      this.logger.warn('SECRETS_MANAGER_ENDPOINT not set — falling back to env vars for secrets');
    }
  }

  async getSecret(secretId: string, envFallback: string): Promise<string> {
    if (this.cache.has(secretId)) {
      return this.cache.get(secretId)!;
    }

    return this.loadSecret(secretId, envFallback);
  }

  // ADR-008: called by JwtAuthGuard on signature failure to refresh a potentially rotated secret
  async refreshSecret(secretId: string, envFallback = ''): Promise<string> {
    this.cache.delete(secretId);
    return this.loadSecret(secretId, envFallback);
  }

  private async loadSecret(secretId: string, envFallback: string): Promise<string> {
    if (this.client) {
      try {
        const command = new GetSecretValueCommand({ SecretId: secretId });
        const response = await this.client.send(command);
        const value = response.SecretString ?? '';
        this.cache.set(secretId, value);
        return value;
      } catch (err) {
        this.logger.warn(`Failed to load secret "${secretId}" from Secrets Manager, using env fallback: ${(err as Error).message}`);
      }
    }

    this.cache.set(secretId, envFallback);
    return envFallback;
  }
}
