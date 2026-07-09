#!/usr/bin/env bash
set -e

REGION=${AWS_REGION:-us-east-1}
DYNAMO_ENDPOINT=${DYNAMODB_ENDPOINT:-http://localhost:8000}
LOCALSTACK_ENDPOINT=${SNS_ENDPOINT:-http://localhost:4566}
TABLE_NAME=${DYNAMODB_TABLE_NAME:-check-in-service}
# US-08: tópico que o consumidor de SQS do Metrics (T2) assina.
SNS_TOPIC_NAME=${SNS_TOPIC_NAME:-checkin-events}
QR_SECRET=${QR_JWT_SECRET:-dev-qr-secret-change-in-production}
AUTH_SECRET=${AUTH_JWT_SECRET:-dev-auth-secret-change-in-production}

echo "==> Creating DynamoDB table: $TABLE_NAME"
aws dynamodb create-table \
  --endpoint-url "$DYNAMO_ENDPOINT" \
  --region "$REGION" \
  --table-name "$TABLE_NAME" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes '[
    {
      "IndexName": "GSI1",
      "KeySchema": [
        {"AttributeName":"GSI1PK","KeyType":"HASH"},
        {"AttributeName":"GSI1SK","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    }
  ]' \
  --billing-mode PAY_PER_REQUEST \
  --output text 2>/dev/null || echo "Table $TABLE_NAME already exists, skipping."

echo "==> Enabling TTL on table"
aws dynamodb update-time-to-live \
  --endpoint-url "$DYNAMO_ENDPOINT" \
  --region "$REGION" \
  --table-name "$TABLE_NAME" \
  --time-to-live-specification Enabled=true,AttributeName=TTL \
  --output text 2>/dev/null || true

echo "==> Creating SNS topic: $SNS_TOPIC_NAME"
TOPIC_ARN=$(aws sns create-topic \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$REGION" \
  --name "$SNS_TOPIC_NAME" \
  --output text --query 'TopicArn')
echo "    TopicArn: $TOPIC_ARN"

echo "==> Creating Secrets Manager secrets"
aws secretsmanager create-secret \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$REGION" \
  --name "regisjr/check-in/qr-jwt-secret" \
  --secret-string "$QR_SECRET" \
  --output text 2>/dev/null || \
aws secretsmanager update-secret \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$REGION" \
  --secret-id "regisjr/check-in/qr-jwt-secret" \
  --secret-string "$QR_SECRET" \
  --output text

aws secretsmanager create-secret \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$REGION" \
  --name "regisjr/auth/jwt-secret" \
  --secret-string "$AUTH_SECRET" \
  --output text 2>/dev/null || \
aws secretsmanager update-secret \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$REGION" \
  --secret-id "regisjr/auth/jwt-secret" \
  --secret-string "$AUTH_SECRET" \
  --output text

echo ""
echo "==> Local AWS resources ready!"
echo "    DynamoDB table: $TABLE_NAME @ $DYNAMO_ENDPOINT"
echo "    SNS topic:      $TOPIC_ARN"
echo "    Secrets:        regisjr/check-in/qr-jwt-secret, regisjr/auth/jwt-secret"
