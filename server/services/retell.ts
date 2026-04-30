const RETELL_BASE_URL = "https://api.retellai.com";

function getRetellApiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY is not configured");
  return key;
}

export function getAppBaseUrl(): string {
  const url = process.env.APP_BASE_URL;
  if (!url) {
    console.warn(
      "[Retell] APP_BASE_URL is not set — webhook URL may be incorrect. Set APP_BASE_URL to your production domain (e.g. https://yourapp.replit.app)."
    );
    const replSlug = process.env.REPL_SLUG;
    const replOwner = process.env.REPL_OWNER;
    if (replSlug && replOwner) {
      return `https://${replSlug}.${replOwner}.repl.co`;
    }
    return "";
  }
  return url.replace(/\/$/, "");
}

async function retellFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = getRetellApiKey();
  return fetch(`${RETELL_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

export async function cloneRetellAgent(params: {
  companyName: string;
  webhookUrl?: string;
}): Promise<string> {
  const templateId = process.env.RETELL_AGENT_ID;
  if (!templateId) throw new Error("RETELL_AGENT_ID is not configured — cannot clone agent");

  const getRes = await retellFetch(`/get-agent/${templateId}`);
  if (!getRes.ok) {
    const body = await getRes.text();
    throw new Error(`Retell get-agent (template) failed (${getRes.status}): ${body}`);
  }
  const template = (await getRes.json()) as Record<string, unknown>;

  const fieldsToOmit = new Set([
    "agent_id",
    "last_modification_timestamp",
    "inbound_phone_numbers",
    "outbound_phone_numbers",
    "knowledge_base_ids",
  ]);
  const agentBody: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    if (!fieldsToOmit.has(k) && v !== null && v !== undefined) {
      agentBody[k] = v;
    }
  }

  agentBody.agent_name = `${params.companyName} — ScooPilot`;
  if (params.webhookUrl) {
    agentBody.webhook_url = params.webhookUrl;
  }

  const createRes = await retellFetch("/create-agent", {
    method: "POST",
    body: JSON.stringify(agentBody),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Retell create-agent (clone) failed (${createRes.status}): ${body}`);
  }
  const created = (await createRes.json()) as { agent_id: string };
  return created.agent_id;
}

export async function provisionRetellNumber(params: {
  areaCode?: string;
  agentId?: string;
}): Promise<string> {
  const preferredAreaCode = params.areaCode?.replace(/\D/g, "").slice(0, 3) || "703";
  const agentId = params.agentId || process.env.RETELL_AGENT_ID;

  const tryAreaCode = async (areaCode: string): Promise<string[]> => {
    const res = await retellFetch(`/v2/get-available-numbers?area_code=${areaCode}&type=local`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.numbers ?? data.available_numbers ?? data.phone_numbers ?? [];
  };

  let availableNumbers = await tryAreaCode(preferredAreaCode);

  if (!availableNumbers.length && preferredAreaCode !== "800") {
    console.warn(
      `[Retell] No numbers in area code ${preferredAreaCode}, trying fallback area codes`
    );
    for (const fallback of ["206", "425", "503", "650", "214", "312"]) {
      availableNumbers = await tryAreaCode(fallback);
      if (availableNumbers.length) {
        console.log(`[Retell] Using fallback area code ${fallback}`);
        break;
      }
    }
  }

  if (!availableNumbers.length) {
    throw new Error(`No available phone numbers found (preferred area code: ${preferredAreaCode})`);
  }

  const chosenNumber = availableNumbers[0];

  const purchaseBody: Record<string, string> = { number: chosenNumber };
  if (agentId) {
    purchaseBody.inbound_agent_id = agentId;
  }

  const purchaseRes = await retellFetch("/v2/create-phone-number", {
    method: "POST",
    body: JSON.stringify(purchaseBody),
  });

  if (!purchaseRes.ok) {
    const errText = await purchaseRes.text();
    throw new Error(`Retell number purchase failed (${purchaseRes.status}): ${errText}`);
  }

  const purchaseData = await purchaseRes.json();
  const provisionedNumber: string =
    purchaseData.phone_number ?? purchaseData.number ?? chosenNumber;

  return provisionedNumber;
}

export async function getRetellAgentWebhookUrl(agentId: string): Promise<string | null> {
  const res = await retellFetch(`/get-agent/${agentId}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Retell get-agent failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { webhook_url?: string };
  return data.webhook_url ?? null;
}

export async function registerRetellWebhook(agentId: string): Promise<void> {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) {
    console.warn(
      `[Retell] Skipping webhook registration for agent ${agentId}: APP_BASE_URL is not configured`
    );
    return;
  }
  const webhookUrl = `${baseUrl}/api/webhooks/retell`;

  const patchRes = await retellFetch(`/update-agent/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({ webhook_url: webhookUrl }),
  });

  if (!patchRes.ok) {
    const body = await patchRes.text();
    throw new Error(`Retell update-agent (webhook) failed (${patchRes.status}): ${body}`);
  }

  console.log(`[Retell] Registered webhook URL "${webhookUrl}" on agent ${agentId}`);
}

