export abstract class IQrCodeTokenService {
  abstract issue(
    eventId: string,
    userId: string,
  ): Promise<{ token: string; payload: string; expiresAt: string; jti: string }>;
  abstract verify(token: string): Promise<{ eventId: string; userId: string; jti: string }>;
}
