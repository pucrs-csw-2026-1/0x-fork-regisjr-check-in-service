export interface AppConfiguration {
  port: number;
  // Auth Service (Python FastAPI — JWT RS256 via JWKS)
  authServiceUrl: string;
  // AWS
  awsRegion: string;
  dynamoTableName: string;
  dynamoEndpoint: string | undefined;
  snsTopicArn: string;
  snsEndpoint: string | undefined;
  secretsManagerEndpoint: string | undefined;
  // QR JWT (signed by this service, not Keycloak)
  qrJwtSecretId: string;
  qrJwtSecret: string;
  qrJwtTtlSeconds: number;
  // Registration Service
  registrationServiceUrl: string;
  registrationServiceTimeoutMs: number;
}

export function configuration(): AppConfiguration {
  const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
  return {
    port: Number(process.env.PORT ?? 3000),
    authServiceUrl: process.env.AUTH_SERVICE_URL ?? 'http://localhost:8080',
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    dynamoTableName: process.env.DYNAMODB_TABLE_NAME ?? 'check-in-service',
    dynamoEndpoint: process.env.DYNAMODB_ENDPOINT,
    snsTopicArn: process.env.SNS_TOPIC_ARN ?? '',
    snsEndpoint: process.env.SNS_ENDPOINT,
    secretsManagerEndpoint: process.env.SECRETS_MANAGER_ENDPOINT,
    qrJwtSecretId: process.env.QR_JWT_SECRET_ID ?? 'regisjr/check-in/qr-jwt-secret',
    qrJwtSecret: process.env.QR_JWT_SECRET ?? '',
    qrJwtTtlSeconds: Number(process.env.QR_JWT_TTL_SECONDS ?? 300),
    registrationServiceUrl: process.env.REGISTRATION_SERVICE_URL ?? '',
    registrationServiceTimeoutMs: Number(process.env.REGISTRATION_SERVICE_TIMEOUT_MS ?? 500),
  };
}
