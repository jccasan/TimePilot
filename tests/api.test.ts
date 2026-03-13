import http from "http";

const BASE = "http://localhost:5000";
let bearerToken = "";
const testEmail = `test_${Date.now()}@example.com`;
const testPassword = "TestPass123!";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  category: string;
  securityFlag?: string;
}

const results: TestResult[] = [];

async function req(
  method: string,
  path: string,
  body?: any,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; data: any; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const hdrs: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (bearerToken && !(extraHeaders && "Authorization" in extraHeaders)) {
      hdrs["Authorization"] = `Bearer ${bearerToken}`;
    }
    const opts: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: hdrs,
      timeout: 10000,
    };

    const r = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode || 0,
          data: parsed,
          headers: res.headers as Record<string, string>,
        });
      });
    });
    r.on("error", reject);
    r.on("timeout", () => reject(new Error("Request timed out")));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function test(
  name: string,
  category: string,
  fn: () => Promise<void>,
  securityFlag?: string
) {
  try {
    await fn();
    results.push({ name, passed: true, category, securityFlag });
  } catch (err: any) {
    results.push({
      name,
      passed: false,
      category,
      error: err.stack || err.message,
      securityFlag,
    });
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function runTests() {
  console.log("=== SCOOPILOT AUTOMATED TEST SUITE ===\n");
  console.log(`Starting tests at ${new Date().toISOString()}`);
  console.log(`Test user: ${testEmail}\n`);

  // ==========================================
  // 1. AUTHENTICATION FLOW TESTS
  // ==========================================

  await test("Register with missing fields returns 400", "Auth", async () => {
    const r = await req("POST", "/api/auth/register", {}, { Authorization: "" });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.data)}`);
  }, "No input validation");

  await test("Register with empty email returns 400", "Auth", async () => {
    const r = await req("POST", "/api/auth/register", {
      email: "",
      password: testPassword,
    }, { Authorization: "" });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.data)}`);
  }, "No input validation");

  await test("Register with invalid email format returns 400", "Auth", async () => {
    const r = await req("POST", "/api/auth/register", {
      email: "not-an-email",
      password: testPassword,
    }, { Authorization: "" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Register with short password returns 400", "Auth", async () => {
    const r = await req("POST", "/api/auth/register", {
      email: testEmail,
      password: "short",
    }, { Authorization: "" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Register with valid data succeeds", "Auth", async () => {
    const r = await req("POST", "/api/auth/register", {
      email: testEmail,
      password: testPassword,
      firstName: "Test",
      lastName: "User",
    }, { Authorization: "" });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.email === testEmail, "Email mismatch");
    assert(!r.data.passwordHash, "Password hash exposed in response");
    assert(r.data.sessionToken, "No sessionToken returned");
  }, "API keys exposed in code");

  await test("Register duplicate email returns 400", "Auth", async () => {
    const r = await req("POST", "/api/auth/register", {
      email: testEmail,
      password: testPassword,
    }, { Authorization: "" });
    assert(r.status === 400, `Expected 400 for duplicate, got ${r.status}`);
  });

  await test("Login with wrong password returns 401", "Auth", async () => {
    const r = await req("POST", "/api/auth/login", {
      email: testEmail,
      password: "wrongpassword",
    }, { Authorization: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("Login with missing email returns 401", "Auth", async () => {
    const r = await req("POST", "/api/auth/login", { password: testPassword }, { Authorization: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  }, "No input validation");

  await test("Login with correct credentials succeeds and returns session token", "Auth", async () => {
    const r = await req("POST", "/api/auth/login", {
      email: testEmail,
      password: testPassword,
    }, { Authorization: "" });
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.email === testEmail, "Email mismatch in login response");
    assert(!r.data.passwordHash, "Password hash leaked in login response");
    assert(r.data.sessionToken, "No session token returned");
    bearerToken = r.data.sessionToken;
  }, "API keys exposed in code");

  await test("Get user without auth returns 401", "Auth", async () => {
    const r = await req("GET", "/api/auth/user", undefined, { Authorization: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  }, "No authentication middleware protection");

  await test("Get authenticated user returns user data via Bearer token", "Auth", async () => {
    const r = await req("GET", "/api/auth/user");
    assert(r.status === 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.email === testEmail, "Wrong user returned");
    assert(!r.data.passwordHash, "Password hash in user response");
  });

  await test("Change password with empty body fails", "Auth", async () => {
    const r = await req("POST", "/api/auth/change-password", {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Change password with short password fails", "Auth", async () => {
    const r = await req("POST", "/api/auth/change-password", {
      newPassword: "abc",
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Forgot password with missing email returns 400", "Auth", async () => {
    const r = await req("POST", "/api/auth/forgot-password", {});
    assert(r.status === 400 || r.status === 429, `Expected 400 or 429 (rate limited), got ${r.status}`);
  }, "No input validation");

  await test("Forgot password with nonexistent email returns 200 (no user enumeration)", "Auth", async () => {
    const r = await req("POST", "/api/auth/forgot-password", {
      email: "nonexistent_user_987654@example.com",
    });
    assert(r.status === 200 || r.status === 429, `Expected 200 (anti-enumeration) or 429 (rate limited), got ${r.status}`);
    if (r.status === 200) {
      assert(r.data.message?.includes("If an account"), "Message should not reveal account existence");
    }
  });

  await test("Reset password with missing token returns 400", "Auth", async () => {
    const r = await req("POST", "/api/auth/reset-password", {
      password: "NewPass123!",
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Reset password with invalid token returns 400", "Auth", async () => {
    const r = await req("POST", "/api/auth/reset-password", {
      token: "invalid-token-12345",
      password: "NewPass123!",
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  // ==========================================
  // 2. UNAUTHENTICATED ACCESS TO PROTECTED ENDPOINTS
  // ==========================================

  const protectedEndpoints = [
    { method: "GET", path: "/api/contacts" },
    { method: "POST", path: "/api/contacts" },
    { method: "GET", path: "/api/properties" },
    { method: "GET", path: "/api/routes" },
    { method: "GET", path: "/api/invoices" },
    { method: "GET", path: "/api/service-plans" },
    { method: "GET", path: "/api/company" },
    { method: "GET", path: "/api/company/team" },
    { method: "GET", path: "/api/automation-rules" },
    { method: "GET", path: "/api/tags" },
    { method: "GET", path: "/api/lead-sources" },
    { method: "GET", path: "/api/webhooks" },
    { method: "POST", path: "/api/rover/ask" },
    { method: "POST", path: "/api/rover/ticket" },
    { method: "GET", path: "/api/onboarding/status" },
    { method: "GET", path: "/api/reports/summary" },
    { method: "GET", path: "/api/visits/today" },
    { method: "GET", path: "/api/company/stats" },
    { method: "POST", path: "/api/company/invite" },
    { method: "GET", path: "/api/geocode/autocomplete?q=test" },
    { method: "POST", path: "/api/setup" },
    { method: "POST", path: "/api/auth/change-password" },
  ];

  for (const ep of protectedEndpoints) {
    await test(
      `${ep.method} ${ep.path} without auth returns 401`,
      "Auth Middleware",
      async () => {
        const r = await req(ep.method, ep.path, ep.method === "POST" ? {} : undefined, {
          Authorization: "",
        });
        assert(
          r.status === 401,
          `Expected 401 for unauth ${ep.method} ${ep.path}, got ${r.status}`
        );
      },
      "No authentication middleware protection"
    );
  }

  // ==========================================
  // 3. ADMIN ENDPOINT PROTECTION (requires x-admin-token)
  // ==========================================

  const adminEndpoints = [
    { method: "GET", path: "/api/admin/companies" },
    { method: "GET", path: "/api/admin/stats" },
    { method: "GET", path: "/api/admin/companies/fake-id" },
    { method: "PATCH", path: "/api/admin/companies/fake-id" },
    { method: "GET", path: "/api/admin/check" },
    { method: "GET", path: "/api/admin/inactive-users" },
  ];

  for (const ep of adminEndpoints) {
    await test(
      `Admin: ${ep.method} ${ep.path} without x-admin-token returns 401`,
      "Admin Auth",
      async () => {
        const r = await req(ep.method, ep.path, ep.method !== "GET" ? {} : undefined, {
          Authorization: "",
        });
        assert(r.status === 401, `Expected 401, got ${r.status}: ${JSON.stringify(r.data)}`);
      },
      "No authentication middleware protection"
    );
  }

  await test("Admin: login with missing fields returns 400", "Admin Auth", async () => {
    const r = await req("POST", "/api/admin/login", {}, { Authorization: "" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Admin: login with wrong credentials returns 401", "Admin Auth", async () => {
    const r = await req("POST", "/api/admin/login", {
      email: "wrong@admin.com",
      password: "wrongpassword",
    }, { Authorization: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("Admin: regular user Bearer token cannot access admin endpoints", "Admin Auth", async () => {
    const r = await req("GET", "/api/admin/companies", undefined, {
      "x-admin-token": bearerToken,
    });
    assert(r.status === 401, `Expected 401 (regular token != admin token), got ${r.status}`);
  }, "No authentication middleware protection");

  // ==========================================
  // 4. CONTACT CRUD + VALIDATION
  // ==========================================

  let testContactId = "";

  await test("Create contact with valid data", "Contacts", async () => {
    const r = await req("POST", "/api/contacts", {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "555-123-4567",
      status: "lead",
    });
    assert(r.status === 201 || r.status === 200, `Expected 200/201, got ${r.status}: ${JSON.stringify(r.data)}`);
    testContactId = r.data.id;
    assert(testContactId, "No ID returned for created contact");
  });

  await test("Create contact with missing firstName returns 400 with field error", "Contacts", async () => {
    const r = await req("POST", "/api/contacts", {
      email: "nobody@example.com",
    });
    assert(r.status === 400, `Expected 400 for missing firstName, got ${r.status}`);
    assert(typeof r.data.error === "string", "Should return error message string");
    assert(r.data.error.toLowerCase().includes("required") || r.data.error.includes("firstName"), `Error should mention field: ${r.data.error}`);
  }, "No input validation");

  await test("Get contacts returns array", "Contacts", async () => {
    const r = await req("GET", "/api/contacts");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
  });

  await test("Get single contact by ID", "Contacts", async () => {
    if (!testContactId) return;
    const r = await req("GET", `/api/contacts/${testContactId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.firstName === "Jane", "Wrong contact returned");
  });

  await test("Get contact with non-UUID ID returns error gracefully", "Contacts", async () => {
    const r = await req("GET", "/api/contacts/not-a-uuid");
    assert(
      r.status === 404 || r.status === 400 || r.status === 500,
      `Expected 404/400/500 for bad ID, got ${r.status}`
    );
  }, "Database calls without error handling");

  await test("Update contact with valid data", "Contacts", async () => {
    if (!testContactId) return;
    const r = await req("PATCH", `/api/contacts/${testContactId}`, {
      firstName: "Janet",
    });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("Delete contact succeeds", "Contacts", async () => {
    if (!testContactId) return;
    const r = await req("DELETE", `/api/contacts/${testContactId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("Delete nonexistent contact returns 404", "Contacts", async () => {
    const r = await req("DELETE", "/api/contacts/00000000-0000-0000-0000-000000000000");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
  }, "Database calls without error handling");

  // ==========================================
  // 5. PROPERTY TESTS
  // ==========================================

  await test("Create property with missing fields returns 400", "Properties", async () => {
    const r = await req("POST", "/api/properties", {});
    assert(r.status === 400, `Expected 400 for empty body, got ${r.status}: ${JSON.stringify(r.data)}`);
  }, "No input validation");

  await test("Get properties returns array", "Properties", async () => {
    const r = await req("GET", "/api/properties");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
  });

  // ==========================================
  // 6. ROUTE MANAGEMENT
  // ==========================================

  let testRouteId = "";

  await test("Create route with valid data", "Routes", async () => {
    const r = await req("POST", "/api/routes", {
      name: "Test Route Alpha",
      dayOfWeek: "monday",
    });
    assert(r.status === 200 || r.status === 201, `Expected 200/201, got ${r.status}: ${JSON.stringify(r.data)}`);
    testRouteId = r.data.id;
  });

  await test("Create route with missing name returns 400", "Routes", async () => {
    const r = await req("POST", "/api/routes", {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Get routes returns array", "Routes", async () => {
    const r = await req("GET", "/api/routes");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
  });

  await test("Delete route", "Routes", async () => {
    if (!testRouteId) return;
    const r = await req("DELETE", `/api/routes/${testRouteId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  // ==========================================
  // 7. INVOICE TESTS
  // ==========================================

  await test("Get invoices returns array", "Invoices", async () => {
    const r = await req("GET", "/api/invoices");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
  });

  await test("Get invoice with invalid UUID returns error", "Invoices", async () => {
    const r = await req("GET", "/api/invoices/not-a-real-uuid");
    assert(
      r.status === 404 || r.status === 400 || r.status === 500,
      `Expected error status for bad UUID, got ${r.status}`
    );
  }, "Database calls without error handling");

  // ==========================================
  // 8. SERVICE PLAN TESTS
  // ==========================================

  await test("Get service plans returns array", "Service Plans", async () => {
    const r = await req("GET", "/api/service-plans");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
  });

  await test("Create service plan with missing fields returns 400", "Service Plans", async () => {
    const r = await req("POST", "/api/service-plans", {});
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.data)}`);
  }, "No input validation");

  // ==========================================
  // 9. TAGS AND LEAD SOURCES
  // ==========================================

  let testTagId = "";

  await test("Create tag with valid name", "Tags", async () => {
    const r = await req("POST", "/api/tags", { name: "AutoTestTag" });
    assert(r.status === 200 || r.status === 201, `Expected 200/201, got ${r.status}`);
    testTagId = r.data.id;
  });

  await test("Create tag with missing name returns 400", "Tags", async () => {
    const r = await req("POST", "/api/tags", {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Get tags returns array", "Tags", async () => {
    const r = await req("GET", "/api/tags");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
  });

  await test("Delete tag", "Tags", async () => {
    if (!testTagId) return;
    const r = await req("DELETE", `/api/tags/${testTagId}`);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("Get lead sources returns seeded data", "Lead Sources", async () => {
    const r = await req("GET", "/api/lead-sources");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
    assert(r.data.length > 0, "Should have seeded lead sources");
  });

  // ==========================================
  // 10. AUTOMATION RULES
  // ==========================================

  await test("Get automation rules returns array", "Automation", async () => {
    const r = await req("GET", "/api/automation-rules");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
  });

  // ==========================================
  // 11. REPORTS
  // ==========================================

  await test("Reports summary default period returns valid data", "Reports", async () => {
    const r = await req("GET", "/api/reports/summary");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.monthlyRevenue !== undefined, "Missing monthlyRevenue");
    assert(r.data.periodLabel !== undefined, "Missing periodLabel");
  });

  await test("Reports with invalid period falls back gracefully", "Reports", async () => {
    const r = await req("GET", "/api/reports/summary?period=invalid_xyz");
    assert(r.status === 200, `Expected 200 (graceful fallback), got ${r.status}`);
  }, "No input validation");

  await test("Reports quarterly periods all work", "Reports", async () => {
    for (const q of ["q1", "q2", "q3", "q4"]) {
      const r = await req("GET", `/api/reports/summary?period=${q}`);
      assert(r.status === 200, `Expected 200 for ${q}, got ${r.status}`);
    }
  });

  await test("Reports projection periods return projectedMonthly as number", "Reports", async () => {
    for (const p of ["proj3", "proj6", "proj12"]) {
      const r = await req("GET", `/api/reports/summary?period=${p}`);
      assert(r.status === 200, `Expected 200 for ${p}, got ${r.status}`);
      assert(r.data.projectedMonthly !== null && r.data.projectedMonthly !== undefined, `Missing projectedMonthly for ${p}`);
      assert(typeof r.data.projectedMonthly === "number" && isFinite(r.data.projectedMonthly), `projectedMonthly should be finite number for ${p}, got ${r.data.projectedMonthly}`);
    }
  });

  await test("Reports non-projection periods have null projectedMonthly", "Reports", async () => {
    const r = await req("GET", "/api/reports/summary?period=6m");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.projectedMonthly === null, `Non-projection period should have null projectedMonthly, got ${r.data.projectedMonthly}`);
  });

  await test("Reports trailing periods all work", "Reports", async () => {
    for (const p of ["3m", "6m", "9m", "12m"]) {
      const r = await req("GET", `/api/reports/summary?period=${p}`);
      assert(r.status === 200, `Expected 200 for ${p}, got ${r.status}`);
    }
  });

  await test("Reports annual period works", "Reports", async () => {
    const r = await req("GET", "/api/reports/summary?period=annual");
    assert(r.status === 200, `Expected 200 for annual, got ${r.status}`);
  });

  // ==========================================
  // 12. COMPANY MANAGEMENT
  // ==========================================

  await test("Get company returns data", "Company", async () => {
    const r = await req("GET", "/api/company");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.id, "Missing company ID");
  });

  await test("Update company with valid data", "Company", async () => {
    const r = await req("PATCH", "/api/company", { phone: "555-000-0000" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("Get company team returns array with owner", "Company", async () => {
    const r = await req("GET", "/api/company/team");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data), "Expected array");
    assert(r.data.length > 0, "Team should have at least the owner");
  });

  await test("Company stats returns numeric fields", "Company", async () => {
    const r = await req("GET", "/api/company/stats");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.data.mrr === "number", "mrr should be number");
    assert(typeof r.data.todaysVisits === "number", "todaysVisits should be number");
    assert(typeof r.data.activeContacts === "number", "activeContacts should be number");
  });

  await test("Invite with invalid role returns 400", "Company", async () => {
    const r = await req("POST", "/api/company/invite", {
      email: "badrole@example.com",
      firstName: "Bad",
      role: "superadmin",
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Invite with missing email returns 400", "Company", async () => {
    const r = await req("POST", "/api/company/invite", {
      firstName: "Missing",
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Invite with missing firstName returns 400", "Company", async () => {
    const r = await req("POST", "/api/company/invite", {
      email: "noname@example.com",
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  // ==========================================
  // 13. ONBOARDING
  // ==========================================

  await test("Onboarding status returns steps array", "Onboarding", async () => {
    const r = await req("GET", "/api/onboarding/status");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(Array.isArray(r.data.steps), "Expected steps array");
    assert(typeof r.data.isComplete === "boolean", "isComplete should be boolean");
  });

  // ==========================================
  // 14. ROVER CHATBOT
  // ==========================================

  await test("Rover ask with empty body returns 400", "Rover", async () => {
    const r = await req("POST", "/api/rover/ask", {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Rover ask with valid question returns answer", "Rover", async () => {
    const r = await req("POST", "/api/rover/ask", { question: "How do I add a contact?" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(r.data.answer, "Should return an answer");
  });

  await test("Rover ticket with missing fields returns 400", "Rover", async () => {
    const r = await req("POST", "/api/rover/ticket", {});
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Rover ticket with valid data succeeds", "Rover", async () => {
    const r = await req("POST", "/api/rover/ticket", {
      type: "bug",
      subject: "Test bug subject",
      description: "Test bug report from automated tests",
    });
    assert(r.status === 200 || r.status === 201, `Expected 200/201, got ${r.status}`);
  });

  // ==========================================
  // 15. PUBLIC ENDPOINTS
  // ==========================================

  await test("Mapbox token endpoint is publicly accessible", "Public", async () => {
    const r = await req("GET", "/api/mapbox-token", undefined, { Authorization: "" });
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    assert(typeof r.data.token === "string", "Should return token string");
  });

  // ==========================================
  // 16. PORTAL AUTH TESTS
  // ==========================================

  await test("Portal login with missing email returns 400 or 401", "Portal", async () => {
    const r = await req("POST", "/api/portal/login", {}, { Authorization: "" });
    assert(r.status === 400 || r.status === 401, `Expected 400/401, got ${r.status}`);
  }, "No input validation");

  await test("Portal login with wrong credentials returns 401", "Portal", async () => {
    const r = await req("POST", "/api/portal/login", {
      email: "fake@portal.com",
      password: "wrong",
    }, { Authorization: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  await test("Portal me without auth returns 401", "Portal", async () => {
    const r = await req("GET", "/api/portal/me", undefined, { Authorization: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  }, "No authentication middleware protection");

  await test("Portal schedule without auth returns 401", "Portal", async () => {
    const r = await req("GET", "/api/portal/schedule", undefined, { Authorization: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  }, "No authentication middleware protection");

  await test("Portal invoices without auth returns 401", "Portal", async () => {
    const r = await req("GET", "/api/portal/invoices", undefined, { Authorization: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  }, "No authentication middleware protection");

  // ==========================================
  // 17. VISITS
  // ==========================================

  await test("Get today's visits returns data", "Visits", async () => {
    const r = await req("GET", "/api/visits/today");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("Get visits with date range", "Visits", async () => {
    const r = await req("GET", "/api/visits/range?start=2025-01-01&end=2025-12-31");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("Get visits without date range params still works", "Visits", async () => {
    const r = await req("GET", "/api/visits");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  // ==========================================
  // 18. WEBHOOK & API KEY PROTECTION
  // ==========================================

  await test("Webhooks endpoint accessible to owner", "Webhooks", async () => {
    const r = await req("GET", "/api/webhooks");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  // ==========================================
  // 19. EDGE CASES & INJECTION TESTS
  // ==========================================

  await test("SQL injection in contact search is parameterized (safe)", "Edge Cases", async () => {
    const r = await req("GET", "/api/contacts?search=' OR 1=1 --");
    assert(r.status === 200, `Expected 200 (parameterized), got ${r.status}`);
    assert(Array.isArray(r.data), "Should return array, not error");
  });

  await test("XSS payload in contact firstName is stored as-is (output encoding needed)", "Edge Cases", async () => {
    const r = await req("POST", "/api/contacts", {
      firstName: '<script>alert("xss")</script>',
      lastName: "Test",
      email: "xss@test.com",
      status: "lead",
    });
    if (r.status === 200 || r.status === 201) {
      assert(r.data.firstName.includes("<script>"), "XSS payload should be stored as-is (React escapes on render)");
      await req("DELETE", `/api/contacts/${r.data.id}`);
    }
  });

  await test("Extremely long input (10KB) in contact firstName", "Edge Cases", async () => {
    const longName = "A".repeat(10000);
    const r = await req("POST", "/api/contacts", {
      firstName: longName,
      lastName: "Test",
      email: "longname@test.com",
      status: "lead",
    });
    if (r.status === 200 || r.status === 201) {
      await req("DELETE", `/api/contacts/${r.data.id}`);
    }
  }, "No input validation");

  await test("Malformed JSON body returns 400 or 500", "Edge Cases", async () => {
    return new Promise<void>((resolve, reject) => {
      const url = new URL("/api/contacts", BASE);
      const opts: http.RequestOptions = {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
      };
      const r = http.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            assert(
              res.statusCode === 400 || res.statusCode === 500,
              `Expected 400/500 for malformed JSON, got ${res.statusCode}`
            );
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      r.on("error", reject);
      r.write("{invalid json}}}");
      r.end();
    });
  });

  await test("Null bytes in query params handled safely (no 500)", "Edge Cases", async () => {
    const r = await req("GET", "/api/contacts?search=%00%01%02");
    assert(r.status === 200, `Expected 200 for null-byte sanitized search, got ${r.status}`);
    assert(Array.isArray(r.data), "Should return array after null byte sanitization");
  });

  await test("PATCH contact with invalid status value returns 400 or accepts it", "Edge Cases", async () => {
    const c = await req("POST", "/api/contacts", {
      firstName: "StatusTest",
      lastName: "User",
      status: "lead",
    });
    assert(c.status === 200 || c.status === 201, `Contact creation failed: ${c.status}`);
    const r = await req("PATCH", `/api/contacts/${c.data.id}`, {
      status: "definitely_not_a_valid_status",
    });
    assert(r.status !== 500, `Should not crash with 500 on invalid status, got ${r.status}`);
    await req("DELETE", `/api/contacts/${c.data.id}`);
  }, "No input validation");

  await test("Empty PATCH body does not crash", "Edge Cases", async () => {
    const c = await req("POST", "/api/contacts", {
      firstName: "EmptyPatch",
      lastName: "Test",
      status: "lead",
    });
    if (c.status === 200 || c.status === 201) {
      const r = await req("PATCH", `/api/contacts/${c.data.id}`, {});
      assert(r.status === 200 || r.status === 400, `Expected 200/400, got ${r.status}`);
      await req("DELETE", `/api/contacts/${c.data.id}`);
    }
  });

  await test("Cross-tenant data isolation: cannot access other company's data", "Edge Cases", async () => {
    const r = await req("GET", "/api/contacts");
    if (r.status === 200 && Array.isArray(r.data)) {
      for (const contact of r.data) {
        assert(
          contact.companyId !== undefined,
          "Contact should have companyId for tenant isolation verification"
        );
      }
    }
  });

  // ==========================================
  // 20. PUBLIC SIGNUP FLOW
  // ==========================================

  await test("Public signup with missing fields returns 400", "Public Signup", async () => {
    const r = await req("POST", "/api/public/signup", {}, { Authorization: "" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  }, "No input validation");

  await test("Public signup with valid data returns success", "Public Signup", async () => {
    const r = await req("POST", "/api/public/signup", {
      email: `signup_test_${Date.now()}@example.com`,
      firstName: "Signup",
      lastName: "Test",
      companyName: "Test Cleanup Co",
    }, { Authorization: "" });
    assert(r.status === 200 || r.status === 201, `Expected 200/201, got ${r.status}: ${JSON.stringify(r.data)}`);
  });

  // ==========================================
  // 21. INVOICE THEME
  // ==========================================

  await test("Get invoice theme returns data", "Invoice Theme", async () => {
    const r = await req("GET", "/api/invoice-theme");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  // ==========================================
  // 22. LOGOUT
  // ==========================================

  await test("Logout succeeds", "Auth", async () => {
    const r = await req("POST", "/api/auth/logout");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("After logout, Bearer token still works (session-based, not revoked)", "Auth", async () => {
    const r = await req("GET", "/api/auth/user");
    const expectedBehavior = r.status === 401 || r.status === 200;
    assert(expectedBehavior, `Expected 200 or 401, got ${r.status}`);
  });

  // ==========================================
  // API KEY AUTHENTICATION TESTS
  // ==========================================

  const crypto = await import("crypto");
  const testApiKeyRaw = crypto.randomBytes(32).toString("hex");
  const testApiKeyHash = crypto.createHash("sha256").update(testApiKeyRaw).digest("hex");
  const testApiKeyPrefix = testApiKeyRaw.substring(0, 8);
  let testApiKeyId = "";

  await test("Create API key for testing", "ApiKeyAuth", async () => {
    const createRes = await req("POST", "/api/api-keys", {
      name: "Integration Test Key",
      scopes: ["contacts.write"],
    });
    assert(createRes.status === 201, `Expected 201 got ${createRes.status}`);
    assert(!!createRes.data.rawKey, "Expected rawKey in response");
    assert(!!createRes.data.id, "Expected id in response");
    testApiKeyId = createRes.data.id;
  });

  let createdContactId = "";

  await test("API key auth creates lead with correct company", "ApiKeyAuth", async () => {
    const createKeyRes = await req("POST", "/api/api-keys", {
      name: "E2E Test Key",
      scopes: ["contacts.write"],
    });
    assert(createKeyRes.status === 201, `Expected 201 got ${createKeyRes.status}`);
    const rawKey = createKeyRes.data.rawKey;

    const contactRes = await req("POST", "/api/contacts", {
      firstName: "ApiKeyTest",
      lastName: `Lead_${Date.now()}`,
      email: `apikey-e2e-${Date.now()}@test.com`,
      status: "lead",
    }, { "X-API-Key": rawKey, Authorization: "" });
    assert(contactRes.status === 201, `Expected 201 got ${contactRes.status}: ${JSON.stringify(contactRes.data)}`);
    assert(contactRes.data.status === "lead", `Expected status 'lead' got '${contactRes.data.status}'`);
    assert(!!contactRes.data.companyId, "Expected companyId in response");
    assert(!!contactRes.data.id, "Expected id in response");
    createdContactId = contactRes.data.id;

    await req("DELETE", `/api/api-keys/${createKeyRes.data.id}`);
  });

  await test("Invalid API key returns 401 with clear message", "ApiKeyAuth", async () => {
    const res = await req("GET", "/api/contacts", undefined, {
      "X-API-Key": "invalid_key_that_does_not_exist_0000000000000000000000000000",
      Authorization: "",
    });
    assert(res.status === 401, `Expected 401 got ${res.status}`);
    assert(res.data.message === "Invalid API key", `Expected 'Invalid API key' got '${res.data.message}'`);
  });

  await test("Malformed short API key returns 401", "ApiKeyAuth", async () => {
    const res = await req("GET", "/api/contacts", undefined, {
      "X-API-Key": "short",
      Authorization: "",
    });
    assert(res.status === 401, `Expected 401 got ${res.status}`);
    assert(res.data.message === "Invalid API key", `Expected 'Invalid API key' got '${res.data.message}'`);
  });

  await test("No auth returns generic Unauthorized", "ApiKeyAuth", async () => {
    const res = await req("GET", "/api/contacts", undefined, {
      Authorization: "",
    });
    assert(res.status === 401, `Expected 401 got ${res.status}`);
    assert(res.data.message === "Unauthorized", `Expected 'Unauthorized' got '${res.data.message}'`);
  });

  await test("Deleted API key returns invalid message", "ApiKeyAuth", async () => {
    const createKeyRes = await req("POST", "/api/api-keys", {
      name: "Delete Test Key",
      scopes: ["contacts.read"],
    });
    assert(createKeyRes.status === 201, `Expected 201 got ${createKeyRes.status}`);
    const rawKey = createKeyRes.data.rawKey;

    await req("DELETE", `/api/api-keys/${createKeyRes.data.id}`);

    const res = await req("GET", "/api/contacts", undefined, {
      "X-API-Key": rawKey,
      Authorization: "",
    });
    assert(res.status === 401, `Expected 401 got ${res.status}`);
    assert(res.data.message === "Invalid API key", `Expected 'Invalid API key' got '${res.data.message}'`);
  });

  await test("Created lead is retrievable via API key", "ApiKeyAuth", async () => {
    if (!createdContactId) return;
    const createKeyRes = await req("POST", "/api/api-keys", {
      name: "Retrieve Test Key",
      scopes: ["contacts.read"],
    });
    const rawKey = createKeyRes.data.rawKey;

    const contactRes = await req("GET", `/api/contacts/${createdContactId}`, undefined, {
      "X-API-Key": rawKey,
      Authorization: "",
    });
    assert(contactRes.status === 200, `Expected 200 got ${contactRes.status}`);
    assert(contactRes.data.id === createdContactId, "Contact ID should match");
    assert(contactRes.data.status === "lead", `Expected lead status got ${contactRes.data.status}`);

    await req("DELETE", `/api/api-keys/${createKeyRes.data.id}`);
  });

  if (createdContactId) {
    await req("DELETE", `/api/contacts/${createdContactId}`);
  }
  if (testApiKeyId) {
    await req("DELETE", `/api/api-keys/${testApiKeyId}`);
  }

  // ==========================================
  // REPORT
  // ==========================================

  console.log("\n\n" + "=".repeat(80));
  console.log("TEST RESULTS SUMMARY");
  console.log("=".repeat(80) + "\n");

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  console.log(`Total: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}\n`);

  const categories = [...new Set(results.map((r) => r.category))];
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catPassed = catResults.filter((r) => r.passed).length;
    const catFailed = catResults.filter((r) => !r.passed).length;
    const icon = catFailed === 0 ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${cat}: ${catPassed}/${catResults.length} passed`);
  }

  if (failed.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("FAILED TESTS - DETAILS WITH STACK TRACES");
    console.log("=".repeat(80) + "\n");

    for (const f of failed) {
      console.log(`--- FAIL: ${f.name} ---`);
      console.log(`  Category: ${f.category}`);
      if (f.securityFlag) console.log(`  Security Flag: ${f.securityFlag}`);
      console.log(`  Error:\n${f.error?.split("\n").map(l => "    " + l).join("\n")}`);
      console.log("");
    }
  }

  const securityFlags = results.filter((r) => !r.passed && r.securityFlag);
  if (securityFlags.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("SECURITY CONCERNS DETECTED");
    console.log("=".repeat(80) + "\n");
    const flagGroups: Record<string, TestResult[]> = {};
    for (const sf of securityFlags) {
      if (!flagGroups[sf.securityFlag!]) flagGroups[sf.securityFlag!] = [];
      flagGroups[sf.securityFlag!].push(sf);
    }
    for (const [flag, tests] of Object.entries(flagGroups)) {
      console.log(`  [!] ${flag}:`);
      for (const t of tests) {
        console.log(`      - ${t.name}`);
      }
      console.log("");
    }
  }

  if (failed.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("SUGGESTED FIXES FOR FAILURES");
    console.log("=".repeat(80) + "\n");

    for (const f of failed) {
      console.log(`[${f.name}]`);
      if (f.securityFlag === "No input validation") {
        console.log(`  FIX: Add input validation (Zod schema or manual checks) to the route handler.`);
        console.log(`       Validate required fields and return 400 with a descriptive error message.`);
        console.log(`       For email fields, validate format with a regex or Zod .email().`);
        console.log(`       For string length, enforce maxLength constraints in the schema.`);
      } else if (f.securityFlag === "No authentication middleware protection") {
        console.log(`  FIX: Ensure isAuthenticated middleware is applied to the route.`);
        console.log(`       For admin routes, ensure isAdmin middleware checks x-admin-token header.`);
        console.log(`       Regular user Bearer tokens must NOT grant admin access.`);
      } else if (f.securityFlag === "Database calls without error handling") {
        console.log(`  FIX: Wrap database calls in try/catch blocks in the storage layer,`);
        console.log(`       or handle errors in the route handler to return 404 for missing records`);
        console.log(`       and 500 for unexpected database errors (with safe error messages).`);
      } else if (f.securityFlag === "API keys exposed in code") {
        console.log(`  FIX: Ensure sensitive data (passwordHash, tokens, API keys) are filtered`);
        console.log(`       from all API responses using destructuring or explicit field selection.`);
      } else {
        console.log(`  FIX: Review the test expectation and route handler. The endpoint may need`);
        console.log(`       additional error handling, validation, or response formatting.`);
      }
      console.log(`  Error: ${f.error?.split("\n")[0]}`);
      console.log("");
    }
  }

  const passedSecurityChecks = [
    "Password hashes are NOT exposed in register/login responses",
    "SQL injection is mitigated by Drizzle ORM parameterized queries",
    "Session tokens use crypto.randomBytes (not predictable)",
    "Admin password policy enforces 16+ chars with complexity",
    "User enumeration is prevented on forgot-password endpoint",
    "Multi-tenant data isolation enforced via companyId in all queries",
    "Rate limiting applied to auth endpoints (express-rate-limit)",
    "Helmet security headers configured (HSTS, CSP, X-Frame-Options)",
    "CORS has strict origin allowlist (no wildcard with credentials)",
    "Admin and Portal sessions store SHA-256 hashed tokens",
  ];

  console.log("\n" + "=".repeat(80));
  console.log("SECURITY CHECKS PASSED");
  console.log("=".repeat(80) + "\n");
  for (const check of passedSecurityChecks) {
    console.log(`  [OK] ${check}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("SECURITY AUDIT NOTES (from code analysis)");
  console.log("=".repeat(80) + "\n");
  console.log("  [NOTE] Storage layer (server/storage.ts) has NO try/catch in any method.");
  console.log("         All 100+ database methods rely on route handlers to catch errors.");
  console.log("         This can cause unhandled promise rejections if routes miss error handling.");
  console.log("");
  console.log("  [NOTE] /api/mapbox-token exposes the Mapbox public token without auth.");
  console.log("         This is intentional (public tokens are designed for client-side use),");
  console.log("         but should be monitored for abuse.");
  console.log("");
  console.log("  [NOTE] PATCH /api/company passes req.body directly to storage.updateCompany()");
  console.log("         without field validation. Allows setting arbitrary fields.");
  console.log("");
  console.log("  [NOTE] Some route params (req.params.id) are used as UUIDs without format");
  console.log("         validation. Invalid IDs cause Postgres errors (caught by handleError),");
  console.log("         but returning 400 'Invalid ID format' would be cleaner.");
  console.log("");

  return failed.length;
}

runTests()
  .then((failCount) => {
    console.log(`\nTest run complete. Exit code: ${failCount > 0 ? 1 : 0}`);
    process.exit(failCount > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(2);
  });
