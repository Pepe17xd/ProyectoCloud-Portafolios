#!/bin/bash
set -euo pipefail
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
BUCKET="${DOCUMENTS_BUCKET:-cloudportfolio-documents-local}"
TOPIC_ARN="$(awslocal sns create-topic --name cloudportfolio-domain-local --query TopicArn --output text --region "$REGION")"
awslocal s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1 || true
awslocal s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true --region "$REGION"
awslocal sqs create-queue --queue-name cloudportfolio-domain-dlq-local --region "$REGION" >/dev/null
DLQ_URL="$(awslocal sqs get-queue-url --queue-name cloudportfolio-domain-dlq-local --query QueueUrl --output text --region "$REGION")"
DLQ_ARN="$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text --region "$REGION")"
for queue in budget project portfolio resource priority identity; do
  redrive="$(printf '{"deadLetterTargetArn":"%s","maxReceiveCount":"4"}' "$DLQ_ARN")"
  attributes="$(python3 -c 'import json,sys; print(json.dumps({"VisibilityTimeout":"120","RedrivePolicy":sys.argv[1]}))' "$redrive")"
  queue_url="$(awslocal sqs create-queue --queue-name "cloudportfolio-${queue}-local" --attributes "$attributes" --query QueueUrl --output text --region "$REGION")"
  queue_arn="$(awslocal sqs get-queue-attributes --queue-url "$queue_url" --attribute-names QueueArn --query Attributes.QueueArn --output text --region "$REGION")"
  policy="$(python3 -c 'import json,sys; print(json.dumps({"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"sns.amazonaws.com"},"Action":"sqs:SendMessage","Resource":sys.argv[1],"Condition":{"ArnEquals":{"aws:SourceArn":sys.argv[2]}}}]}))' "$queue_arn" "$TOPIC_ARN")"
  policy_attribute="$(python3 -c 'import json,sys; print(json.dumps({"Policy":sys.argv[1]}))' "$policy")"
  awslocal sqs set-queue-attributes --queue-url "$queue_url" --attributes "$policy_attribute" --region "$REGION"
  awslocal sns subscribe --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$queue_arn" --region "$REGION" >/dev/null
done
echo "LocalStack initialized: s3://${BUCKET}, ${TOPIC_ARN}, six service queues and a DLQ"
