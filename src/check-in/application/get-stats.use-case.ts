import { Injectable } from '@nestjs/common';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';

export interface CheckInStatsResult {
  eventId: string;
  totalCheckIns: number;
  byMethod: Record<string, number>;
  qrAudits: number;
}

@Injectable()
export class GetStatsUseCase {
  constructor(private readonly checkInRepository: ICheckInRepository) {}

  async execute(eventId: string): Promise<CheckInStatsResult> {
    const { items } = await this.checkInRepository.listByEvent(eventId, 1000);
    const qrAudits = await this.checkInRepository.countQrAudits(eventId);

    return {
      eventId,
      totalCheckIns: items.length,
      byMethod: items.reduce<Record<string, number>>((acc, item) => {
        acc[item.method] = (acc[item.method] ?? 0) + 1;
        return acc;
      }, {}),
      qrAudits,
    };
  }
}
