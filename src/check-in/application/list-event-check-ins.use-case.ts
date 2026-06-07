import { Injectable } from '@nestjs/common';
import { ICheckInRepository } from '../domain/ports/check-in-repository.port';
import { CheckInRecord } from '../domain/check-in.types';

export interface CheckInListResult {
  data: CheckInRecord[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ListEventCheckInsUseCase {
  constructor(private readonly checkInRepository: ICheckInRepository) {}

  async execute(eventId: string, page = 1, limit = 20): Promise<CheckInListResult> {
    const { items } = await this.checkInRepository.listByEvent(eventId, limit * page);
    const start = (page - 1) * limit;

    return {
      data: items.slice(start, start + limit),
      total: items.length,
      page,
      limit,
    };
  }
}
