/**
 * V2.3A.9: read-only + inference-only smoke test against the exact
 * production-configured Bedrock inference profile
 * (apac.amazon.nova-pro-v1:0), using the Converse API (the same API
 * backend/services/ai-service/src/llm/bedrock.client.ts calls in
 * production) and the current local AWS identity's credentials. Does
 * not modify any AWS resource or source file.
 */
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const MODEL_ID = "apac.amazon.nova-pro-v1:0";
const REGION = "ap-southeast-1";

async function main() {
  const client = new BedrockRuntimeClient({ region: REGION });
  const start = Date.now();
  try {
    const res = await client.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: "You are a connectivity test. Answer with exactly OK." }],
        messages: [{ role: "user", content: [{ text: "ping" }] }],
        inferenceConfig: { maxTokens: 8, temperature: 0 },
      }),
    );
    const latencyMs = Date.now() - start;
    console.log(JSON.stringify({
      ok: true,
      latencyMs,
      requestId: res.$metadata?.requestId,
      httpStatus: res.$metadata?.httpStatusCode,
      outputText: res.output?.message?.content?.[0]?.text,
      stopReason: res.stopReason,
      usage: res.usage,
    }));
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
