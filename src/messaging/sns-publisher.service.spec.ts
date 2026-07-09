import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient } from '@aws-sdk/client-sns';
import { AppConfiguration } from '../config/configuration';
import { SnsPublisherService } from './sns-publisher.service';

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:checkin-events';

const envelope = {
  event_id: 'evt-1',
  event_type: 'CheckInPerformed',
  source: 'checkin-events',
  occurred_at: '2026-01-01T00:00:00.000Z',
  resource_ref: 'chk-1',
  version: '1.0',
  data: { event_id: 'evt-1', attendant_id: 'user-xyz' },
};

describe('SnsPublisherService', () => {
  let service: SnsPublisherService;
  let send: jest.Mock;

  const configService = {
    get: (key: string) =>
      ({
        awsRegion: 'us-east-1',
        snsEndpoint: 'http://localhost:4566',
        snsTopicArn: TOPIC_ARN,
      })[key],
  } as unknown as ConfigService<AppConfiguration>;

  beforeEach(() => {
    send = jest.fn();
    service = new SnsPublisherService(configService);
    service.onModuleInit();
    // Injeta um SNSClient fake para exercitar só o loop de publish/retry.
    (service as unknown as { client: SNSClient }).client = { send } as unknown as SNSClient;
    // Backoff instantâneo — os testes não esperam os 200/400ms reais.
    jest.spyOn(service as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('publica uma vez no caminho de sucesso, com o event_type como MessageAttribute', async () => {
    send.mockResolvedValue({});
    await service.publish(envelope);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input.TopicArn).toBe(TOPIC_ARN);
    expect(command.input.MessageAttributes.eventType.StringValue).toBe('CheckInPerformed');
    expect(JSON.parse(command.input.Message)).toMatchObject({ event_type: 'CheckInPerformed' });
  });

  it('re-tenta e sucede após uma falha transitória do SNS (critério 6: retry)', async () => {
    send.mockRejectedValueOnce(new Error('sns down')).mockResolvedValue({});

    await expect(service.publish(envelope)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('re-tenta até 3 tentativas e propaga o erro quando o SNS permanece indisponível', async () => {
    send.mockRejectedValue(new Error('sns down'));

    await expect(service.publish(envelope)).rejects.toThrow('sns down');
    expect(send).toHaveBeenCalledTimes(1 + 2); // 1 tentativa + 2 retries
  });
});
