# Fitness Service — Migration Lambda Artifact Report

## 1. MIGRATIONS FOUND

- Found `48` Fitness Service migration SQL files.
- Packaged path: `prisma/migrations/**/migration.sql`.
- ZIP verification:
  - `MIGRATION_SQL_COUNT=48`
  - `ZIP_ENTRY_COUNT=4193`

## 2. SAFETY GUARD

Implemented in:

```text
backend/services/fitness-service/src/migrate-lambda.ts
```

The handler reads `database` from `DATABASE_SECRET_ID` SecretString and refuses to continue unless it is exactly:

```text
fitness_assistant_fitness
```

If the secret points to `fitness_assistant`, `fitness_assistant_user`, `postgres`, or any other database, the handler stops with:

```text
Refusing to run Fitness Service migrations against non-fitness database.
```

The handler does not contain `prisma db push`, `prisma migrate dev`, `prisma migrate reset`, `--accept-data-loss`, `DROP DATABASE`, or destructive database reset logic.

## 3. DATABASE CREATE SUPPORT

Implemented.

Before running migrations, the handler:

1. Loads Aurora credentials from Secrets Manager.
2. Confirms the requested target database is exactly `fitness_assistant_fitness`.
3. Connects to Aurora maintenance database `postgres` using the same credentials.
4. Checks `pg_database`.
5. Runs only:

```sql
CREATE DATABASE "fitness_assistant_fitness"
```

if the database does not already exist.

It never drops any database and never targets Auth/User DBs.

## 4. HANDLER

AWS Lambda handler:

```text
dist/migrate-lambda.handler
```

Source:

```text
backend/services/fitness-service/src/migrate-lambda.ts
```

Runtime:

```text
Node.js 22.x
x86_64
```

## 5. ENV REQUIRED

Required:

```text
AWS_REGION=ap-southeast-1
DATABASE_SECRET_ID=fitness-assistant/dev/fitness-database
```

Secret JSON must contain:

```json
{
  "username": "<aurora-master-or-migration-user>",
  "password": "<password>",
  "host": "fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com",
  "port": 5432,
  "database": "fitness_assistant_fitness"
}
```

## 6. IAM REQUIRED

Migration Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:fitness-assistant/dev/fitness-database*"
    }
  ]
}
```

Networking must allow Lambda to reach Aurora writer endpoint on PostgreSQL port `5432`.

## 7. BUILD COMMAND

From repository root:

```powershell
pnpm --filter @gym-coach/fitness-service run build:migrate-lambda-zip
```

Build result: PASS.

The script packages:

- compiled migration handler;
- Prisma CLI;
- `prisma/schema.prisma`;
- all 48 migrations;
- `schema-engine-rhel-openssl-3.0.x`;
- `libquery_engine-rhel-openssl-3.0.x.so.node`;
- production runtime dependencies.

## 8. ARTIFACT PATH

```text
backend/services/fitness-service/artifacts/fitness-migrate-lambda.zip
```

## 9. ZIP SIZE

```text
74,248,999 bytes
≈ 70.81 MB compressed
```

Because this is greater than `50 MB`, upload through S3 when using AWS Console, then select the S3 object as the Lambda code source.

## 10. AWS MANUAL SETTINGS

Manual Console settings:

1. Create Lambda, for example `fitness-assistant-dev-fitness-migrate`.
2. Runtime: `Node.js 22.x`.
3. Architecture: `x86_64`.
4. Handler: `dist/migrate-lambda.handler`.
5. Upload artifact via S3:

```text
backend/services/fitness-service/artifacts/fitness-migrate-lambda.zip
```

6. Environment variables:

```text
AWS_REGION=ap-southeast-1
DATABASE_SECRET_ID=fitness-assistant/dev/fitness-database
```

7. Attach VPC/private app subnets that can reach Aurora:

```text
fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com:5432
```

8. Attach security group allowing outbound to Aurora and Aurora inbound from Lambda SG on `5432`.
9. Set timeout high enough for real migrations, recommended `10–15 minutes`.
10. Set memory at least `1024 MB` initially for Prisma migration CLI.
11. Invoke manually once from AWS Console only after verifying the secret JSON database field is exactly `fitness_assistant_fitness`.

## 11. FINAL VERDICT

READY FOR REAL FITNESS DATABASE MIGRATION
