export abstract class IRegistrationClient {
  abstract validateRegistration(
    eventId: string,
    userId: string,
  ): Promise<{ isRegistered: boolean; isConfirmed: boolean }>;
}
