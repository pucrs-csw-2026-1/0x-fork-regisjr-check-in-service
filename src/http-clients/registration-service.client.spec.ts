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

  it('should return registration data when participant is registered and confirmed', async () => {
    mockGet.mockResolvedValue({ data: { isRegistered: true, isConfirmed: true } });

    const result = await client.validateRegistration('event-1', 'user-1');
    expect(result.isRegistered).toBe(true);
    expect(result.isConfirmed).toBe(true);
  });

  it('should throw UnprocessableEntityException when not registered', async () => {
    mockGet.mockResolvedValue({ data: { isRegistered: false, isConfirmed: false } });

    await expect(client.validateRegistration('event-1', 'user-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('should throw UnprocessableEntityException on 404', async () => {
    const err = Object.assign(new Error('Not found'), { response: { status: 404 } });
    mockGet.mockRejectedValue(err);

    await expect(client.validateRegistration('event-1', 'user-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('should retry once on 5xx then throw ServiceUnavailableException', async () => {
    const err = Object.assign(new Error('Server error'), { response: { status: 503 } });
    mockGet.mockRejectedValue(err);

    await expect(client.validateRegistration('event-1', 'user-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
