import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { AppConfiguration } from '../config/configuration';
import { IEventPublisher } from '../check-in/domain/ports/event-publisher.port';

// US-08 (critério 6: "log + retry"): backoff curto entre tentativas, alinhado ao
// padrão dos forks irmãos (avengers RETRY_DELAYS_MS=[200,400], manifestbolo (0.2,0.4)).
const RETRY_DELAYS_MS = [200, 400];

@Injectable()
export class SnsPublisherService extends IEventPublisher implements OnModuleInit {
  private readonly logger = new Logger(SnsPublisherService.name);
  private client!: SNSClient;
  private topicArn!: string;

  constructor(private readonly configService: ConfigService<AppConfiguration>) {
    super();
  }

  onModuleInit(): void {
    const region = this.configService.get<string>('awsRegion') ?? 'us-east-1';
    const endpoint = this.configService.get<string>('snsEndpoint');
    this.topicArn = this.configService.get<string>('snsTopicArn') ?? '';

    this.client = new SNSClient({ region, ...(endpoint ? { endpoint } : {}) });
    this.logger.log(`SNS client configured (region=${region}${endpoint ? `, endpoint=${endpoint}` : ''})`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async publish(event: unknown): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 1 + RETRY_DELAYS_MS.length; attempt++) {
      try {
        await this.client.send(
          new PublishCommand({
            TopicArn: this.topicArn,
            Message: JSON.stringify(event),
            MessageAttributes: {
              eventType: {
                DataType: 'String',
                StringValue: (event as { event_type: string }).event_type,
              },
            },
          }),
        );
        return;
      } catch (err) {
        lastError = err;
        if (attempt < RETRY_DELAYS_MS.length) {
          this.logger.warn(
            `SNS publish falhou (tentativa ${attempt + 1}/${1 + RETRY_DELAYS_MS.length}), re-tentando em ${RETRY_DELAYS_MS[attempt]}ms`,
          );
          await this.sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    // Esgotou as tentativas: propaga para o caller (use-case), que loga sem
    // quebrar a resposta ao cliente (publishEvent é fire-and-forget via `void`).
    throw lastError;
  }
}
