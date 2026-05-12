# Replit Agent Prompt — Post-Onboarding Import Prompt

## Objective

After a user completes the business onboarding wizard, show a one-time prompt asking if they want to import their existing clients. The prompt hides permanently once the company has completed a contacts import. No new DB columns, no new routes, no changes to protected files.

---

## Constraints — Read before touching anything

- **DO NOT modify** `client/src/components/business-onboarding.tsx` — it is protected.
- **DO NOT modify** `client/src/components/import-wizard.tsx` — it is protected.
- **DO NOT add new API routes** — extend the existing `/api/onboarding/business-status` handler only.
- **DO NOT add new DB columns or migrations** — derive state from existing `import_runs` table.
- All new frontend code goes in a single new file: `client/src/components/post-onboarding-import-prompt.tsx`.
- The only existing files you may modify are: `client/src/App.tsx` and `server/routes/onboarding.ts`.

---

## Step 1 — Backend: extend `/api/onboarding/business-status`

**File:** `server/routes/onboarding.ts`

Find the handler for `GET /api/onboarding/business-status`. It currently queries the `companies` table and returns `{ isComplete: boolean, isDemo?: boolean }`.

Add a subquery to the existing SELECT that checks whether the company has ever completed a contacts import:

```sql
SELECT EXISTS(
  SELECT 1 FROM import_runs
  WHERE company_id = $companyId
    AND status = 'completed'
    AND (type = 'sweepandgo_contacts' OR type = 'csv_contacts')
) AS has_completed_import
```

Add this to whatever query already runs in that handler (do not replace the existing query — extend it). Then add `hasCompletedContactImport: boolean` to the JSON response, mapped from `has_completed_import`.

The updated response shape:
```typescript
{
  isComplete: boolean;
  isDemo?: boolean;
  hasCompletedContactImport: boolean;
}
```

If the `import_runs` table query fails or returns null, default `hasCompletedContactImport` to `false` — do not throw.

---

## Step 2 — Frontend: create the prompt component

**Create new file:** `client/src/components/post-onboarding-import-prompt.tsx`

This is a modal dialog using Shadcn/ui `Dialog` components. It appears once after onboarding completes and navigates to `/migration` if the user accepts.

```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface PostOnboardingImportPromptProps {
  open: boolean;
  onDismiss: () => void;
}

export function PostOnboardingImportPrompt({ open, onDismiss }: PostOnboardingImportPromptProps) {
  const [, navigate] = useLocation();

  function handleImport() {
    onDismiss();
    navigate("/migration");
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import your existing clients?</DialogTitle>
          <DialogDescription>
            If you're switching from another system, we can pull in your client list, service plans, pricing, and dog info automatically. Takes about 5 minutes.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <Button onClick={handleImport} className="w-full">
            Yes, import my clients
          </Button>
          <Button variant="ghost" onClick={onDismiss} className="w-full">
            No thanks, I'll add clients manually
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Step 3 — Wire it into App.tsx

**File:** `client/src/App.tsx`

### 3a — Update the query type

Find the existing `useQuery` call for `/api/onboarding/business-status`. Update its type parameter to include the new field:

```typescript
const { data: businessOnboarding } = useQuery<{
  isComplete: boolean;
  isDemo?: boolean;
  hasCompletedContactImport: boolean;
}>({
  queryKey: ["/api/onboarding/business-status"],
});
```

### 3b — Add prompt state

Near the existing `businessOnboardingDone` state (around line 440), add:

```typescript
const [showImportPrompt, setShowImportPrompt] = useState(false);
```

### 3c — Trigger the prompt after onboarding completes

Find the `onComplete` callback passed to `<BusinessOnboarding>`. It currently calls `setBusinessOnboardingDone(true)` and invalidates the query. Extend it to also show the import prompt:

```typescript
onComplete={() => {
  setBusinessOnboardingDone(true);
  sessionStorage.setItem("scoopilot_onboarding_dismissed", "true");
  queryClient.invalidateQueries({ queryKey: ["/api/onboarding/business-status"] });
  setShowImportPrompt(true); // ADD THIS LINE
}}
```

### 3d — Hide prompt if import already completed

The prompt should not show if `hasCompletedContactImport` is already true. Add this effect near the other onboarding logic:

```typescript
useEffect(() => {
  if (businessOnboarding?.hasCompletedContactImport) {
    setShowImportPrompt(false);
  }
}, [businessOnboarding?.hasCompletedContactImport]);
```

### 3e — Render the prompt

Find where `<BusinessOnboarding>` is rendered (around line 440). Directly after it (not inside it), add:

```typescript
import { PostOnboardingImportPrompt } from "@/components/post-onboarding-import-prompt";

// In JSX, after the BusinessOnboarding block:
<PostOnboardingImportPrompt
  open={showImportPrompt && !businessOnboarding?.hasCompletedContactImport}
  onDismiss={() => setShowImportPrompt(false)}
/>
```

---

## Step 4 — Verify nothing is broken

After implementing, confirm:

1. `/api/onboarding/business-status` returns `hasCompletedContactImport: boolean` in all cases — including when `import_runs` has no matching rows (should return `false`, not an error).
2. The prompt renders as a modal over the main app after onboarding `onComplete` fires.
3. Clicking "Yes, import my clients" dismisses the modal and navigates to `/migration`.
4. Clicking "No thanks" dismisses the modal — it does not reappear in the same session or on refresh (because `showImportPrompt` is local React state, initialized to `false`).
5. If the user later completes a contacts import (via `/migration`), `hasCompletedContactImport` becomes `true` on the next query refresh and the prompt cannot be shown again.
6. No changes were made to `business-onboarding.tsx` or `import-wizard.tsx`.
7. No new DB migrations were run.

---

## Summary of files changed

| File | Change |
|------|--------|
| `server/routes/onboarding.ts` | Add `has_completed_import` subquery; add `hasCompletedContactImport` to response |
| `client/src/App.tsx` | Update query type; add `showImportPrompt` state; extend `onComplete`; add effect; render prompt |
| `client/src/components/post-onboarding-import-prompt.tsx` | **New file** — modal component |
| `client/src/components/business-onboarding.tsx` | **DO NOT TOUCH** |
| `client/src/components/import-wizard.tsx` | **DO NOT TOUCH** |
