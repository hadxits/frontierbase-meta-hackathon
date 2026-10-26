# Ingest worker function

`ingestWorker` is the Cloud Tasks target for dataset ingest. The legacy
`workerTask -> ingest-worker-job` path remains available until
`INGEST_FUNCTION_URL` is set.

## Runtime contract

- ingestWorker is Cloud Tasks OIDC only. Statuspage and `wakeUpInstances`
  probe it with an ID token (`x-health-check`). Grant `roles/run.invoker` on
  ingestworker to those schedulers' service accounts.
- Configure Direct VPC egress (`default` network/subnet, `private-ranges-only`)
  so the function can reach the private Qdrant address.
- Set `INGEST_FUNCTION_URL` after a small ingest succeeds. Removing it returns
  enqueueing to `WORKER_FUNCTION_URL` and the Job payload.
- Keep the task dispatch deadline (`1250s`) above the function timeout
  (`1200s`), and keep queue concurrency aligned with `maxInstances: 5`.

```sh
gcloud run services update ingestworker \
  --project=frontierbase-console \
  --region=us-central1 \
  --network=default \
  --subnet=default \
  --vpc-egress=private-ranges-only

gcloud tasks queues update worker-queue \
  --project=frontierbase-console \
  --location=us-central1 \
  --max-concurrent-dispatches=5 \
  --max-dispatches-per-second=5 \
  --max-attempts=3
```

## Token ledger

Embedding usage is applied once per `job_id` under
`tenants/{tenant}/ingest_token_usage_ledger/{jobIdHash}`.

## Cutover and rollback

1. Deploy `ingestWorker`.
2. Configure Direct VPC.
3. Run a small dataset ingest.
4. Set `INGEST_FUNCTION_URL`.
5. To roll back, remove `INGEST_FUNCTION_URL`.
