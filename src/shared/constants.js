// All 365 M365 Security Policy Definitions

export const POLICY_CATEGORIES = {
  CA: 'Conditional Access',
  IP: 'Identity Protection',
  EX: 'Exchange Online',
  SP: 'SharePoint & OneDrive',
  TE: 'Teams',
  EN: 'Intune / Endpoint',
  DE: 'Defender',
  AC: 'Audit & Compliance',
  AS: 'Admin Security',
  TB: 'Tenant Baseline',
}

// License keys → human-readable display names
export const LICENSE_LABELS = {
  p1:        'Azure AD Premium P1',
  p2:        'Azure AD Premium P2',
  intune:    'Microsoft Intune',
  defender:  'Microsoft Defender for Office 365',
  purview:   'Microsoft Purview (E5 Compliance)',
  exchange:  'Exchange Online',
  sharepoint:'SharePoint Online',
  teams:     'Microsoft Teams',
}

// License keys → subscription plans that include them
export const LICENSE_PLANS = {
  p1:        'Included in: Microsoft 365 E3, E5, Business Premium; Entra ID P1 add-on',
  p2:        'Included in: Microsoft 365 E5, EMS E5; Entra ID P2 add-on',
  intune:    'Included in: Microsoft 365 E3, E5, Business Premium; Intune Plan 1 standalone',
  defender:  'Included in: Microsoft 365 E5, Business Premium; Microsoft Defender for Office 365 P1 add-on',
  purview:   'Included in: Microsoft 365 E5; Microsoft 365 E5 Compliance add-on',
  exchange:  'Included in: Microsoft 365 E1, E3, E5, Business Essentials, Business Standard, Business Premium',
  sharepoint:'Included in: Microsoft 365 E1, E3, E5, Business plans; SharePoint Online standalone',
  teams:     'Included in: Microsoft 365 E1, E3, E5, Business plans; Teams Essentials',
}

// Short badge labels used in the UI
export const LICENSE_SHORT = {
  p1:        'Entra P1',
  p2:        'Entra P2',
  intune:    'Intune',
  defender:  'Defender',
  purview:   'Purview',
  exchange:  'Exchange',
  sharepoint:'SharePoint',
  teams:     'Teams',
}

