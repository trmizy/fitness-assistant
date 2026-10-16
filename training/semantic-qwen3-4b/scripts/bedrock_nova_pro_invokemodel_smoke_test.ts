/**
 * V2.3A.9 diagnostic-only addendum: same model/profile, but via the
 * legacy InvokeModel API instead of Converse, to classify whether the
 * "ValidationException: Operation not allowed" error is specific to the
 * Converse API path or applies to the inference profile/model itself
 * regardless of which Bedrock Runtime API is used. Read-only/inference
 * only, no resource or source-file modification.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const MODEL_ID = "apac.amazon.nova-pro-v1:0";
const REGION = "ap-southeast-1";

async function main() {
  const client = new BedrockRuntimeClient({ region: REGION });
  const start = Date.now();
  try {
    const res = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          system: [{ text: "You are a connectivity test. Answer with exactly OK." }],
          messages: [{ role: "user", content: [{ text: "ping" }] }],
          inferenceConfig: { maxTokens: 8, temperature: 0 },
        }),
      }),
    );
    const latencyMs = Date.now() - start;
    const bodyText = Buffer.from(res.body as Uint8Array).toString("utf8");
    console.log(JSON.stringify({ ok: true, latencyMs, requestId: res.$metadata?.requestId, httpStatus: res.$metadata?.httpStatusCode, body: bodyText }));
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    console.log(JSON.stringify({
      ok: false,
      latencyMs,
      errorName: err?.name,
      httpStatus: err?.$metadata?.httpStatusCode,
      requestId: err?.$metadata?.requestId,
      message: err?.message,
    }));
  }
}

main();
