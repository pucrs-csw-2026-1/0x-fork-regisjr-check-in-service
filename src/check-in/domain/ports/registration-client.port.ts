export abstract class IRegistrationClient {
  abstract validateRegistration(
    eventId: string,
    userId: string,
    // US-08: repassa o Bearer do chamador (staff/admin) para a validação de
    // inscrição no Registration, cujo endpoint de status é protegido.
    accessToken?: string,
  ): Promise<{ isRegistered: boolean; isConfirmed: boolean }>;
}