export const POLICIES = [
  // ─── Conditional Access CA001–CA050 ───────────────────────────────────────
  { id: 'CA001', category: 'Conditional Access', name: 'Require MFA for All Users', description: 'Enforces multi-factor authentication for all users across all applications.', severity: 'critical', scriptFn: 'createRequireMfaPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA002', category: 'Conditional Access', name: 'Block Legacy Authentication', description: 'Blocks all legacy authentication protocols that do not support MFA.', severity: 'critical', scriptFn: 'createBlockLegacyAuthPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA003', category: 'Conditional Access', name: 'Require MFA for Admins', description: 'Requires MFA for all directory role members regardless of location.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA004', category: 'Conditional Access', name: 'Require Compliant Device', description: 'Grants access only from Intune-compliant or hybrid-joined devices.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: ['EN001'], platforms: ['windows', 'macos', 'ios', 'android'], requiredLicenses: ['p1', 'intune'] },
  { id: 'CA005', category: 'Conditional Access', name: 'Block All Non-UK Access', description: 'Blocks all sign-ins from outside the United Kingdom. Creates a UK named location (GB) then blocks all users from all apps unless signing in from the UK. Any sign-in originating outside the UK will be denied.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA006', category: 'Conditional Access', name: 'Require MFA for Azure Management', description: 'Requires MFA when accessing Azure portal and management APIs.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA007', category: 'Conditional Access', name: 'Block High Sign-In Risk', description: 'Blocks access when Azure AD Identity Protection detects high sign-in risk.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['IP001'], platforms: ['all'], requiredLicenses: ['p2'] },
  { id: 'CA008', category: 'Conditional Access', name: 'Require Password Change for High User Risk', description: 'Forces password reset when user risk level is detected as high.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['IP002'], platforms: ['all'], requiredLicenses: ['p2'] },
  { id: 'CA009', category: 'Conditional Access', name: 'Require MFA for Medium Sign-In Risk', description: 'Requires MFA step-up when sign-in risk is medium or high.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['IP001'], platforms: ['all'], requiredLicenses: ['p2'] },
  { id: 'CA010', category: 'Conditional Access', name: 'Block Unmanaged Devices from SharePoint', description: 'Restricts SharePoint and OneDrive access to managed devices only.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: ['CA004'], platforms: ['all'], requiredLicenses: ['p1', 'intune'] },
  { id: 'CA011', category: 'Conditional Access', name: 'Require App Protection Policy (iOS)', description: 'Requires Intune app protection policy on iOS devices for O365 apps.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['ios'], requiredLicenses: ['p1', 'intune'] },
  { id: 'CA012', category: 'Conditional Access', name: 'Require App Protection Policy (Android)', description: 'Requires Intune app protection policy on Android devices for O365 apps.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['android'], requiredLicenses: ['p1', 'intune'] },
  { id: 'CA013', category: 'Conditional Access', name: 'Restrict Guest Access to Approved Apps', description: 'Limits guest/B2B accounts to specific approved applications only.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA014', category: 'Conditional Access', name: 'Require MFA for Guest Users', description: 'Enforces MFA for all external/guest users accessing tenant resources.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA015', category: 'Conditional Access', name: 'Session Control: Sign-in Frequency 8h', description: 'Requires re-authentication every 8 hours for all users.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA016', category: 'Conditional Access', name: 'Session Control: No Persistent Browser', description: 'Prevents browser session persistence (no "stay signed in").', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA017', category: 'Conditional Access', name: 'Require MFA for Risky Sign-In Locations', description: 'Requires MFA when sign-in originates from unfamiliar locations.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA018', category: 'Conditional Access', name: 'Block Unsupported Device Platforms', description: 'Blocks access from unsupported or unknown device platforms.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA019', category: 'Conditional Access', name: 'Require MFA Registration (SSPR)', description: 'Requires users to register security info (MFA + SSPR) at next sign-in.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA021', category: 'Conditional Access', name: 'Require MFA for All Cloud Apps (Except Excluded)', description: 'Blanket MFA for all cloud apps with a curated exclusion list.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: ['CA001'], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA023', category: 'Conditional Access', name: 'Require Token Protection (Token Binding)', description: 'Requires token protection binding for sensitive app access.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['windows'], requiredLicenses: ['p1'] },
  { id: 'CA024', category: 'Conditional Access', name: 'Restrict Exchange ActiveSync to Approved Devices', description: 'Allows EAS only from compliant managed devices.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: ['CA004'], platforms: ['ios', 'android'], requiredLicenses: ['p1', 'intune'] },
  { id: 'CA025', category: 'Conditional Access', name: 'Block Device Code Flow', description: 'Blocks device code grant flow to prevent phishing attacks.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA026', category: 'Conditional Access', name: 'Require Phishing-Resistant MFA for Admins', description: 'Requires FIDO2 or certificate-based auth for privileged admin accounts.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: ['CA003'], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA027', category: 'Conditional Access', name: 'Require Compliant Device for Email (Outlook)', description: 'Restricts Exchange Online / Outlook to compliant managed devices.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: ['CA004'], platforms: ['all'], requiredLicenses: ['p1', 'intune'] },
  { id: 'CA028', category: 'Conditional Access', name: 'Named Location: Office IPs', description: 'Defines approved corporate IP ranges as trusted named locations.', severity: 'info', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA030', category: 'Conditional Access', name: 'Session Control: App-Enforced Restrictions', description: 'Passes device compliance signal to O365 apps for app-enforced restrictions.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA031', category: 'Conditional Access', name: 'Require MFA for Intune Enrollment', description: 'Requires MFA when enrolling a new device into Intune MDM.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA033', category: 'Conditional Access', name: 'Require MFA for Microsoft Admin Portals', description: 'Requires MFA for Microsoft 365 Admin Center, Exchange Admin, etc.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA034', category: 'Conditional Access', name: 'Continuous Access Evaluation', description: 'Enables continuous access evaluation for near-real-time policy enforcement.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA035', category: 'Conditional Access', name: 'Block Rooted/Jailbroken Devices', description: 'Blocks access from devices detected as rooted or jailbroken by MAM policy.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['CA011', 'CA012'], platforms: ['ios', 'android'], requiredLicenses: ['p1', 'intune'] },
  { id: 'CA037', category: 'Conditional Access', name: 'Require Password Change on Medium User Risk', description: 'Forces password reset when user risk rises to medium.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['IP002'], platforms: ['all'], requiredLicenses: ['p2'] },
  { id: 'CA042', category: 'Conditional Access', name: 'Restrict Download on Unmanaged Devices', description: 'Prevents file download on unmanaged devices using app-enforced restrictions.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA043', category: 'Conditional Access', name: 'Block Authentication for Deprecated Protocols', description: 'Blocks NTLM and other deprecated authentication protocols.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA044', category: 'Conditional Access', name: 'Require MFA for DevOps / GitHub', description: 'Requires MFA for accessing Microsoft DevOps and GitHub Enterprise resources.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA045', category: 'Conditional Access', name: 'Session Lifetime: Admin Accounts 1h', description: 'Limits admin account sessions to 1 hour maximum lifetime.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['CA003'], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA046', category: 'Conditional Access', name: 'Block Personal Device Access to Sensitive Data', description: 'Blocks access to sensitive classified data from personal/BYOD devices.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA047', category: 'Conditional Access', name: 'Require MFA for Third-Party SaaS Apps', description: 'Enforces MFA for all third-party SaaS apps registered in AAD.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'CA049', category: 'Conditional Access', name: 'Require MFA for Power Platform', description: 'Requires MFA when accessing Power Apps, Power Automate, and Power BI.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },

  // ─── Identity Protection IP001–IP030 ──────────────────────────────────────
  { id: 'IP001', category: 'Identity Protection', name: 'Enable Sign-In Risk Policy', description: 'Configures Azure AD Identity Protection sign-in risk policy.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p2'] },
  { id: 'IP002', category: 'Identity Protection', name: 'Enable User Risk Policy', description: 'Configures Azure AD Identity Protection user risk policy.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p2'] },
  { id: 'IP003', category: 'Identity Protection', name: 'Enable MFA Registration Policy', description: 'Pushes MFA registration to all non-registered users via Identity Protection.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p2'] },

  // ─── Exchange Online EX001–EX040 ──────────────────────────────────────────
  { id: 'EX001', category: 'Exchange Online', name: 'Enable DKIM Signing', description: 'Enables DKIM email signing for all accepted domains.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX004', category: 'Exchange Online', name: 'Anti-Spam: Inbound Policy (Strict)', description: 'Configures strict inbound anti-spam policy with quarantine actions.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX005', category: 'Exchange Online', name: 'Anti-Spam: Outbound Policy', description: 'Creates an outbound anti-spam policy with sending limits to protect tenant sender reputation.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX006', category: 'Exchange Online', name: 'Anti-Malware Policy (Strict)', description: 'Creates a strict anti-malware policy with common attachment type blocking for all accepted domains.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX007', category: 'Exchange Online', name: 'Block Dangerous Attachment Types', description: 'Blocks delivery of emails containing executable and script attachments.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['EX006'], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX008', category: 'Exchange Online', name: 'Safe Attachments Policy (Defender)', description: 'Enables Defender for Office 365 Safe Attachments for all users.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['DE001'], platforms: ['all'], requiredLicenses: ['exchange', 'defender'] },
  { id: 'EX009', category: 'Exchange Online', name: 'Safe Links Policy (Defender)', description: 'Enables Defender for Office 365 Safe Links for all users.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['DE001'], platforms: ['all'], requiredLicenses: ['exchange', 'defender'] },
  { id: 'EX010', category: 'Exchange Online', name: 'Anti-Phishing Policy (Strict)', description: 'Configures strict anti-phishing with impersonation protection.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange', 'defender'] },
  { id: 'EX011', category: 'Exchange Online', name: 'Disable Auto-Forwarding to External', description: 'Blocks automatic email forwarding to external recipients.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX012', category: 'Exchange Online', name: 'Enable Audit Logging for Mailboxes', description: 'Enables mailbox audit logging for all user, admin, and delegate actions.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX015', category: 'Exchange Online', name: 'Enable Modern Authentication', description: 'Enables modern authentication (OAuth) for Exchange Online.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX016', category: 'Exchange Online', name: 'Disable Basic Authentication', description: 'Disables Basic Authentication for all Exchange Online protocols.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['EX015'], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX017', category: 'Exchange Online', name: 'Transport Rule: Block Macro-Enabled Docs', description: 'Mail flow rule that strips or blocks macro-enabled Office documents.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX018', category: 'Exchange Online', name: 'Transport Rule: External Email Warning', description: 'Prepends external sender warning to all inbound emails from outside.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX025', category: 'Exchange Online', name: 'Junk Mail Threshold: High Confidence', description: 'Sets bulk email threshold to 6 on the deployed anti-spam policy (falls back to the Default policy).', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['EX004'], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX031', category: 'Exchange Online', name: 'Disable POP3/IMAP4 Access', description: 'Disables POP3 and IMAP4 access for all user mailboxes.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX032', category: 'Exchange Online', name: 'Transport Rule: Block Password-Protected Archives', description: 'Quarantines emails with password-protected ZIP/archive attachments.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'EX035', category: 'Exchange Online', name: 'Zero-Hour Auto Purge (ZAP)', description: 'Enables Zero-Hour Auto Purge for spam and phishing on the deployed anti-spam policy (falls back to the Default policy).', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange', 'defender'] },
  { id: 'EX036', category: 'Exchange Online', name: 'SMTP AUTH: Disable for Unused Mailboxes', description: 'Disables SMTP AUTH client submission for mailboxes not requiring it.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },

  // ─── SharePoint & OneDrive SP001–SP030 ────────────────────────────────────
  { id: 'SP001', category: 'SharePoint & OneDrive', name: 'Restrict External Sharing: Anyone Links', description: 'Disables anonymous "Anyone" sharing links tenant-wide.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['sharepoint'] },
  { id: 'SP002', category: 'SharePoint & OneDrive', name: 'Restrict External Sharing to Existing Guests', description: 'Limits external sharing to already-known guest accounts only.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['sharepoint'] },
  { id: 'SP003', category: 'SharePoint & OneDrive', name: 'Set Default Sharing Scope to Specific People', description: 'Changes default share link type to "Specific People" (not Organisation).', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['sharepoint'] },
  { id: 'SP011', category: 'SharePoint & OneDrive', name: 'Expiration Policy for Guest Access', description: 'Sets guest access expiry to 30 days requiring renewal.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['sharepoint'] },
  { id: 'SP016', category: 'SharePoint & OneDrive', name: 'Block Personal OneDrive Sync', description: 'Prevents syncing corporate data to personal Microsoft accounts.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['sharepoint'] },
  { id: 'SP023', category: 'SharePoint & OneDrive', name: 'SharePoint Minimum TLS 1.2', description: 'Enforces minimum TLS 1.2 for all SharePoint and OneDrive connections.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['sharepoint'] },

  // ─── Teams TE001–TE020 ─────────────────────────────────────────────────────
  { id: 'TE003', category: 'Teams', name: 'Meeting Policy: Disable Anonymous Join', description: 'Prevents unauthenticated/anonymous users from joining Teams meetings.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['teams'] },
  { id: 'TE004', category: 'Teams', name: 'Meeting Policy: Lobby for External Users', description: 'Forces external users to wait in lobby until admitted by organiser.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['teams'] },
  { id: 'TE005', category: 'Teams', name: 'Disable Cloud Recording for External Users', description: 'Prevents external participants from recording Teams meetings.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['teams'] },
  { id: 'TE011', category: 'Teams', name: 'Restrict Third-Party App Installs', description: 'Restricts installation of third-party apps in Teams to admin-approved apps.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['teams'] },
  { id: 'TE015', category: 'Teams', name: 'Disable Personal Teams Accounts', description: 'Blocks personal Microsoft account access to Teams (consumer Teams).', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['teams'] },
  { id: 'TE017', category: 'Teams', name: 'Meeting Recording: Auto-Expiry 60 Days', description: 'Sets automatic expiry for Teams meeting recordings to 60 days.', severity: 'low', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['teams'] },

  // ─── Intune / Endpoint EN001–EN050 ────────────────────────────────────────
  { id: 'EN001', category: 'Intune / Endpoint', name: 'Windows Compliance: Require BitLocker', description: 'Marks Windows device as non-compliant if BitLocker encryption is not enabled.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['windows'], requiredLicenses: ['intune'] },
  { id: 'EN002', category: 'Intune / Endpoint', name: 'Windows Compliance: Require Antivirus', description: 'Requires Windows Defender Antivirus to be active and reporting.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['windows'], requiredLicenses: ['intune'] },
  { id: 'EN003', category: 'Intune / Endpoint', name: 'Windows Compliance: Require Firewall', description: 'Requires Windows Firewall to be enabled on all profiles.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['windows'], requiredLicenses: ['intune'] },
  { id: 'EN004', category: 'Intune / Endpoint', name: 'Windows Compliance: Minimum OS Version', description: 'Sets minimum Windows 11 22H2 (or Windows 10 22H2) for compliance.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['windows'], requiredLicenses: ['intune'] },
  { id: 'EN005', category: 'Intune / Endpoint', name: 'Windows Compliance: Require Secure Boot', description: 'Requires Secure Boot to be enabled for Windows device compliance.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['windows'], requiredLicenses: ['intune'] },
  { id: 'EN007', category: 'Intune / Endpoint', name: 'macOS Compliance: Require FileVault', description: 'Marks macOS device non-compliant if FileVault disk encryption is off.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['macos'], requiredLicenses: ['intune'] },
  { id: 'EN008', category: 'Intune / Endpoint', name: 'macOS Compliance: Minimum OS Version', description: 'Sets minimum macOS version for compliance (latest - 1 major).', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['macos'], requiredLicenses: ['intune'] },
  { id: 'EN009', category: 'Intune / Endpoint', name: 'macOS Compliance: Firewall Enabled', description: 'Requires macOS Application Firewall to be enabled.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['macos'], requiredLicenses: ['intune'] },
  { id: 'EN010', category: 'Intune / Endpoint', name: 'iOS Compliance: Minimum OS Version', description: 'Sets minimum iOS version for mobile device compliance.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['ios'], requiredLicenses: ['intune'] },
  { id: 'EN011', category: 'Intune / Endpoint', name: 'iOS Compliance: Require Device Passcode', description: 'Requires a PIN/passcode on iOS devices for compliance.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['ios'], requiredLicenses: ['intune'] },
  { id: 'EN012', category: 'Intune / Endpoint', name: 'iOS Compliance: Block Jailbroken Devices', description: 'Marks jailbroken iOS devices as non-compliant.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['ios'], requiredLicenses: ['intune'] },
  { id: 'EN013', category: 'Intune / Endpoint', name: 'Android Compliance: Minimum OS Version', description: 'Sets minimum Android OS version for mobile device compliance.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['android'], requiredLicenses: ['intune'] },
  { id: 'EN014', category: 'Intune / Endpoint', name: 'Android Compliance: Require Device Encryption', description: 'Requires full device encryption on Android for compliance.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['android'], requiredLicenses: ['intune'] },
  { id: 'EN015', category: 'Intune / Endpoint', name: 'Android Compliance: Block Rooted Devices', description: 'Marks rooted Android devices as non-compliant.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['android'], requiredLicenses: ['intune'] },
  { id: 'EN049', category: 'Intune / Endpoint', name: 'Windows Compliance: Defender Signature Up to Date', description: 'Marks device non-compliant if Defender signatures are more than 3 days old.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['EN002'], platforms: ['windows'], requiredLicenses: ['intune'] },

  // ─── Defender DE001–DE040 ─────────────────────────────────────────────────
  { id: 'DE001', category: 'Defender', name: 'Enable Defender for Office 365 Plan 2', description: 'Enables Microsoft Defender for Office 365 Plan 2 features.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['defender'] },
  { id: 'DE002', category: 'Defender', name: 'Defender: Preset Security Policies (Strict)', description: 'Applies Microsoft strict preset security policy for Defender for O365.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['DE001'], platforms: ['all'], requiredLicenses: ['defender'] },
  { id: 'DE038', category: 'Defender', name: 'Defender: Safe Documents for Office', description: 'Enables Safe Documents to verify Office files opened in Protected View.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['DE001'], platforms: ['windows'], requiredLicenses: ['defender'] },

  // ─── Audit & Compliance AC001–AC060 ───────────────────────────────────────
  { id: 'AC001', category: 'Audit & Compliance', name: 'Enable Unified Audit Log', description: 'Ensures the Microsoft 365 unified audit log is enabled for the tenant.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'AC004', category: 'Audit & Compliance', name: 'Enable Mailbox Audit: Admin Actions', description: 'Enables audit logging of all administrator actions on all mailboxes.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['EX012'], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'AC005', category: 'Audit & Compliance', name: 'Enable Mailbox Audit: Delegate Actions', description: 'Enables audit logging of all delegate actions on shared mailboxes.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: ['EX012'], platforms: ['all'], requiredLicenses: ['exchange'] },
  { id: 'AC007', category: 'Audit & Compliance', name: 'DLP: Global Policy (All Workloads)', description: 'Creates a global DLP policy covering Exchange, SharePoint, Teams, and Endpoints.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['purview'] },
  { id: 'AC012', category: 'Audit & Compliance', name: 'Retention Policy: Teams Messages', description: 'Applies 7-year retention to Teams channel and chat messages.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['purview'] },
  { id: 'AC013', category: 'Audit & Compliance', name: 'Retention Policy: SharePoint & OneDrive', description: 'Applies 7-year retention to SharePoint sites and OneDrive content.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['purview'] },
  { id: 'AC014', category: 'Audit & Compliance', name: 'Retention Policy: Exchange Email', description: 'Applies 7-year retention to Exchange Online email content.', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: false, dependencies: [], platforms: ['all'], requiredLicenses: ['purview'] },
  { id: 'AC043', category: 'Audit & Compliance', name: 'DLP: Credit Card Numbers', description: 'DLP policy blocking sharing of credit card numbers across all workloads.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['purview'] },

  // ─── Admin Security AS001–AS020 ───────────────────────────────────────────
  { id: 'AS008', category: 'Admin Security', name: 'Global Admin Count: Maximum 5', description: 'Alerts when more than 5 active Global Administrator accounts exist.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: [] },
  { id: 'AS018', category: 'Admin Security', name: 'Restrict API Permission Grant', description: 'Restricts API permission grant consent to admin-only approval workflow.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'AS019', category: 'Admin Security', name: 'Emergency Access (Break-Glass) Accounts', description: 'Creates and documents two emergency access accounts excluded from CA policies.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: [] },

  // ─── Tenant Baseline TB001–TB025 ──────────────────────────────────────────
  { id: 'TB002', category: 'Tenant Baseline', name: 'Enable Modern Authentication', description: 'Enables modern authentication for the tenant (OAuth 2.0 / MSAL).', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: [] },
  { id: 'TB007', category: 'Tenant Baseline', name: 'Restrict User Consent to Apps', description: 'Restricts user consent to apps to low-risk verified publisher apps only.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'TB008', category: 'Tenant Baseline', name: 'Disable User Tenant Creation', description: 'Prevents regular users from creating new Azure AD tenants.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'TB009', category: 'Tenant Baseline', name: 'Restrict Guest Invitation to Admins', description: 'Limits who can invite external guests to administrator accounts only.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: [] },
  { id: 'TB011', category: 'Tenant Baseline', name: 'Disable User LinkedIn Connection', description: 'Disables LinkedIn account connection in Azure AD user profiles.', severity: 'low', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: [] },
  { id: 'TB012', category: 'Tenant Baseline', name: 'Restrict App Registration to Admins', description: 'Prevents regular users from registering new Azure AD applications.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'TB015', category: 'Tenant Baseline', name: 'Smart Lockout: 10 Attempts', description: 'Configures Azure AD Smart Lockout after 10 failed attempts.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'TB016', category: 'Tenant Baseline', name: 'Disable User Password Expiry', description: 'Sets passwords to never expire (relying on breach detection instead).', severity: 'medium', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: [] },
  { id: 'TB017', category: 'Tenant Baseline', name: 'Enable Microsoft Authenticator Passwordless', description: 'Enables Microsoft Authenticator for passwordless phone sign-in.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'TB024', category: 'Tenant Baseline', name: 'Disable MFA Number Matching Bypass', description: 'Ensures MFA number matching is enabled to prevent MFA fatigue attacks.', severity: 'critical', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
  { id: 'TB025', category: 'Tenant Baseline', name: 'Enable Additional Security Context in Authenticator', description: 'Enables location and app name context in Authenticator push notifications.', severity: 'high', scriptFn: 'createGenericPolicy', defaultEnabled: true, dependencies: [], platforms: ['all'], requiredLicenses: ['p1'] },
]

export const POLICIES_BY_CATEGORY = POLICIES.reduce((acc, policy) => {
  if (!acc[policy.category]) acc[policy.category] = []
  acc[policy.category].push(policy)
  return acc
}, {})

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

// ─── Configurable field schemas ───────────────────────────────────────────────

const _stateCA = { key: 'state', label: 'Policy State', type: 'select', default: 'enabled', options: [
  { value: 'enabled', label: 'Enabled' },
  { value: 'enabledForReportingButNotEnforced', label: 'Report Only (Monitor)' },
  { value: 'disabled', label: 'Disabled' },
]}

const _stateSimple = { key: 'state', label: 'Policy State', type: 'select', default: 'enabled', options: [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
]}

const _excludeGroups = {
  key: 'excludeGroups', label: 'Exclude Groups', type: 'entity-groups', default: [],
}

const _excludeUsers = {
  key: 'excludeUsers', label: 'Exclude Users', type: 'entity-users', default: [],
}

const _assignedGroups = {
  key: 'assignedGroups', label: 'Assigned Groups', type: 'text', default: '',
  hint: 'Comma-separated group names or Object IDs (leave blank for all devices/users)',
}

const _notifEmail = {
  key: 'notificationEmail', label: 'Notification Email', type: 'text', default: '',
  hint: 'Email for alerts and notifications (leave blank for tenant default)',
}

export const CATEGORY_FIELDS = {
  'Conditional Access':    [_stateCA, _excludeGroups, _excludeUsers],
  'Identity Protection':   [_stateSimple, _notifEmail],
  'Exchange Online':       [_stateSimple],
  'SharePoint & OneDrive': [_stateSimple],
  'Teams':                 [_stateSimple],
  'Intune / Endpoint':     [_stateSimple, _assignedGroups],
  'Defender':              [_stateSimple, _notifEmail],
  'Audit & Compliance':    [_stateSimple, _notifEmail],
  'Admin Security':        [_stateSimple],
  'Tenant Baseline':       [_stateSimple],
}

export const POLICY_EXTRA_FIELDS = {
  CA015: [{ key: 'sessionFrequencyHours', label: 'Re-auth Frequency (hours)', type: 'number', default: 8, min: 1, max: 720 }],
  CA028: [
    { key: 'locationName', label: 'Location Name', type: 'text', default: 'Corporate Office IPs' },
    { key: 'ipRanges', label: 'Office IP Ranges (CIDR)', type: 'text', default: '', hint: 'e.g. 203.0.113.0/24, 10.0.0.0/8' },
  ],
  CA005: [
    { key: '_warning', type: 'callout', text: 'This policy blocks ALL sign-ins from outside the United Kingdom. Every user on every app will be denied access unless they are connecting from the UK (country code GB). Verify that all users are UK-based before enabling this policy.' },
  ],
  CA045: [{ key: 'sessionLifetimeHours', label: 'Admin Session Lifetime (hours)', type: 'number', default: 1, min: 1, max: 24 }],
  EX004: [
    { key: 'spamAction', label: 'Spam Action', type: 'select', default: 'Quarantine', options: [
      { value: 'Quarantine', label: 'Quarantine' },
      { value: 'MoveToJmf', label: 'Move to Junk Folder' },
      { value: 'Delete', label: 'Delete' },
    ]},
    { key: 'highConfidenceSpamAction', label: 'High Confidence Spam', type: 'select', default: 'Quarantine', options: [
      { value: 'Quarantine', label: 'Quarantine' },
      { value: 'Delete', label: 'Delete' },
    ]},
  ],
  EX010: [
    { key: 'protectedDomains', label: 'Protected Domains', type: 'text', default: '', hint: 'Your tenant domains to protect from impersonation (comma-sep)' },
    { key: 'protectedUsers', label: 'Protected Users (emails)', type: 'text', default: '', hint: 'Key users to protect from impersonation (comma-sep emails)' },
  ],
  EX029: [{ key: 'retentionYears', label: 'Retention Period (years)', type: 'number', default: 7, min: 1, max: 10 }],
  EN004: [{ key: 'minOsVersion', label: 'Min Windows Version', type: 'text', default: '10.0.19045.0', hint: 'e.g. 10.0.22621.0 for Win 11 22H2' }],
  EN008: [{ key: 'minMacOsVersion', label: 'Min macOS Version', type: 'text', default: '13.0' }],
  EN010: [{ key: 'minIosVersion', label: 'Min iOS Version', type: 'text', default: '16.0' }],
  EN013: [{ key: 'minAndroidVersion', label: 'Min Android Version', type: 'text', default: '11.0' }],
  EN034: [{ key: 'notificationEmail', label: 'Non-compliance Notification Email', type: 'text', default: '', hint: 'Email notified when a device becomes non-compliant' }],
  EN035: [{ key: 'gracePeriodDays', label: 'Grace Period (days)', type: 'number', default: 3, min: 1, max: 30 }],
  AC012: [{ key: 'retentionYears', label: 'Retention Years', type: 'number', default: 7, min: 1, max: 10 }],
  AC013: [{ key: 'retentionYears', label: 'Retention Years', type: 'number', default: 7, min: 1, max: 10 }],
  AC014: [{ key: 'retentionYears', label: 'Retention Years', type: 'number', default: 7, min: 1, max: 10 }],
  AS005: [{ key: 'maxActivationHours', label: 'Max Role Activation (hours)', type: 'number', default: 8, min: 1, max: 24 }],
  AS008: [{ key: 'maxGlobalAdmins', label: 'Alert Threshold (admins)', type: 'number', default: 5, min: 2, max: 20 }],
  TB015: [{ key: 'lockoutThreshold', label: 'Lockout After (attempts)', type: 'number', default: 10, min: 3, max: 50 }],
  SP011: [{ key: 'guestExpiryDays', label: 'Guest Access Expiry (days)', type: 'number', default: 30, min: 1, max: 365 }],
  TB021: [
    { key: 'technicalContact', label: 'Technical Contact Email', type: 'text', default: '' },
    { key: 'privacyUrl', label: 'Privacy Statement URL', type: 'text', default: '' },
  ],
}
