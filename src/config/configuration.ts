export interface AppConfiguration {
  port: number;
  awsRegion: string;
  dynamoTableName: string;
  dynamoEndpoint: string | undefined;
  snsTopicArn: string;
  snsEndpoint: string | undefined;
  secretsManagerEndpoint: string | undefined;
  qrJwtSecretId: string;
  authJwtSecretId: string;
  qrJwtSecret: string;
  authJwtSecret: string;
  // US-08: valida JWT de usuário via JWKS do Auth (T1, RS256) — auth único.
  authJwksUrl: string;
  qrJwtTtlSeconds: number;
  registrationServiceUrl: string;
  registrationServiceTimeoutMs: number;
}

export function configuration(): AppConfiguration {
  return {
    port: Number(process.env.PORT ?? 3000),
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    dynamoTableName: process.env.DYNAMODB_TABLE_NAME ?? 'check-in-service',
    dynamoEndpoint: process.env.DYNAMODB_ENDPOINT,
    snsTopicArn: process.env.SNS_TOPIC_ARN ?? '',
    snsEndpoint: process.env.SNS_ENDPOINT,
    secretsManagerEndpoint: process.env.SECRETS_MANAGER_ENDPOINT,
    qrJwtSecretId: process.env.QR_JWT_SECRET_ID ?? 'regisjr/check-in/qr-jwt-secret',
    authJwtSecretId: process.env.AUTH_JWT_SECRET_ID ?? 'regisjr/auth/jwt-secret',
    qrJwtSecret: process.env.QR_JWT_SECRET ?? '',
    authJwtSecret: process.env.AUTH_JWT_SECRET ?? '',
    authJwksUrl: process.env.AUTH_JWKS_URL ?? 'http://localhost:8080/.well-known/jwks.json',
    qrJwtTtlSeconds: Number(process.env.QR_JWT_TTL_SECONDS ?? 300),
    registrationServiceUrl: process.env.REGISTRATION_SERVICE_URL ?? '',
    registrationServiceTimeoutMs: Number(process.env.REGISTRATION_SERVICE_TIMEOUT_MS ?? 500),
  };
}
