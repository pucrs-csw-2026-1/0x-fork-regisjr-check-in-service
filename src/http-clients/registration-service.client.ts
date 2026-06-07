import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { AppConfiguration } from '../config/configuration';
import { IRegistrationClient } from '../check-in/domain/ports/registration-client.port';

// Status returned by the Registration Service (manifestbolo-t2-registration)
type RegistrationStatus = 'REGISTERED' | 'CONFIRMED' | 'CANCELLED';

interface CheckInStatusResponse {
  eventId: string;
  userId: string;
  status: RegistrationStatus;
  createdAt: string;
  updatedAt: string | null;
}

@Injectable()
export class RegistrationServiceClient extends IRegistrationClient {
  private readonly logger = new Logger(RegistrationServiceClient.name);
  private readonly http: AxiosInstance;

  constructor(private readonly configService: ConfigService<AppConfiguration>) {
    super();
    const baseURL = this.configService.get<string>('registrationServiceUrl') ?? '';
    const timeout = this.configService.get<number>('registrationServiceTimeoutMs') ?? 500;

    this.http = axios.create({ baseURL, timeout });
  }

  async validateRegistration(
    eventId: string,
    userId: string,
  ): Promise<{ isRegistered: boolean; isConfirmed: boolean }> {
    const url = `/events/${eventId}/guests/${userId}/check-in`;

    try {
      const { data } = await this.withRetry<CheckInStatusResponse>(
        () => this.http.get<CheckInStatusResponse>(url),
      );

      if (data.status !== 'CONFIRMED') {
        throw new UnprocessableEntityException(
          `User ${userId} registration is ${data.status} for event ${eventId} — only CONFIRMED registrations may check in`,
        );
      }

      return { isRegistered: true, isConfirmed: true };
    } catch (err) {
      if (err instanceof UnprocessableEntityException) throw err;

      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 404) {
        throw new UnprocessableEntityException(
          `User ${userId} has no registration for event ${eventId}`,
        );
      }

      this.logger.error(`Registration Service unavailable for ${url}: ${axiosErr.message}`);
      throw new ServiceUnavailableException('Registration Service unavailable');
    }
  }

  private async withRetry<T>(fn: () => Promise<{ data: T }>, retries = 1): Promise<{ data: T }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;
        const isRetryable = !status || status >= 500;

        if (attempt < retries && isRetryable) {
          const backoff = 100 * (attempt + 1);
          this.logger.warn(`Retrying Registration Service call in ${backoff}ms (attempt ${attempt + 1})`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        throw err;
      }
    }

    throw new ServiceUnavailableException('Registration Service unavailable after retries');
  }
}
