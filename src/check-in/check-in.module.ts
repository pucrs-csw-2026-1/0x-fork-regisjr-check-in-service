import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DynamoDbService } from '../database/dynamo-db.service';
import { RegistrationServiceClient } from '../http-clients/registration-service.client';
import { SnsPublisherService } from '../messaging/sns-publisher.service';

import { ICheckInRepository } from './domain/ports/check-in-repository.port';
import { IRegistrationClient } from './domain/ports/registration-client.port';
import { IEventPublisher } from './domain/ports/event-publisher.port';
import { IQrCodeTokenService } from './domain/ports/qr-code-token-service.port';

import { CheckInRepository } from './infrastructure/repository/check-in.repository';
import { QrCodeTokenService } from './infrastructure/jwt/qr-code-token.service';

import { GenerateQrCodeUseCase } from './application/generate-qr-code.use-case';
import { ScanQrCodeUseCase } from './application/scan-qr-code.use-case';
import { ManualCheckInUseCase } from './application/manual-check-in.use-case';
import { ListEventCheckInsUseCase } from './application/list-event-check-ins.use-case';
import { GetUserCheckInUseCase } from './application/get-user-check-in.use-case';
import { GetStatsUseCase } from './application/get-stats.use-case';

import { CheckInController } from './presentation/check-in.controller';

@Module({
  imports: [AuthModule],
  controllers: [CheckInController],
  providers: [
    DynamoDbService,

    // Port → adapter bindings (ADR-007)
    { provide: ICheckInRepository, useClass: CheckInRepository },
    { provide: IRegistrationClient, useClass: RegistrationServiceClient },
    { provide: IEventPublisher, useClass: SnsPublisherService },
    { provide: IQrCodeTokenService, useClass: QrCodeTokenService },

    // Use cases (ADR-007 application layer)
    GenerateQrCodeUseCase,
    ScanQrCodeUseCase,
    ManualCheckInUseCase,
    ListEventCheckInsUseCase,
    GetUserCheckInUseCase,
    GetStatsUseCase,
  ],
})
export class CheckInModule {}
