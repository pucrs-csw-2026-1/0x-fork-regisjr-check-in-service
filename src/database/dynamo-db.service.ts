import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DeleteCommandInput,
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandInput,
  PutCommand,
  PutCommandInput,
  QueryCommand,
  QueryCommandInput,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { AppConfiguration } from '../config/configuration';

@Injectable()
export class DynamoDbService implements OnModuleInit {
  private readonly logger = new Logger(DynamoDbService.name);
  private docClient!: DynamoDBDocumentClient;

  constructor(private readonly configService: ConfigService<AppConfiguration>) {}

  onModuleInit(): void {
    const region = this.configService.get<string>('awsRegion') ?? 'us-east-1';
    const endpoint = this.configService.get<string>('dynamoEndpoint');

    const client = new DynamoDBClient({ region, ...(endpoint ? { endpoint } : {}) });
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });

    this.logger.log(`DynamoDB client configured (region=${region}${endpoint ? `, endpoint=${endpoint}` : ''})`);
  }

  async getItem<T>(input: GetCommandInput): Promise<T | undefined> {
    try {
      const result = await this.docClient.send(new GetCommand(input));
      return result.Item as T | undefined;
    } catch (err) {
      this.handleError(err);
    }
  }

  async putItem(input: PutCommandInput): Promise<void> {
    try {
      await this.docClient.send(new PutCommand(input));
    } catch (err) {
      this.handleError(err);
    }
  }

  async query<T>(input: QueryCommandInput): Promise<{ items: T[]; lastKey?: Record<string, unknown> }> {
    try {
      const result: QueryCommandOutput = await this.docClient.send(new QueryCommand(input));
      return {
        items: (result.Items ?? []) as T[],
        lastKey: result.LastEvaluatedKey as Record<string, unknown> | undefined,
      };
    } catch (err) {
      this.handleError(err);
    }
  }

  async deleteItem(input: DeleteCommandInput): Promise<void> {
    try {
      await this.docClient.send(new DeleteCommand(input));
    } catch (err) {
      this.handleError(err);
    }
  }

  private handleError(err: unknown): never {
    // Preserve ConditionalCheckFailedException so CheckInRepository.save can handle idempotency
    if (err instanceof ConditionalCheckFailedException) {
      throw err;
    }
    this.logger.error(`DynamoDB error: ${(err as Error).message}`);
    throw new ServiceUnavailableException('Database unavailable');
  }
}
