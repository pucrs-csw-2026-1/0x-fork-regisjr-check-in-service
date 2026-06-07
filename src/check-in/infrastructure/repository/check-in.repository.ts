import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfiguration } from '../../../config/configuration';
import { DynamoDbService } from '../../../database/dynamo-db.service';
import { CheckInRecord, QrCodeAuditRecord } from '../../domain/check-in.types';
import { ICheckInRepository } from '../../domain/ports/check-in-repository.port';

interface DynamoCheckInItem extends CheckInRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
}

interface DynamoQrAuditItem extends QrCodeAuditRecord {
  PK: string;
  SK: string;
  TTL: number;
}

@Injectable()
export class CheckInRepository extends ICheckInRepository {
  constructor(
    private readonly dynamo: DynamoDbService,
    private readonly configService: ConfigService<AppConfiguration>,
  ) {
    super();
  }

  private get tableName(): string {
    return this.configService.get<string>('dynamoTableName') ?? 'check-in-service';
  }

  async save(record: CheckInRecord): Promise<boolean> {
    const item: DynamoCheckInItem = {
      ...record,
      PK: `EVENT#${record.eventId}`,
      SK: `CHECKIN#${record.userId}`,
      GSI1PK: `USER#${record.userId}`,
      GSI1SK: `CHECKIN#${record.eventId}`,
    };

    try {
      await this.dynamo.putItem({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      });
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return false;
      }
      throw err;
    }
  }

  async findByEventAndUser(eventId: string, userId: string): Promise<CheckInRecord | undefined> {
    const item = await this.dynamo.getItem<DynamoCheckInItem>({
      TableName: this.tableName,
      Key: { PK: `EVENT#${eventId}`, SK: `CHECKIN#${userId}` },
    });

    if (!item) return undefined;
    return this.toRecord(item);
  }

  async listByEvent(
    eventId: string,
    limit: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<{ items: CheckInRecord[]; lastKey?: Record<string, unknown> }> {
    const result = await this.dynamo.query<DynamoCheckInItem>({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `EVENT#${eventId}`,
        ':prefix': 'CHECKIN#',
      },
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    });

    return {
      items: result.items.map((i) => this.toRecord(i)),
      lastKey: result.lastKey,
    };
  }

  async saveQrAudit(audit: QrCodeAuditRecord): Promise<void> {
    const expiresAt = new Date(audit.expiresAt);
    const ttl = Math.floor(expiresAt.getTime() / 1000);

    const item: DynamoQrAuditItem = {
      ...audit,
      PK: `EVENT#${audit.eventId}`,
      SK: `QRAUDIT#${audit.issuedAt}#${audit.userId}`,
      TTL: ttl,
    };

    await this.dynamo.putItem({ TableName: this.tableName, Item: item });
  }

  async countQrAudits(eventId: string): Promise<number> {
    const result = await this.dynamo.query<DynamoQrAuditItem>({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `EVENT#${eventId}`,
        ':prefix': 'QRAUDIT#',
      },
    });

    return result.items.length;
  }

  private toRecord(item: DynamoCheckInItem): CheckInRecord {
    const { PK: _pk, SK: _sk, GSI1PK: _g1pk, GSI1SK: _g1sk, ...record } = item;
    return record;
  }
}
