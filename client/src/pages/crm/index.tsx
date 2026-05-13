import { Switch, Route, Redirect } from "wouter";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const CrmDashboard = lazy(() => import("./dashboard"));
const CrmContacts = lazy(() => import("./contacts"));
const CrmContactDetail = lazy(() => import("./contact-detail"));
const CrmCompanies = lazy(() => import("./companies"));
const CrmCompanyDetail = lazy(() => import("./company-detail"));
const CrmDeals = lazy(() => import("./deals"));
const CrmDealDetail = lazy(() => import("./deal-detail"));
const CrmPipeline = lazy(() => import("./pipeline"));
const CrmTasks = lazy(() => import("./tasks"));
const CrmEmails = lazy(() => import("./emails"));
const CrmDocuments = lazy(() => import("./documents"));
const CrmQuotes = lazy(() => import("./quotes"));
const CrmProjects = lazy(() => import("./projects"));
const CrmCampaigns = lazy(() => import("./campaigns"));
const CrmAutomations = lazy(() => import("./automations"));
const CrmSequences = lazy(() => import("./sequences"));
const CrmForms = lazy(() => import("./forms"));
const CrmAuditLog = lazy(() => import("./audit-log"));
const CrmReports = lazy(() => import("./reports"));

function CrmLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function CrmRouter() {
  return (
    <Suspense fallback={<CrmLoader />}>
      <Switch>
        <Route path="/crm" component={CrmDashboard} />
        <Route path="/crm/contacts/:id" component={CrmContactDetail} />
        <Route path="/crm/contacts" component={CrmContacts} />
        <Route path="/crm/companies/:id" component={CrmCompanyDetail} />
        <Route path="/crm/companies" component={CrmCompanies} />
        <Route path="/crm/deals/:id" component={CrmDealDetail} />
        <Route path="/crm/deals" component={CrmDeals} />
        <Route path="/crm/pipeline" component={CrmPipeline} />
        <Route path="/crm/tasks" component={CrmTasks} />
        <Route path="/crm/emails" component={CrmEmails} />
        <Route path="/crm/documents" component={CrmDocuments} />
        <Route path="/crm/quotes" component={CrmQuotes} />
        <Route path="/crm/projects" component={CrmProjects} />
        <Route path="/crm/campaigns" component={CrmCampaigns} />
        <Route path="/crm/automations" component={CrmAutomations} />
        <Route path="/crm/sequences" component={CrmSequences} />
        <Route path="/crm/forms" component={CrmForms} />
        <Route path="/crm/audit-log" component={CrmAuditLog} />
        <Route path="/crm/reports" component={CrmReports} />
        <Route>
          <Redirect to="/crm" />
        </Route>
      </Switch>
    </Suspense>
  );
}