export async function checkRetellWebhookSync(agentId: string): Promise<void> {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) {
    console.warn("[Retell] Cannot check webhook sync: APP_BASE_URL is not configured");
    return;
  }

  const expectedUrl = `${baseUrl}/api/webhooks/retell`;

  try {
    const registeredUrl = await getRetellAgentWebhookUrl(agentId);
    if (!registeredUrl) {
      console.warn(
        `[Retell] Webhook URL for agent ${agentId} is not set. Expected: ${expectedUrl}`
      );
      await registerRetellWebhook(agentId);
      console.log(`[Retell] Auto-corrected: registered missing webhook URL on agent ${agentId}`);
    } else if (registeredUrl !== expectedUrl) {
      console.warn(
        `[Retell] Webhook URL mismatch for agent ${agentId}. Registered: ${registeredUrl} | Expected: ${expectedUrl}`
      );
      await registerRetellWebhook(agentId);
      console.log(
        `[Retell] Auto-corrected: updated webhook URL on agent ${agentId} from "${registeredUrl}" to "${expectedUrl}"`
      );
    } else {
      console.log(`[Retell] Webhook URL for agent ${agentId} is current: ${registeredUrl}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Retell] Could not verify webhook sync for agent ${agentId}: ${message}`);
  }
}

export async function seedRetellKnowledgeBase(params: {
  tenantId: string;
  agentId: string;
  websiteUrl: string;
}): Promise<string> {
  const kbName = `${params.tenantId}_KB`;

  const createRes = await retellFetch("/create-knowledge-base", {
    method: "POST",
    body: JSON.stringify({
      knowledge_base_name: kbName,
      knowledge_base_urls: [params.websiteUrl],
      enable_auto_refresh: true,
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Retell create-knowledge-base failed (${createRes.status}): ${body}`);
  }

  const kbData = (await createRes.json()) as { knowledge_base_id: string };
  const knowledgeBaseId = kbData.knowledge_base_id;

  const baseUrl = getAppBaseUrl();
  const webhookUrl = baseUrl ? `${baseUrl}/api/webhooks/retell` : undefined;

  const patchBody: Record<string, unknown> = {
    knowledge_base_ids: [knowledgeBaseId],
  };
  if (webhookUrl) {
    patchBody.webhook_url = webhookUrl;
  }

  const patchRes = await retellFetch(`/update-agent/${params.agentId}`, {
    method: "PATCH",
    body: JSON.stringify(patchBody),
  });

  if (!patchRes.ok) {
    const body = await patchRes.text();
    throw new Error(`Retell update-agent failed (${patchRes.status}): ${body}`);
  }

  if (webhookUrl) {
    console.log(
      `[Retell] Registered webhook URL "${webhookUrl}" on agent ${params.agentId} (combined with KB patch)`
    );
  }

  return knowledgeBaseId;
}
