#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
APP_NAME="${APP_NAME:-cairn}"
DB_IDENTIFIER="${RDS_DB_INSTANCE_IDENTIFIER:-cairn-postgres-prod}"
DB_NAME="${RDS_DB_NAME:-cairn}"
DB_USER="${RDS_MASTER_USERNAME:-cairn_admin}"
DB_CLASS="${RDS_DB_INSTANCE_CLASS:-db.t4g.micro}"
DB_STORAGE_GB="${RDS_ALLOCATED_STORAGE_GB:-20}"
EVENT_BUS_NAME="${EVENTBRIDGE_BUS_NAME:-cairn-prod}"
SECRET_NAME="${SECRETS_PREFIX:-/cairn/prod}/database-url"
SECURITY_GROUP_NAME="${APP_NAME}-rds-${ENVIRONMENT}"
RDS_PUBLICLY_ACCESSIBLE="${RDS_PUBLICLY_ACCESSIBLE:-true}"
RDS_OPEN_TO_INTERNET="${RDS_OPEN_TO_INTERNET:-false}"
RDS_ALLOWED_CIDR="${RDS_ALLOWED_CIDR:-}"

echo "Using AWS region: ${AWS_REGION}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
VPC_ID="$(aws ec2 describe-vpcs \
  --region "${AWS_REGION}" \
  --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' \
  --output text)"

if [[ -z "${VPC_ID}" || "${VPC_ID}" == "None" ]]; then
  echo "No default VPC found in ${AWS_REGION}. Create/select a VPC first, then rerun."
  exit 1
fi

SECURITY_GROUP_ID="$(aws ec2 describe-security-groups \
  --region "${AWS_REGION}" \
  --filters "Name=group-name,Values=${SECURITY_GROUP_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' \
  --output text 2>/dev/null || true)"

if [[ -z "${SECURITY_GROUP_ID}" || "${SECURITY_GROUP_ID}" == "None" ]]; then
  SECURITY_GROUP_ID="$(aws ec2 create-security-group \
    --region "${AWS_REGION}" \
    --group-name "${SECURITY_GROUP_NAME}" \
    --description "Cairn ${ENVIRONMENT} Postgres access" \
    --vpc-id "${VPC_ID}" \
    --query GroupId \
    --output text)"
fi

if [[ -z "${RDS_ALLOWED_CIDR}" ]]; then
  CURRENT_IP="$(curl -fsS https://checkip.amazonaws.com 2>/dev/null || true)"
  if [[ -n "${CURRENT_IP}" ]]; then
    RDS_ALLOWED_CIDR="${CURRENT_IP}/32"
  fi
fi

if [[ "${RDS_OPEN_TO_INTERNET}" == "true" ]]; then
  RDS_ALLOWED_CIDR="0.0.0.0/0"
fi

if [[ -z "${RDS_ALLOWED_CIDR}" ]]; then
  echo "Could not determine RDS_ALLOWED_CIDR. Set it to your fixed egress IP/CIDR and rerun."
  exit 1
fi

aws ec2 authorize-security-group-ingress \
  --region "${AWS_REGION}" \
  --group-id "${SECURITY_GROUP_ID}" \
  --protocol tcp \
  --port 5432 \
  --cidr "${RDS_ALLOWED_CIDR}" >/dev/null 2>&1 || true

DB_EXISTS="$(aws rds describe-db-instances \
  --region "${AWS_REGION}" \
  --db-instance-identifier "${DB_IDENTIFIER}" \
  --query 'DBInstances[0].DBInstanceIdentifier' \
  --output text 2>/dev/null || true)"

DATABASE_URL="$(aws secretsmanager get-secret-value \
  --region "${AWS_REGION}" \
  --secret-id "${SECRET_NAME}" \
  --query SecretString \
  --output text 2>/dev/null || true)"

if [[ -z "${DB_EXISTS}" || "${DB_EXISTS}" == "None" ]]; then
  DB_PASSWORD="$(openssl rand -hex 18)"
  echo "Creating RDS Postgres instance ${DB_IDENTIFIER}. This can take 10-15 minutes."
  aws rds create-db-instance \
    --region "${AWS_REGION}" \
    --db-instance-identifier "${DB_IDENTIFIER}" \
    --db-instance-class "${DB_CLASS}" \
    --engine postgres \
    --allocated-storage "${DB_STORAGE_GB}" \
    --storage-type gp3 \
    --storage-encrypted \
    --db-name "${DB_NAME}" \
    --master-username "${DB_USER}" \
    --master-user-password "${DB_PASSWORD}" \
    --vpc-security-group-ids "${SECURITY_GROUP_ID}" \
    $(if [[ "${RDS_PUBLICLY_ACCESSIBLE}" == "true" ]]; then echo "--publicly-accessible"; else echo "--no-publicly-accessible"; fi) \
    --backup-retention-period 7 \
    --deletion-protection \
    --no-multi-az >/dev/null
  aws rds wait db-instance-available \
    --region "${AWS_REGION}" \
    --db-instance-identifier "${DB_IDENTIFIER}"
else
  echo "RDS instance ${DB_IDENTIFIER} already exists."
  if [[ -z "${DATABASE_URL}" || "${DATABASE_URL}" == "None" ]]; then
    echo "The database exists, but ${SECRET_NAME} was not found. Add DATABASE_URL manually."
  fi
fi

DB_ENDPOINT="$(aws rds describe-db-instances \
  --region "${AWS_REGION}" \
  --db-instance-identifier "${DB_IDENTIFIER}" \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)"

if [[ -z "${DATABASE_URL}" || "${DATABASE_URL}" == "None" ]]; then
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_ENDPOINT}:5432/${DB_NAME}?sslmode=require"
  aws secretsmanager create-secret \
    --region "${AWS_REGION}" \
    --name "${SECRET_NAME}" \
    --description "Cairn ${ENVIRONMENT} Postgres DATABASE_URL" \
    --secret-string "${DATABASE_URL}" >/dev/null 2>&1 || \
  aws secretsmanager put-secret-value \
    --region "${AWS_REGION}" \
    --secret-id "${SECRET_NAME}" \
    --secret-string "${DATABASE_URL}" >/dev/null
