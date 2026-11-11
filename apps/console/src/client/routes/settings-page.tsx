import { useAuth } from "../context/auth-context";
import { LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import {
  roleCanManageApiKeys,
  roleCanManageMembers,
  roleCanReadAuditEvents,
} from "../lib/permissions";
import { WorkspaceManagementPanel } from "../components/workspace/workspace-management-panel";

export function SettingsPage() {
  const auth = useAuth();
  const role = auth.selectedWorkspace?.role;
  const canAccess = role !== undefined && roleCanManageMembers(role);
  const canSecurity = role !== undefined && roleCanReadAuditEvents(role);
  const canApiKeys = role !== undefined && roleCanManageApiKeys(role);

  return (
    <div className="page-stack">
      <PageHeader
        title="Settings"
        subtitle="Workspace membership, security activity, and catalog resources that support building."
      />
      <div className="grid-two">
        {canAccess ? (
          <SectionPanel title="Workspace access">
            <p className="panel-description muted">
              Invite members and manage roles for this workspace.
            </p>
            <div className="panel-header-actions">
              <LinkButton variant="primary" to="/workspace/access">
                Manage access
              </LinkButton>
            </div>
          </SectionPanel>
        ) : null}
        {canApiKeys ? (
          <SectionPanel title="API Keys">
            <p className="panel-description muted">
              Create and revoke machine API keys for CLI and SDK automation.
            </p>
            <div className="panel-header-actions">
              <LinkButton variant="primary" to="/settings/api-keys">
                Manage API keys
              </LinkButton>
            </div>
          </SectionPanel>
        ) : null}
        {canSecurity ? (
          <SectionPanel title="Security activity">
            <p className="panel-description muted">
              Review audit events for sensitive actions in this workspace.
            </p>
            <div className="panel-header-actions">
              <LinkButton variant="primary" to="/workspace/security">
                View security activity
              </LinkButton>
            </div>
          </SectionPanel>
        ) : null}
        <SectionPanel title="Examples catalog">
          <p className="panel-description muted">
            Browse verified osva-examples entries. Templates remain contextual
            inside Agents and Workflows.
          </p>
          <div className="panel-header-actions">
            <LinkButton to="/examples">Browse examples</LinkButton>
          </div>
        </SectionPanel>
        <SectionPanel title="Workspaces">
          <p className="panel-description muted">
            Create additional workspaces in your organization or rename the
            active workspace.
          </p>
          <WorkspaceManagementPanel />
        </SectionPanel>
        <SectionPanel title="Guided setup">
          <p className="panel-description muted">
            Step through first-time workspace setup when you need a structured
            path.
          </p>
          <div className="panel-header-actions">
            <LinkButton to="/onboarding">Open guided setup</LinkButton>
          </div>
        </SectionPanel>
      </div>
      {!canAccess && !canSecurity && !canApiKeys ? (
        <p className="muted">
          Additional workspace administration options appear here when your role
          includes the required permissions.
        </p>
      ) : null}
    </div>
  );
}
