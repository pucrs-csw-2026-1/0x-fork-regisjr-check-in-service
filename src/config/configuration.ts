export interface AppConfiguration {
  port: number;
  // Keycloak / Auth Service
  keycloakUrl: string;
  keycloakIssuerUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
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
    keycloakUrl,
    keycloakIssuerUrl: process.env.KEYCLOAK_ISSUER_URL ?? keycloakUrl,
    keycloakRealm: process.env.KEYCLOAK_REALM ?? 'event-system',
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? 'nest-api',
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
