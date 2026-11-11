/**
 * V2.3A.9.2: bounded, diagnostic-only, multi-region Bedrock smoke probe.
 * Takes region + modelId + api ("converse"|"invoke") as CLI args. Sends
 * exactly one tiny synthetic request, never real Gymini data, never
 * modifies any AWS resource. Read-only diagnostic, mirrors the exact
 * request shape used in v2.3a9's single-region probe.
 */
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const [region, modelId, api] = process.argv.slice(2);
if (!region || !modelId || !api) {
  console.error("usage: tsx bedrock_region_probe.ts <region> <modelId> <converse|invoke>");
  process.exit(1);
}

async function main() {
  const client = new BedrockRuntimeClient({ region });
  const start = Date.now();
  try {
    let outputText: string | undefined;
    let requestId: string | undefined;
    let httpStatus: number | undefined;
    if (api === "converse") {
      const res = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: "You are a connectivity test. Reply with exactly OK." }],
          messages: [{ role: "user", content: [{ text: "ping" }] }],
          inferenceConfig: { maxTokens: 16, temperature: 0 },
        }),
      );
      outputText = res.output?.message?.content?.[0]?.text;
      requestId = res.$metadata?.requestId;
      httpStatus = res.$metadata?.httpStatusCode;
    } else {
      const res = await client.send(
        new InvokeModelCommand({
          modelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            system: [{ text: "You are a connectivity test. Reply with exactly OK." }],
            messages: [{ role: "user", content: [{ text: "ping" }] }],
            inferenceConfig: { maxTokens: 16, temperature: 0 },
          }),
        }),
      );
      outputText = Buffer.from(res.body as Uint8Array).toString("utf8");
      requestId = res.$metadata?.requestId;
      httpStatus = res.$metadata?.httpStatusCode;
    }
    console.log(JSON.stringify({ region, modelId, api, ok: true, latencyMs: Date.now() - start, httpStatus, requestId, outputText }));
  } catch (err: any) {
    console.log(JSON.stringify({
      region, modelId, api, ok: false, latencyMs: Date.now() - start,
      errorName: err?.name, httpStatus: err?.$metadata?.httpStatusCode,
      requestId: err?.$metadata?.requestId, message: err?.message,
    }));
  }
}

main();
