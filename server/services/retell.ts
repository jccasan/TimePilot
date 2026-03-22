const RETELL_BASE_URL = "https://api.retellai.com";

function getRetellApiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY is not configured");
  return key;
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

export async function provisionRetellNumber(params: {
  areaCode?: string;
}): Promise<string> {
  const areaCode = params.areaCode?.replace(/\D/g, "").slice(0, 3) || "703";
  const agentId = process.env.RETELL_AGENT_ID;

  const searchRes = await retellFetch(
    `/v2/get-available-numbers?area_code=${areaCode}&type=local`,
  );

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Retell number search failed (${searchRes.status}): ${errText}`);
  }

  const searchData = await searchRes.json();
  const availableNumbers: string[] =
    searchData.numbers ?? searchData.available_numbers ?? searchData.phone_numbers ?? [];

  if (!availableNumbers.length) {
    throw new Error(`No available numbers found for area code ${areaCode}`);
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

  const kbData = await createRes.json() as { knowledge_base_id: string };
  const knowledgeBaseId = kbData.knowledge_base_id;

  const patchRes = await retellFetch(`/update-agent/${params.agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      knowledge_base_ids: [knowledgeBaseId],
    }),
  });

  if (!patchRes.ok) {
    const body = await patchRes.text();
    throw new Error(`Retell update-agent failed (${patchRes.status}): ${body}`);
  }

  return knowledgeBaseId;
}