fi

declare -A QUEUES=(
  [SQS_RECORDING_QUEUE_URL]="${APP_NAME}-recording-${ENVIRONMENT}"
  [SQS_SYNTHESIS_QUEUE_URL]="${APP_NAME}-synthesis-${ENVIRONMENT}"
  [SQS_VERIFICATION_QUEUE_URL]="${APP_NAME}-verification-${ENVIRONMENT}"
  [SQS_INVOCATION_QUEUE_URL]="${APP_NAME}-invocation-${ENVIRONMENT}"
  [SQS_REPAIR_QUEUE_URL]="${APP_NAME}-repair-${ENVIRONMENT}"
)

for key in "${!QUEUES[@]}"; do
  queue_name="${QUEUES[$key]}"
  queue_url="$(aws sqs create-queue \
    --region "${AWS_REGION}" \
    --queue-name "${queue_name}" \
    --attributes VisibilityTimeout=300,MessageRetentionPeriod=1209600 \
    --query QueueUrl \
    --output text)"
  printf -v "${key}" "%s" "${queue_url}"
done

aws events create-event-bus \
  --region "${AWS_REGION}" \
  --name "${EVENT_BUS_NAME}" >/dev/null 2>&1 || true

cat > cairn-prod.env <<EOF
AWS_REGION=${AWS_REGION}
AWS_ACCOUNT_ID=${ACCOUNT_ID}
DATABASE_URL=${DATABASE_URL}
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false
DATABASE_POOL_MAX=3
RDS_DB_INSTANCE_IDENTIFIER=${DB_IDENTIFIER}
RDS_DB_NAME=${DB_NAME}
RDS_MASTER_USERNAME=${DB_USER}
RDS_PUBLICLY_ACCESSIBLE=${RDS_PUBLICLY_ACCESSIBLE}
RDS_ALLOWED_CIDR=${RDS_ALLOWED_CIDR}
SQS_RECORDING_QUEUE_URL=${SQS_RECORDING_QUEUE_URL}
SQS_SYNTHESIS_QUEUE_URL=${SQS_SYNTHESIS_QUEUE_URL}
SQS_VERIFICATION_QUEUE_URL=${SQS_VERIFICATION_QUEUE_URL}
SQS_INVOCATION_QUEUE_URL=${SQS_INVOCATION_QUEUE_URL}
SQS_REPAIR_QUEUE_URL=${SQS_REPAIR_QUEUE_URL}
EVENTBRIDGE_BUS_NAME=${EVENT_BUS_NAME}
SECRETS_PREFIX=${SECRETS_PREFIX:-/cairn/prod}
EOF

chmod 600 cairn-prod.env

echo "Created/verified AWS resources."
echo "Database endpoint: ${DB_ENDPOINT}"
echo "Database security group: ${SECURITY_GROUP_ID}"
echo "Allowed Postgres CIDR: ${RDS_ALLOWED_CIDR}"
echo "Database URL secret: ${SECRET_NAME}"
echo "Environment file written in CloudShell: $(pwd)/cairn-prod.env"
