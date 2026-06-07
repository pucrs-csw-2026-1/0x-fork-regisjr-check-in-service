import { Injectable, NotFoundException } from '@nestjs/common';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { CheckInRecord } from '../domain/check-in.types';

@Injectable()
export class GetUserCheckInUseCase {
  constructor(private readonly checkInRepository: ICheckInRepository) {}

  async execute(eventId: string, userId: string): Promise<CheckInRecord> {
    const record = await this.checkInRepository.findByEventAndUser(eventId, userId);
    if (!record) {
      throw new NotFoundException('Check-in not found');
    }
    return record;
  }
}
