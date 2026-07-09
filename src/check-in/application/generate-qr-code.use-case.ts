import { Injectable } from '@nestjs/common';
import { IRegistrationClient } from '../domain/ports/registration-client.port';
import { IQrCodeTokenService } from '../domain/ports/qr-code-token-service.port';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';

export interface GenerateQrCodeResult {
  token: string;
  qrPayload: string;
  expiresAt: string;
}

@Injectable()
export class GenerateQrCodeUseCase {
  constructor(
    private readonly registrationClient: IRegistrationClient,
    private readonly qrCodeTokenService: IQrCodeTokenService,
    private readonly checkInRepository: ICheckInRepository,
  ) {}

  async execute(eventId: string, userId: string, accessToken?: string): Promise<GenerateQrCodeResult> {
    await this.registrationClient.validateRegistration(eventId, userId, accessToken);

    const issued = await this.qrCodeTokenService.issue(eventId, userId);

    await this.checkInRepository.saveQrAudit({
      entityType: 'QrCodeAudit',
      eventId,
      userId,
      tokenJti: issued.jti,
      issuedAt: new Date().toISOString(),
      expiresAt: issued.expiresAt,
    });

    return { token: issued.token, qrPayload: issued.payload, expiresAt: issued.expiresAt };
  }
}
