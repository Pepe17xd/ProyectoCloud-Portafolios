#!/usr/bin/env pwsh
param([ValidateSet('up','down','status','init')][string]$Action = 'up')

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Compose = Join-Path $Root 'infrastructure/docker-compose.yml'

function Invoke-Compose([string[]]$Args) {
  & docker compose -f $Compose @Args
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed (exit $LASTEXITCODE)" }
}

if ($Action -eq 'down') { Invoke-Compose @('down'); exit 0 }
if ($Action -eq 'status') { Invoke-Compose @('ps'); exit 0 }
if ($Action -eq 'up') { Invoke-Compose @('up','-d','--wait') }

$Tables = @('identity','portfolio','project','resource','budget','priority')
foreach ($Name in $Tables) {
  $Table = "cloudportfolio-$Name-local"
  & aws dynamodb describe-table --table-name $Table --endpoint-url http://localhost:8000 --region us-east-1 *> $null
  if ($LASTEXITCODE -eq 0) { continue }
  & aws dynamodb create-table --table-name $Table --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE --billing-mode PAY_PER_REQUEST --endpoint-url http://localhost:8000 --region us-east-1
  if ($LASTEXITCODE -ne 0) { throw "Could not create DynamoDB Local table $Table" }
}
Write-Host "Local infrastructure is ready. DynamoDB: http://localhost:8000; LocalStack: http://localhost:4566"
