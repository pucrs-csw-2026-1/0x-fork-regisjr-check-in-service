export abstract class IEventPublisher {
  abstract publish(event: unknown): Promise<void>;
}
