import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios from 'axios';

import { RegistrationServiceClient } from './registration-service.client';

jest.mock('axios', () => ({
  create: jest.fn(() => ({ get: jest.fn() })),
}));

describe('RegistrationServiceClient', () => {
  let client: RegistrationServiceClient;
  let mockGet: jest.Mock;

  beforeEach(async () => {
    mockGet = jest.fn();
    (axios.create as jest.Mock).mockReturnValue({ get: mockGet });

    const module = await Test.createTestingModule({
      providers: [
        RegistrationServiceClient,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'registrationServiceUrl') return 'http://localhost:3001';
              if (key === 'registrationServiceTimeoutMs') return 500;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    client = module.get(RegistrationServiceClient);
  });

  it('calls the correct check-in endpoint (GET /events/:id/guests/:id/check-in)', async () => {
    mockGet.mockResolvedValue({ data: { eventId: 'e', userId: 'u', status: 'CONFIRMED', createdAt: '', updatedAt: null } });
    await client.validateRegistration('event-1', 'user-1');
    expect(mockGet).toHaveBeenCalledWith('/events/event-1/guests/user-1/check-in', undefined);
  });

  it('repassa o Bearer do chamador quando fornecido (US-08)', async () => {
    mockGet.mockResolvedValue({ data: { status: 'CONFIRMED' } });
    await client.validateRegistration('event-1', 'user-1', 'jwt-abc');
    expect(mockGet).toHaveBeenCalledWith('/events/event-1/guests/user-1/check-in', {
      headers: { Authorization: 'Bearer jwt-abc' },
    });
  });

  it('200 when status is CONFIRMED', async () => {
    mockGet.mockResolvedValue({ data: { status: 'CONFIRMED' } });
    const result = await client.validateRegistration('event-1', 'user-1');
    expect(result).toEqual({ isRegistered: true, isConfirmed: true });
  });

  it('422 when status is REGISTERED (e-mail not yet confirmed)', async () => {
    mockGet.mockResolvedValue({ data: { status: 'REGISTERED' } });
    await expect(client.validateRegistration('event-1', 'user-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('422 when status is CANCELLED', async () => {
    mockGet.mockResolvedValue({ data: { status: 'CANCELLED' } });
    await expect(client.validateRegistration('event-1', 'user-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('422 on 404 — user has no registration for event', async () => {
    const err = Object.assign(new Error('Not found'), { response: { status: 404 } });
    mockGet.mockRejectedValue(err);
    await expect(client.validateRegistration('event-1', 'user-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('retries once on 5xx then throws ServiceUnavailableException', async () => {
    const err = Object.assign(new Error('Server error'), { response: { status: 503 } });
    mockGet.mockRejectedValue(err);
    await expect(client.validateRegistration('event-1', 'user-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
