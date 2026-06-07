import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { AppConfiguration } from '../config/configuration';

@Injectable()
export class SnsPublisherService implements OnModuleInit {
  private readonly logger = new Logger(SnsPublisherService.name);
  private client!: SNSClient;
  private topicArn!: string;

  constructor(private readonly configService: ConfigService<AppConfiguration>) {}

  onModuleInit(): void {
    const region = this.configService.get<string>('awsRegion') ?? 'us-east-1';
    const endpoint = this.configService.get<string>('snsEndpoint');
    this.topicArn = this.configService.get<string>('snsTopicArn') ?? '';

    this.client = new SNSClient({ region, ...(endpoint ? { endpoint } : {}) });
    this.logger.log(`SNS client configured (region=${region}${endpoint ? `, endpoint=${endpoint}` : ''})`);
  }

  async publish(event: unknown): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
        MessageAttributes: {
          eventType: {
            DataType: 'String',
            StringValue: (event as { eventType: string }).eventType,
          },
        },
      }),
    );
  }
}
