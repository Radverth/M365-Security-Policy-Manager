'use strict'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PS_PREFS = `$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'`

function safe(s) { return (s || '').replace(/'/g, "''") }
function psStr(s) { return `'${safe(s)}'` }
function psArr(val) {
  // Array of {id, displayName} objects (EntityPicker format) or plain ID strings
  if (Array.isArray(val)) {
    const ids = val.map(v => (typeof v === 'object' && v !== null ? v.id : v)).filter(Boolean)
    return ids.length ? `@(${ids.map(i => `'${safe(i)}'`).join(', ')})` : '@()'
  }
  // Legacy comma-separated string
  if (!val || !String(val).trim()) return '@()'
  const items = String(val).split(',').map(s => s.trim()).filter(Boolean)
  return items.length ? `@(${items.map(i => `'${safe(i)}'`).join(', ')})` : '@()'
}
function hasItems(val) {
  if (Array.isArray(val)) return val.length > 0
  return !!(val && String(val).trim())
}

function policyBlock(id, name, body) {
  const indented = body.trim().split('\n').map(l => '    ' + l).join('\n')
  return `
Write-Output "CREATING: ${id} - ${name}"
try {
${indented}
    Write-Output "SUCCESS: ${id} created"
} catch {
    $errMsg = $_.Exception.Message
    $errCode = ''
    $errDetail = ''
    try {
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $errJson = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($errJson -and $errJson.error) {
                $errCode = " [$($errJson.error.code)]"
                $errDetail = " | $($errJson.error.message)"
            } else {
                $errDetail = " | $($_.ErrorDetails.Message)"
            }
        }
    } catch {}
    Write-Output "FAILURE: ${id}$errCode - $errMsg$errDetail"
}`
}

function skipBlock(id, name, reason) {
  return `
Write-Output "CREATING: ${id} - ${name}"
Write-Output "INFO: ${id} - ${reason}"
Write-Output "SKIPPED: ${id} - cannot be automated"`
}

function dn(policy, prefix) {
  const base = `${policy.id}: ${policy.name}`
  return prefix ? `${prefix} - ${base}` : base
}

// Returns a single PowerShell if-statement that writes a WARNING line when the
// guard expression is false (i.e. the required license is absent).
function licWarn(guardExpr, policyId, msg) {
  return `if (-not (${guardExpr})) { Write-Output "  WARNING: ${policyId} — ${msg}" }`
}

// One-time license detection block prepended to every deployment script.
// Fetches tenant-level subscribedSkus (NOT the signed-in admin's personal
// licenses — admin accounts often have no personal license).
// All variables default to $true so warnings are suppressed if the SKU fetch
// fails (e.g. no Graph connection, permissions issue, etc.).
function buildLicenseCheckScript() {
  return `
# ── Tenant license detection ─────────────────────────────────────────────────
$_licP1 = $true; $_licP2 = $true; $_licIntune = $true
$_licDefO365 = $true; $_licPurview = $true
$_licExchange = $true; $_licSharePoint = $true; $_licTeams = $true
try {
  # Collect every service plan name from active tenant subscriptions.
  # capabilityStatus = 'Enabled' filters out suspended or warning-state SKUs.
  $_licSps = @((Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/v1.0/subscribedSkus' -OutputType PSObject).value |
    Where-Object { $_.capabilityStatus -eq 'Enabled' } |
    ForEach-Object { $_.servicePlans } |
    Where-Object { $_.provisioningStatus -ne 'Disabled' } |
    Select-Object -ExpandProperty servicePlanName -Unique)

  # AAD P1 — Conditional Access, Smart Lockout, auth policies
  # Service plan AAD_PREMIUM is present in: AAD P1, E3, E5, Business Premium, EMS E3/E5
  $_licP1 = ($_licSps -contains 'AAD_PREMIUM') -or ($_licSps -contains 'AAD_PREMIUM_P2')

  # AAD P2 — Identity Protection risk policies, PIM
  # Service plan AAD_PREMIUM_P2 is present in: AAD P2, E5, EMS E5
  $_licP2 = $_licSps -contains 'AAD_PREMIUM_P2'

  # Microsoft Intune — device compliance and MDM enrollment
  # Service plan INTUNE_A is present in: Intune, E3, E5, Business Standard/Premium, EMS E3/E5
  $_licIntune = $_licSps -contains 'INTUNE_A'

  # Defender for Office 365 Plan 1 — Safe Attachments, Safe Links, Anti-Phish
  # Service plan ATP_ENTERPRISE is present in: Defender for O365 P1/P2, Business Premium, E5
  $_licDefO365 = $_licSps -contains 'ATP_ENTERPRISE'

  # Microsoft Purview — DLP and retention compliance policies
  # Service plan INFORMATION_PROTECTION_COMPLIANCE in: E5 Compliance, M365 E5
  $_licPurview = $_licSps -contains 'INFORMATION_PROTECTION_COMPLIANCE'

  # Exchange Online — mailbox, transport, spam/malware policies
  # EXCHANGE_S_STANDARD = Plan 1 (Business Basic); EXCHANGE_S_ENTERPRISE = Plan 2 (E3+)
  $_licExchange = ($_licSps -contains 'EXCHANGE_S_STANDARD') -or ($_licSps -contains 'EXCHANGE_S_ENTERPRISE')

  # SharePoint Online — sharing, external access, OneDrive settings
  $_licSharePoint = ($_licSps -contains 'SHAREPOINTSTANDARD') -or ($_licSps -contains 'SHAREPOINTENTERPRISE')

  # Microsoft Teams
  $_licTeams = $_licSps -contains 'TEAMS1'

  Write-Output "INFO: Tenant licenses — P1=$_licP1 P2=$_licP2 Intune=$_licIntune DefenderO365=$_licDefO365 Purview=$_licPurview Exchange=$_licExchange SharePoint=$_licSharePoint Teams=$_licTeams"
} catch {
  Write-Output "INFO: License check skipped — $($_.Exception.Message)"
}
# ─────────────────────────────────────────────────────────────────────────────
`
}

// ─── Connection detection ─────────────────────────────────────────────────────

const EXO_CATS = new Set(['Exchange Online'])
// EXO_IDS: policies not in EXO_CATS that still require a Connect-ExchangeOnline session.
// TB002 uses Set-OrganizationConfig (EXO cmdlet). TE003/004/005/011/017 use Set-CsTeams*
// cmdlets which are available via the EXO remote PowerShell session.
const EXO_IDS  = new Set(['DE001','DE002','DE038','AC001','AC004','AC005','TE003','TE004','TE005','TE011','TE017','TB002'])
// IPPS_IDS: policies that require Connect-IPPSSession (Purview compliance cmdlets).
// Only include IDs that actually emit IPPS cmdlets — skip IDs that fall to default skipBlock.
const IPPS_IDS = new Set(['AC007','AC012','AC013','AC014','AC043'])

function needsExo(p)  { return EXO_CATS.has(p.category) || EXO_IDS.has(p.id) }
function needsIpps(p) { return IPPS_IDS.has(p.id) }

// ─── Connection builders ──────────────────────────────────────────────────────

function buildConnectGraph(credentials, authMode, opts = {}) {
  const scopes = '"Policy.ReadWrite.ConditionalAccess Policy.Read.All DeviceManagementConfiguration.ReadWrite.All Organization.ReadWrite.All Directory.ReadWrite.All RoleManagement.ReadWrite.Directory AuditLog.Read.All"'

  // When Connect-MgGraph runs inside a console-less subprocess (Electron spawning
  // pwsh with stdin ignored), MSAL.NET may fail to register a CancelKeyPress event
  // handler and throw "An error occurred when writing a listener". The connection
  // itself can still succeed, so we verify via Get-MgContext before giving up.
  const verifyBlock = `
    $mgCtx = Get-MgContext -ErrorAction SilentlyContinue
    if ($mgCtx) {
        Write-Output "CONNECTED: Microsoft Graph"
    } else {
        Write-Output "ERROR: Graph connect failed - $errMsg"; exit 1
    }`

  if (authMode === 'interactive') {
    const tid = credentials?.tenantId ? `-TenantId '${safe(credentials.tenantId)}'` : ''
    return `Write-Output "CONNECTING: Microsoft Graph - follow the device code prompt below..."
try {
    Connect-MgGraph ${tid} -UseDeviceAuthentication -ContextScope CurrentUser -Scopes ${scopes} -NoWelcome -ErrorAction Stop
    Write-Output "CONNECTED: Microsoft Graph"
} catch {
    $errMsg = $_.Exception.Message
    if ($errMsg -match 'listener') {${verifyBlock}
    } elseif ($errMsg -match 'Assembly with same name is already loaded') {
        Write-Output "ERROR: A different version of the Microsoft Graph modules is already loaded. Restart the app and close any other PowerShell windows, then try again. If it persists, update all Graph modules to the same version on the Modules page."; exit 1
    } else {
        Write-Output "ERROR: Graph connect failed - $errMsg"; exit 1
    }
}`
  }
  const tid = credentials.tenantId ? `-TenantId $mgTid` : ''
  return `
$mgUser = '${safe(credentials.username)}'
$mgPass = ConvertTo-SecureString '${safe(credentials.password)}' -AsPlainText -Force
$mgCred = New-Object System.Management.Automation.PSCredential($mgUser, $mgPass)
${credentials.tenantId ? `$mgTid = '${safe(credentials.tenantId)}'` : ''}
try {
    Connect-MgGraph ${tid} -Credential $mgCred -Scopes ${scopes} -NoWelcome -ErrorAction Stop
    Write-Output "CONNECTED: Microsoft Graph"
} catch {
    $errMsg = $_.Exception.Message
    if ($errMsg -match 'listener') {${verifyBlock}
    } elseif ($errMsg -match 'window handle|WindowHandle') {
        # MSAL fell back to the Windows broker (WAM) which needs a parent window —
        # unavailable in a subprocess. Switch to device code flow automatically.
        Write-Output "INFO: Credential auth requires interactive sign-in - switching to device code flow..."
        $mgCred = $null; $mgPass = $null
        try {
            Connect-MgGraph ${tid} -UseDeviceAuthentication -ContextScope CurrentUser -Scopes ${scopes} -NoWelcome -ErrorAction Stop
            Write-Output "CONNECTED: Microsoft Graph"
        } catch {
            Write-Output "ERROR: Graph connect failed - $($_.Exception.Message)"; exit 1
        }
    } else {
        Write-Output "ERROR: Graph connect failed - $errMsg"; exit 1
    }
}
$mgCred = $null; $mgPass = $null; [System.GC]::Collect()`
}

// The -Device switch (device code flow) only exists on PowerShell 7 — Windows
// PowerShell 5.1 throws "A parameter cannot be found that matches parameter
// name 'Device'". On 5.1 fall back to the interactive sign-in window.
// A failed connection exits the script (like Graph) so the EXO/IPPS policy
// blocks don't cascade into misleading "cmdlet not recognized" failures.
function buildConnectExo(credentials, authMode) {
  if (authMode === 'interactive') {
    return `Write-Output "CONNECTING: Exchange Online..."
try {
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        Write-Output "CONNECTING: Exchange Online (device code)..."
        Connect-ExchangeOnline -Device -ShowBanner:$false -ErrorAction Stop
    } else {
        Write-Output "INFO: Device code sign-in needs PowerShell 7 - opening a sign-in window instead..."
        Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
    }
    Write-Output "CONNECTED: Exchange Online"
} catch {
    Write-Output "ERROR: EXO connect failed - $($_.Exception.Message)"
    exit 1
}`
  }
  const upn = credentials?.username ? `-UserPrincipalName '${safe(credentials.username)}'` : ''
  return `Write-Output "CONNECTING: Exchange Online..."
try {
    Connect-ExchangeOnline ${upn} -ShowBanner:$false
    Write-Output "CONNECTED: Exchange Online"
} catch {
    Write-Output "ERROR: EXO connect failed - $($_.Exception.Message)"
    exit 1
}`
}

function buildConnectIpps(credentials, authMode) {
  if (authMode === 'interactive') {
    return `Write-Output "CONNECTING: Security & Compliance..."
try {
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        Write-Output "CONNECTING: Security & Compliance (device code)..."
        Connect-IPPSSession -Device -ShowBanner:$false -ErrorAction Stop
    } else {
        Write-Output "INFO: Device code sign-in needs PowerShell 7 - opening a sign-in window instead..."
        Connect-IPPSSession -ShowBanner:$false -ErrorAction Stop
    }
    Write-Output "CONNECTED: Security & Compliance"
} catch {
    Write-Output "ERROR: IPPS connect failed - $($_.Exception.Message)"
    exit 1
}`
  }
  const upn = credentials?.username ? `-UserPrincipalName '${safe(credentials.username)}'` : ''
  return `Write-Output "CONNECTING: Security & Compliance..."
try {
    Connect-IPPSSession ${upn} -ShowBanner:$false
    Write-Output "CONNECTED: Security & Compliance"
} catch {
    Write-Output "ERROR: IPPS connect failed - $($_.Exception.Message)"
    exit 1
}`
}

function buildDisconnects(graph, exo, ipps) {
  const parts = []
  if (graph) parts.push(`try { Disconnect-MgGraph | Out-Null } catch {}`)
  if (exo || ipps) parts.push(`try { Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}`)
  parts.push(`[System.GC]::Collect()`)
  return parts.join('\n') + '\nWrite-Output "DONE: All sessions closed"'
}

// ─── CA policy builder ────────────────────────────────────────────────────────

const ADMIN_ROLES = [
  '62e90394-69f5-4237-9190-012177145e10', // Global Administrator
  '194ae4cb-b126-40b2-bd5b-6091b380977d', // Security Administrator
  'f28a1f50-f6e7-4571-818b-6a12f2af6b6c', // SharePoint Administrator
  '29232cdf-9323-42fd-afe2-4ef72784478e', // Exchange Administrator
  'fe930be7-5e62-47db-91af-98c3a49a38b1', // User Administrator
  'b0f54661-2d74-4c50-afa3-1ec803f12efe', // Billing Administrator
  '17315797-102d-40b4-93e0-432062caca18', // Compliance Administrator
  'b1be1c3e-b65d-4f19-8427-f6fa0d97feb9', // Conditional Access Administrator
  'c4e39bd9-1100-46d3-8c65-fb160da0071f', // Authentication Administrator
  '7be44c8a-adaf-4e2a-84d6-ab2649e08a13', // Privileged Authentication Administrator
  'e8611ab8-c189-46e8-94e1-60213ab1f814', // Privileged Role Administrator
  '729827e3-9c14-49f7-bb1b-9608f156bbb8', // Helpdesk Administrator
  '966707d0-3269-4727-9be2-8c3a10f19b9d', // Password Administrator
  '158c047a-c907-4556-b7ef-446551a6b5f7', // Cloud Application Administrator
  '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3', // Application Administrator
]
const ADMIN_ROLES_PS = ADMIN_ROLES.map(r => `'${r}'`).join(', ')

function buildCAScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)
  const state = config.state || 'enabled'
  const excGrps  = psArr(config.excludeGroups)
  const excUsrs  = psArr(config.excludeUsers)
  const hasExcG  = hasItems(config.excludeGroups)
  const hasExcU  = hasItems(config.excludeUsers)
  const excClause = [
    hasExcG ? `; ExcludeGroups = ${excGrps}` : '',
    hasExcU ? `; ExcludeUsers = ${excUsrs}` : '',
  ].join('')

  // Policies that require AAD P2 (risk-based sign-in/user risk conditions)
  const CA_P2 = new Set(['CA007', 'CA008', 'CA009', 'CA017', 'CA023', 'CA037'])
  // Policies that require Intune in addition to P1 (device compliance / app protection)
  const CA_INTUNE = new Set(['CA004', 'CA010', 'CA011', 'CA012', 'CA024', 'CA027', 'CA035', 'CA046'])

  const lw = CA_P2.has(policy.id)
    ? licWarn('$_licP2', policy.id, 'Azure AD Premium P2 required — risk-based sign-in/user-risk conditions require Entra ID P2 (included in E5, EMS E5)')
    : CA_INTUNE.has(policy.id)
    ? licWarn('$_licP1 -and $_licIntune', policy.id, 'Azure AD Premium P1 and Microsoft Intune required — device compliance and app protection conditions need both (included in Business Premium, E3+)')
    : licWarn('$_licP1', policy.id, 'Azure AD Premium P1 required — Conditional Access policies need Entra ID P1 (included in E3, E5, Business Premium)')

  // Shorthand condition builders
  const allUsers = () => `@{ IncludeUsers = @('All')${excClause} }`
  const adminRoles = () => `@{ IncludeRoles = @(${ADMIN_ROLES_PS})${excClause} }`
  const guestsOnly = () => `@{ IncludeGuestsOrExternalUsers = @{ ExternalTenants = @{ '@odata.type' = '#microsoft.graph.allExternalTenants'; MembershipKind = 'all' }; GuestOrExternalUserTypes = 'internalGuest,b2bCollaborationGuest,b2bCollaborationMember' }${excClause} }`

  const allApps    = `@{ IncludeApplications = @('All') }`
  const o365Apps   = `@{ IncludeApplications = @('Office365') }`
  const azureMgmt  = `@{ IncludeApplications = @('797f4846-ba00-4fd7-ba43-dac1f8f63013') }`
  const spoApp     = `@{ IncludeApplications = @('00000003-0000-0ff1-ce00-000000000000') }`
  const exoApp     = `@{ IncludeApplications = @('00000002-0000-0ff1-ce00-000000000000') }`
  const intuneApp  = `@{ IncludeApplications = @('0000000a-0000-0000-c000-000000000000') }`
  const devOpsApps = `@{ IncludeApplications = @('499b84ac-1321-427f-aa17-267ca6975798', '45aa2ecc-ce2a-4f12-b79b-a3a61ea1b0fe') }`
  const powerApps  = `@{ IncludeApplications = @('871c010f-5e61-4fb1-83ac-98610a7e9110', '00000009-0000-0000-c000-000000000000', 'cab96880-db5b-4e15-90a7-f3f1d62ffe39') }`

  const grantMfa       = `@{ Operator = 'OR'; BuiltInControls = @('mfa') }`
  const grantBlock     = `@{ Operator = 'OR'; BuiltInControls = @('block') }`
  const grantCompliant = `@{ Operator = 'OR'; BuiltInControls = @('compliantDevice', 'domainJoinedDevice') }`
  const grantAppProt   = `@{ Operator = 'AND'; BuiltInControls = @('approvedApplication', 'compliantApplication') }`
  const grantPwdChange = `@{ Operator = 'OR'; BuiltInControls = @('passwordChange') }`
  const grantPhishRes  = `@{ Operator = 'OR'; AuthenticationStrength = @{ Id = '00000000-0000-0000-0000-000000000004' } }`
  const grantStrong    = `@{ Operator = 'OR'; AuthenticationStrength = @{ Id = '00000000-0000-0000-0000-000000000002' } }`

  function caPolicy(users, apps, grant, extra = '', session = null) {
    const conds = `@{ Users = ${users}; Applications = ${apps}${extra} }`
    const parts = [`DisplayName = ${psStr(displayName)}`, `State = ${psStr(state)}`, `Conditions = ${conds}`]
    if (grant) parts.push(`GrantControls = ${grant}`)
    if (session) parts.push(`SessionControls = ${session}`)
    return `$params = @{
    ${parts.join('\n    ')}
}
$created = New-MgIdentityConditionalAccessPolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) State=$($created.State)"`
  }

  // Wrap switch in IIFE so we can post-process the result once to inject lw,
  // rather than modifying every individual case branch.
  const _raw = (() => { switch (policy.id) {
    case 'CA001': return policyBlock(policy.id, policy.name, caPolicy(
      `@{ IncludeUsers = @('All'); ExcludeRoles = @('62e90394-69f5-4237-9190-012177145e10')${excClause} }`,
      allApps, grantMfa))

    case 'CA002': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantBlock, `; ClientAppTypes = @('exchangeActiveSync', 'other')`))

    case 'CA003': return policyBlock(policy.id, policy.name, caPolicy(adminRoles(), allApps, grantMfa))

    case 'CA004': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), allApps, grantCompliant))

    case 'CA005': return policyBlock(policy.id, policy.name,
      `$nlName = 'United Kingdom (CA005)'
$nl = Get-MgIdentityConditionalAccessNamedLocation -ErrorAction SilentlyContinue | Where-Object { $_.AdditionalProperties.displayName -eq $nlName -or $_.DisplayName -eq $nlName } | Select-Object -First 1
if ($nl) {
    Write-Output "  Named location '$nlName' already exists — reusing it"
} else {
    $nlParams = @{ '@odata.type' = '#microsoft.graph.countryNamedLocation'; DisplayName = $nlName; CountriesAndRegions = @('GB'); IncludeUnknownCountriesAndRegions = $false }
    $nl = New-MgIdentityConditionalAccessNamedLocation -BodyParameter $nlParams
    Write-Output "  Created named location: $nlName (ID=$($nl.Id))"
}
Write-Output "  Using named location ID: $($nl.Id)"
$params = @{
    DisplayName = ${psStr(displayName)}; State = ${psStr(state)}
    Conditions = @{ Users = ${allUsers()}; Applications = ${allApps}; Locations = @{ IncludeLocations = @('All'); ExcludeLocations = @($nl.Id) } }
    GrantControls = ${grantBlock}
}
$created = New-MgIdentityConditionalAccessPolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) State=$($created.State)"`)

    case 'CA006': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), azureMgmt, grantMfa))

    case 'CA007': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantBlock, `; SignInRiskLevels = @('high')`))

    case 'CA008': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantPwdChange, `; UserRiskLevels = @('high')`))

    case 'CA009': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantMfa, `; SignInRiskLevels = @('medium', 'high')`))

    case 'CA010': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), spoApp, grantCompliant))

    case 'CA011': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantAppProt, `; Platforms = @{ IncludePlatforms = @('iOS') }`))

    case 'CA012': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantAppProt, `; Platforms = @{ IncludePlatforms = @('android') }`))

    case 'CA013': return policyBlock(policy.id, policy.name, caPolicy(guestsOnly(), o365Apps, grantMfa))

    case 'CA014': return policyBlock(policy.id, policy.name, caPolicy(guestsOnly(), allApps, grantMfa))

    case 'CA015': {
      const h = parseInt(config.sessionFrequencyHours || '8', 10)
      return policyBlock(policy.id, policy.name, caPolicy(
        allUsers(), allApps, grantMfa, '',
        `@{ SignInFrequency = @{ IsEnabled = $true; Type = 'hours'; Value = ${h} } }`))
    }

    case 'CA016': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantMfa, '',
      `@{ PersistentBrowser = @{ IsEnabled = $true; Mode = 'never' } }`))

    case 'CA017': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantMfa, `; SignInRiskLevels = @('medium', 'high')`))

    case 'CA018': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantBlock,
      `; Platforms = @{ IncludePlatforms = @('all'); ExcludePlatforms = @('android','iOS','windows','macOS','linux') }`))

    case 'CA019': return policyBlock(policy.id, policy.name,
      `$params = @{
    DisplayName = ${psStr(displayName)}; State = ${psStr(state)}
    Conditions = @{ Users = ${allUsers()}; Applications = @{ IncludeUserActions = @('urn:user:registersecurityinfo') } }
    GrantControls = ${grantMfa}
}
$created = New-MgIdentityConditionalAccessPolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) State=$($created.State)"`)

    case 'CA020': return skipBlock(policy.id, policy.name,
      'Requires a Named Location with approved IP ranges to already exist. Create the named location in Azure portal first, then configure this policy with that location ID.')

    case 'CA021': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), allApps, grantMfa))

    case 'CA022': return skipBlock(policy.id, policy.name,
      'Block access for specific users by disabling their accounts in Azure AD (Set-MgUser -AccountEnabled $false) rather than via a CA policy.')

    case 'CA023': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantStrong, `; Platforms = @{ IncludePlatforms = @('windows') }`))

    case 'CA024': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), exoApp, grantCompliant, `; ClientAppTypes = @('exchangeActiveSync')`))

    case 'CA025': return policyBlock(policy.id, policy.name,
      `$params = @{
    DisplayName = ${psStr(displayName)}; State = ${psStr(state)}
    Conditions = @{ Users = ${allUsers()}; Applications = ${allApps}; AuthenticationFlows = @{ TransferMethods = 'deviceCodeFlow' } }
    GrantControls = ${grantBlock}
}
$created = New-MgIdentityConditionalAccessPolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) State=$($created.State)"`)

    case 'CA026': return policyBlock(policy.id, policy.name, caPolicy(adminRoles(), allApps, grantPhishRes))

    case 'CA027': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), exoApp, grantCompliant))

    case 'CA028': {
      const ranges = (config.ipRanges || '').split(',').map(s => s.trim()).filter(Boolean)
      if (!ranges.length) return skipBlock(policy.id, policy.name, 'No IP ranges provided. Add IP ranges in the Configure step.')
      const rangesPs = ranges.map(r => `@{ '@odata.type' = '#microsoft.graph.iPv4CidrRange'; CidrAddress = '${safe(r)}' }`).join(', ')
      const nlName = config.locationName || 'Corporate Office IPs'
      return policyBlock(policy.id, policy.name,
        `$nlName = ${psStr(nlName)}
$nl = Get-MgIdentityConditionalAccessNamedLocation -ErrorAction SilentlyContinue | Where-Object { $_.AdditionalProperties.displayName -eq $nlName -or $_.DisplayName -eq $nlName } | Select-Object -First 1
if ($nl) {
    Write-Output "  Named location '$nlName' already exists — updating IP ranges"
    $nlParams = @{ IsTrusted = $true; IpRanges = @(${rangesPs}) }
    Update-MgIdentityConditionalAccessNamedLocation -NamedLocationId $nl.Id -BodyParameter $nlParams
    Write-Output "  Updated named location: $nlName"
} else {
    $nlParams = @{ '@odata.type' = '#microsoft.graph.ipNamedLocation'; DisplayName = $nlName; IsTrusted = $true; IpRanges = @(${rangesPs}) }
    $nl = New-MgIdentityConditionalAccessNamedLocation -BodyParameter $nlParams
    Write-Output "  Created named location: $nlName"
}
Write-Output "  Named location ID: $($nl.Id)"`)
    }

    case 'CA030': return policyBlock(policy.id, policy.name,
      `$params = @{
    DisplayName = ${psStr(displayName)}; State = ${psStr(state)}
    Conditions = @{ Users = ${allUsers()}; Applications = ${allApps} }
    SessionControls = @{ ApplicationEnforcedRestrictions = @{ IsEnabled = $true } }
}
$created = New-MgIdentityConditionalAccessPolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) State=$($created.State)"`)

    case 'CA031': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), intuneApp, grantMfa))

    case 'CA032': return skipBlock(policy.id, policy.name,
      'Time-of-day access controls are not supported in Azure AD CA policies via Graph API.')

    case 'CA033': return policyBlock(policy.id, policy.name, caPolicy(adminRoles(), allApps, grantMfa))

    case 'CA034': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantMfa, '',
      `@{ ContinuousAccessEvaluation = @{ Mode = 'strictLocation' } }`))

    case 'CA035': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantCompliant,
      `; Platforms = @{ IncludePlatforms = @('iOS','android') }`))

    case 'CA036': return skipBlock(policy.id, policy.name,
      'Workload identity policies require Azure AD Workload Identities Premium. Configure via Entra admin centre > Conditional Access > Workload identities.')

    case 'CA037': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantPwdChange, `; UserRiskLevels = @('medium', 'high')`))

    case 'CA038':
    case 'CA039': return skipBlock(policy.id, policy.name,
      'Global Secure Access requires Microsoft Entra Internet Access/Private Access licences.')

    case 'CA040': return skipBlock(policy.id, policy.name,
      'Block shared mailbox sign-in via: Get-Mailbox -RecipientTypeDetails SharedMailbox | ForEach-Object { Set-MsolUser -BlockCredential $true }')

    case 'CA041': return skipBlock(policy.id, policy.name,
      'VPN-based CA requires NPS extension or compatible VPN provider. Configure based on your VPN solution.')

    case 'CA042': return policyBlock(policy.id, policy.name,
      `$params = @{
    DisplayName = ${psStr(displayName)}; State = ${psStr(state)}
    Conditions = @{ Users = ${allUsers()}; Applications = ${allApps} }
    SessionControls = @{ ApplicationEnforcedRestrictions = @{ IsEnabled = $true } }
}
$created = New-MgIdentityConditionalAccessPolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) State=$($created.State)"`)

    case 'CA043': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantBlock, `; ClientAppTypes = @('other')`))

    case 'CA044': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), devOpsApps, grantMfa))

    case 'CA045': {
      const h = parseInt(config.sessionLifetimeHours || '1', 10)
      return policyBlock(policy.id, policy.name, caPolicy(
        adminRoles(), allApps, grantMfa, '',
        `@{ SignInFrequency = @{ IsEnabled = $true; Type = 'hours'; Value = ${h} } }`))
    }

    case 'CA046': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantBlock,
      `; Devices = @{ DeviceFilter = @{ Mode = 'exclude'; Rule = "device.isCompliant -eq True" } }`))

    case 'CA047': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(),
      `@{ IncludeApplications = @('All'); ExcludeApplications = @('Office365','00000002-0000-0ff1-ce00-000000000000') }`,
      grantMfa))

    case 'CA048': return skipBlock(policy.id, policy.name,
      'TLS version enforcement is at the service/infrastructure layer, not Conditional Access. Exchange Online enforces TLS 1.2+ by default.')

    case 'CA049': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), powerApps, grantMfa))

    case 'CA050': return skipBlock(policy.id, policy.name,
      'Emergency access exclusion: add break-glass account Object IDs to the Exclude Groups field on all other CA policies.')

    default: return skipBlock(policy.id, policy.name, 'Configure in Azure portal > Conditional Access.')
  } })()
  // Inject license warning at the top of each policyBlock's try-body.
  // skipBlock output contains no 'try {\n' so those pass through unchanged.
  return _raw.includes('\ntry {\n')
    ? _raw.replace('\ntry {\n', `\ntry {\n    ${lw}\n`)
    : _raw
}

// ─── Identity Protection ──────────────────────────────────────────────────────

function buildIPScript(policy, config) {
  const enabled = (config.state || 'enabled') === 'enabled'
  const state = enabled ? 'enabled' : 'disabled'

  // PATCH then GET to verify state was actually applied.
  // The PATCH can return HTTP 200 even if the tenant lacks AAD P2 licensing, so we
  // confirm the persisted state after the write and warn if it didn't take effect.
  const graphPatchVerified = (uri, body, verifyNote) => {
    const riskLevelsExpr = verifyNote
    return `${licWarn('$_licP2', policy.id, 'Azure AD Premium P2 required — Identity Protection risk policies require Entra ID P2 (included in E5, EMS E5)')}
$_body = ${body} | ConvertTo-Json -Depth 10
Invoke-MgGraphRequest -Method PATCH -Uri '${uri}' -Body $_body -ContentType 'application/json' | Out-Null
$_r = Invoke-MgGraphRequest -Method GET -Uri '${uri}' -OutputType PSObject
Write-Output "  Confirmed: state=$($_r.state)${riskLevelsExpr}"
if ($_r.state -ne '${state}') { Write-Output "  WARNING: state was not applied — verify your tenant has Azure AD Premium P2 licensing" }`
  }

  const graphPatch = (uri, body) =>
    `Invoke-MgGraphRequest -Method PATCH -Uri '${uri}' -Body (${body} | ConvertTo-Json -Depth 10) -ContentType 'application/json' | Out-Null`

  switch (policy.id) {
    case 'IP001': return policyBlock(policy.id, policy.name,
      graphPatchVerified(
        'https://graph.microsoft.com/beta/identityProtection/policies/signInRiskPolicy',
        `@{ state = '${state}'; conditions = @{ signInRiskLevels = @('medium', 'high') }; grantControls = @{ operator = 'OR'; builtInControls = @('mfa') } }`,
        `, signInRiskLevels=$($_r.conditions.signInRiskLevels -join ',')`
      ))

    case 'IP002': return policyBlock(policy.id, policy.name,
      graphPatchVerified(
        'https://graph.microsoft.com/beta/identityProtection/policies/userRiskPolicy',
        `@{ state = '${state}'; conditions = @{ userRiskLevels = @('medium', 'high') }; grantControls = @{ operator = 'OR'; builtInControls = @('passwordChange') } }`,
        `, userRiskLevels=$($_r.conditions.userRiskLevels -join ',')`
      ))

    case 'IP003': return policyBlock(policy.id, policy.name,
      licWarn('$_licP1', policy.id, 'Azure AD Premium P1 required — authentication method policies need Entra ID P1 (included in E3, E5, Business Premium)') + '\n' +
      graphPatch('https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/microsoftAuthenticator',
        `@{ state = '${state}' }`))

    default: return skipBlock(policy.id, policy.name,
      `This detection (${policy.name}) is automatic in Azure AD Identity Protection. Verify in Entra portal > Protection > Identity Protection.`)
  }
}

// ─── Exchange Online ──────────────────────────────────────────────────────────

function buildEXScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)
  const enabled = (config.state || 'enabled') === 'enabled'
  const $e = enabled ? '$true' : '$false'

  const DEFENDER_EX = new Set(['EX008', 'EX009', 'EX010', 'EX035'])
  const lw = DEFENDER_EX.has(policy.id)
    ? licWarn('$_licDefO365', policy.id, 'Microsoft Defender for Office 365 Plan 1 required — Safe Attachments, Safe Links and anti-phishing need Defender for O365 P1 (included in Business Premium, E5)')
    : licWarn('$_licExchange', policy.id, 'Exchange Online license required — mailbox and transport policies require an Exchange Online subscription (included in E1/E3/E5, Business plans)')

  const _raw = (() => { switch (policy.id) {
    case 'EX001': return policyBlock(policy.id, policy.name,
      `Get-AcceptedDomain | Where-Object { $_.DomainType -eq 'Authoritative' } | ForEach-Object {
    try { Set-DkimSigningConfig -Identity $_.DomainName -Enabled ${$e} -ErrorAction Stop }
    catch { New-DkimSigningConfig -DomainName $_.DomainName -Enabled ${$e} | Out-Null }
    Write-Output "  DKIM configured: $($_.DomainName)"
}`)

    case 'EX004': {
      const spam = config.spamAction || 'Quarantine'
      const hcSpam = config.highConfidenceSpamAction || 'Quarantine'
      return policyBlock(policy.id, policy.name,
        `$pn = ${psStr(displayName)}
$p = @{ SpamAction = '${safe(spam)}'; HighConfidenceSpamAction = '${safe(hcSpam)}'; PhishSpamAction = 'Quarantine'; HighConfidencePhishAction = 'Quarantine'; BulkThreshold = 6; MarkAsSpamSpfRecordHardFail = $true; EnableRegionBlockList = ${$e} }
if (Get-HostedContentFilterPolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Set-HostedContentFilterPolicy -Identity $pn @p
} else {
    New-HostedContentFilterPolicy -Name $pn @p | Out-Null
    New-HostedContentFilterRule -Name $pn -HostedContentFilterPolicy $pn -RecipientDomainIs (Get-AcceptedDomain).DomainName | Out-Null
}`)
    }

    case 'EX005': return policyBlock(policy.id, policy.name,
      `$p = @{ RecipientLimitExternalPerHour = 500; RecipientLimitInternalPerHour = 1000; RecipientLimitPerDay = 1000; ActionWhenThresholdReached = 'BlockUserForToday'; AutoForwardingMode = 'Off' }
Set-HostedOutboundSpamFilterPolicy -Identity 'Default' @p | Out-Null
Write-Output "  Outbound spam limits configured on Default policy"`)

    case 'EX006': return policyBlock(policy.id, policy.name,
      `Set-MalwareFilterPolicy -Identity 'Default' -EnableFileFilter ${$e} -Action DeleteMessage -FileTypes @('ace','ani','app','docm','exe','jar','reg','scr','vbe','vbs','cmd','com','cpl','hta','pif','js') | Out-Null`)

    case 'EX007': return policyBlock(policy.id, policy.name,
      `Set-MalwareFilterPolicy -Identity 'Default' -EnableFileFilter ${$e} -FileTypes @('ace','ani','app','bat','cab','cmd','com','cpl','dll','exe','hta','inf','jar','js','jse','lnk','msi','pif','ps1','reg','scr','url','vb','vbe','vbs','wsc','wsf','wsh','xll') | Out-Null`)

    case 'EX008': return policyBlock(policy.id, policy.name,
      `$pn = ${psStr(displayName)}
$p = @{ Enable = ${$e}; Action = 'Block'; Redirect = $false }
if (Get-SafeAttachmentPolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Set-SafeAttachmentPolicy -Identity $pn @p
} else {
    New-SafeAttachmentPolicy -Name $pn @p | Out-Null
    New-SafeAttachmentRule -Name $pn -SafeAttachmentPolicy $pn -RecipientDomainIs (Get-AcceptedDomain).DomainName | Out-Null
}`)

    case 'EX009': return policyBlock(policy.id, policy.name,
      `$pn = ${psStr(displayName)}
$p = @{ IsEnabled = ${$e}; EnableSafeLinksForEmail = ${$e}; EnableSafeLinksForTeams = ${$e}; EnableSafeLinksForOffice = ${$e}; AllowClickThrough = $false; TrackClicks = $true; ScanUrls = $true; DeliverMessageAfterScan = $true }
if (Get-SafeLinksPolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Set-SafeLinksPolicy -Identity $pn @p
} else {
    New-SafeLinksPolicy -Name $pn @p | Out-Null
    New-SafeLinksRule -Name $pn -SafeLinksPolicy $pn -RecipientDomainIs (Get-AcceptedDomain).DomainName | Out-Null
}`)

    case 'EX010': {
      const domains = (config.protectedDomains || '').split(',').map(s => s.trim()).filter(Boolean)
      const users   = (config.protectedUsers || '').split(',').map(s => s.trim()).filter(Boolean)
      const dLine   = domains.length ? `\n$p.TargetedDomainsToProtect = @(${domains.map(d=>`'${safe(d)}'`).join(', ')})` : ''
      const uLine   = users.length   ? `\n$p.TargetedUsersToProtect   = @(${users.map(u=>`'${safe(u)}'`).join(', ')})` : ''
      return policyBlock(policy.id, policy.name,
        `$pn = ${psStr(displayName)}
$p = @{ Enabled = ${$e}; EnableMailboxIntelligence = $true; EnableMailboxIntelligenceProtection = $true; EnableSpoofIntelligence = $true; EnableOrganizationDomainsProtection = $true; PhishThresholdLevel = 3; MailboxIntelligenceProtectionAction = 'Quarantine'; TargetedUserProtectionAction = 'Quarantine'; TargetedDomainProtectionAction = 'Quarantine' }${dLine}${uLine}
if (Get-AntiPhishPolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Set-AntiPhishPolicy -Identity $pn @p
} else {
    New-AntiPhishPolicy -Name $pn @p | Out-Null
    New-AntiPhishRule -Name $pn -AntiPhishPolicy $pn -RecipientDomainIs (Get-AcceptedDomain).DomainName | Out-Null
}`)
    }

    case 'EX011': return policyBlock(policy.id, policy.name,
      `Set-RemoteDomain -Identity 'Default' -AutoForwardEnabled $false`)

    case 'EX012': return policyBlock(policy.id, policy.name,
      `Get-Mailbox -ResultSize Unlimited -Filter "RecipientTypeDetails -eq 'UserMailbox'" | ForEach-Object {
    Set-Mailbox -Identity $_.Identity -AuditEnabled ${$e} -AuditAdmin @('Copy','Create','FolderBind','HardDelete','Move','SendAs','SendOnBehalf','SoftDelete','Update','UpdateInboxRules') -AuditDelegate @('Create','FolderBind','HardDelete','Move','SendAs','SendOnBehalf','SoftDelete','Update') -AuditOwner @('Create','HardDelete','Undelete') -ErrorAction SilentlyContinue
}
Write-Output "  Mailbox audit enabled for all user mailboxes"`)

    case 'EX015': return policyBlock(policy.id, policy.name,
      `Set-OrganizationConfig -OAuth2ClientProfileEnabled ${$e}`)

    case 'EX016': return policyBlock(policy.id, policy.name,
      `Get-AuthenticationPolicy | ForEach-Object {
    Set-AuthenticationPolicy -Identity $_.Identity -AllowBasicAuthActiveSync:$false -AllowBasicAuthAutodiscover:$false -AllowBasicAuthImap:$false -AllowBasicAuthMapi:$false -AllowBasicAuthOfflineAddressBook:$false -AllowBasicAuthOutlookService:$false -AllowBasicAuthPop:$false -AllowBasicAuthRpc:$false -AllowBasicAuthSmtp:$false -AllowBasicAuthWebServices:$false -AllowBasicAuthPowershell:$false -ErrorAction SilentlyContinue
    Write-Output "  Basic auth disabled: $($_.Name)"
}`)

    case 'EX017': return policyBlock(policy.id, policy.name,
      `$rn = ${psStr(displayName)}
if (-not (Get-TransportRule -Identity $rn -ErrorAction SilentlyContinue)) {
    New-TransportRule -Name $rn -AttachmentFileExtensionMatchesWords @('docm','xlsm','pptm','xlam','dotm') -PrependSubject '[MACRO WARNING] ' -Mode ${enabled ? 'Enforce' : 'Audit'} | Out-Null
}`)

    case 'EX018': return policyBlock(policy.id, policy.name,
      `$rn = ${psStr(displayName)}
if (-not (Get-TransportRule -Identity $rn -ErrorAction SilentlyContinue)) {
    New-TransportRule -Name $rn -FromScope 'NotInOrganization' -SentToScope 'InOrganization' -PrependSubject '[EXTERNAL] ' -Mode ${enabled ? 'Enforce' : 'Audit'} -StopRuleProcessing $false | Out-Null
}`)

    case 'EX025': return policyBlock(policy.id, policy.name,
      `Set-HostedContentFilterPolicy -Identity 'Default' -BulkThreshold 6 | Out-Null`)

    case 'EX031': return policyBlock(policy.id, policy.name,
      `Get-CASMailbox -ResultSize Unlimited | ForEach-Object {
    Set-CASMailbox -Identity $_.Identity -POPEnabled $false -IMAPEnabled $false -ErrorAction SilentlyContinue
}
Write-Output "  POP3/IMAP4 disabled for all mailboxes"`)

    case 'EX032': return policyBlock(policy.id, policy.name,
      `$rn = ${psStr(displayName)}
if (-not (Get-TransportRule -Identity $rn -ErrorAction SilentlyContinue)) {
    New-TransportRule -Name $rn -AttachmentIsPasswordProtected $true -RejectMessageReasonText 'Password-protected archives not permitted' -RejectMessageEnhancedStatusCode '5.7.1' -Mode ${enabled ? 'Enforce' : 'Audit'} | Out-Null
}`)

    case 'EX035': return policyBlock(policy.id, policy.name,
      `Set-HostedContentFilterPolicy -Identity 'Default' -ZapEnabled ${$e} | Out-Null`)

    case 'EX036': return policyBlock(policy.id, policy.name,
      `Get-CASMailbox -ResultSize Unlimited | Where-Object { -not $_.SmtpClientAuthenticationDisabled } | ForEach-Object {
    Set-CASMailbox -Identity $_.Identity -SmtpClientAuthenticationDisabled $true -ErrorAction SilentlyContinue
}
Write-Output "  SMTP AUTH disabled for all applicable mailboxes"`)

    default: return skipBlock(policy.id, policy.name,
      `Configure in Exchange admin centre or Defender portal. ${policy.description}`)
  } })()
  return _raw.includes('\ntry {\n')
    ? _raw.replace('\ntry {\n', `\ntry {\n    ${lw}\n`)
    : _raw
}

// ─── SharePoint & OneDrive ────────────────────────────────────────────────────

function buildSPScript(policy, config) {
  const enabled = (config.state || 'enabled') === 'enabled'
  const patch = (body) =>
    `$body = ${body} | ConvertTo-Json -Depth 5
Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.com/v1.0/admin/sharepoint/settings' -Body $body -ContentType 'application/json' | Out-Null`

  const lw = licWarn('$_licSharePoint', policy.id, 'SharePoint Online license required — sharing and external access settings require SharePoint Online (included in E1/E3/E5, Business plans)')

  const _raw = (() => { switch (policy.id) {
    // SP001: Disable anonymous "Anyone" links — authenticated external sharing still allowed
    case 'SP001': return policyBlock(policy.id, policy.name, patch(`@{ sharingCapability = 'ExternalUserSharingOnly' }`))
    // SP002: Restrict to existing known external users only
    case 'SP002': return policyBlock(policy.id, policy.name, patch(`@{ sharingCapability = 'ExistingExternalUserSharingOnly' }`))
    case 'SP003': return policyBlock(policy.id, policy.name, patch(`@{ defaultSharingLinkType = 'specific' }`))
    case 'SP011': {
      const days = parseInt(config.guestExpiryDays || '30', 10)
      return policyBlock(policy.id, policy.name, patch(`@{ guestSharingGroupAllowListInTenantByPrincipalIdentity = @(); isGuestUserSharingLimitedToSelectedDomains = $false; guestExpirationEnabled = $true; guestExpirationInDays = ${days} }`))
    }
    case 'SP016': return policyBlock(policy.id, policy.name, patch(`@{ isOneDriveForGuestsEnabled = $false }`))
    case 'SP023': return skipBlock(policy.id, policy.name,
      'Minimum TLS 1.2 for SharePoint is enforced at the Azure AD tenant level and is not configurable via the SharePoint admin Graph API. Microsoft 365 enforces TLS 1.2+ by default for all services.')
    default: return skipBlock(policy.id, policy.name, `Configure in SharePoint admin centre. ${policy.description}`)
  } })()
  return _raw.includes('\ntry {\n')
    ? _raw.replace('\ntry {\n', `\ntry {\n    ${lw}\n`)
    : _raw
}

// ─── Teams ────────────────────────────────────────────────────────────────────

function buildTEScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)
  const enabled = (config.state || 'enabled') === 'enabled'

  const lw = licWarn('$_licTeams', policy.id, 'Microsoft Teams license required — Teams policy cmdlets require a Teams subscription (included in E1/E3/E5, Business plans)')

  const _raw = (() => { switch (policy.id) {
    case 'TE003': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsMeetingPolicy -Identity 'Global' -AllowAnonymousUsersToJoinMeeting $false -AllowAnonymousUsersToStartMeeting $false -ErrorAction SilentlyContinue`)

    case 'TE004': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsMeetingPolicy -Identity 'Global' -AutoAdmittedUsers 'EveryoneInCompanyExcludingGuests' -AllowPSTNUsersToBypassLobby $false -ErrorAction SilentlyContinue`)

    case 'TE005': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsMeetingPolicy -Identity 'Global' -AllowCloudRecording $false -ErrorAction SilentlyContinue`)

    case 'TE011': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsAppSetupPolicy -Identity 'Global' -AllowSideLoading $false -ErrorAction SilentlyContinue`)

    case 'TE015': return skipBlock(policy.id, policy.name,
      'Disable via Teams admin centre: External access > Allow communication with Teams users not managed by an organisation, or run: Set-CsExternalAccessPolicy -EnableTeamsConsumerAccess $false in Teams PowerShell.')

    case 'TE017': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsMeetingPolicy -Identity 'Global' -MeetingRecordingExpirationDays 60 -ErrorAction SilentlyContinue`)

    default: return skipBlock(policy.id, policy.name, `Configure in Teams admin centre. ${policy.description}`)
  } })()
  return _raw.includes('\ntry {\n')
    ? _raw.replace('\ntry {\n', `\ntry {\n    ${lw}\n`)
    : _raw
}

// ─── Intune / Endpoint ────────────────────────────────────────────────────────

function buildENScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)

  function winCompliance(extra) {
    return `$params = @{ '@odata.type' = '#microsoft.graph.windows10CompliancePolicy'; DisplayName = ${psStr(displayName)}; ${extra} }
$created = New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) DisplayName=$($created.DisplayName)"`
  }
  function macCompliance(extra) {
    return `$params = @{ '@odata.type' = '#microsoft.graph.macOSCompliancePolicy'; DisplayName = ${psStr(displayName)}; ${extra} }
$created = New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) DisplayName=$($created.DisplayName)"`
  }
  function iosCompliance(extra) {
    return `$params = @{ '@odata.type' = '#microsoft.graph.iosCompliancePolicy'; DisplayName = ${psStr(displayName)}; ${extra} }
$created = New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) DisplayName=$($created.DisplayName)"`
  }
  function androidCompliance(extra) {
    return `$params = @{ '@odata.type' = '#microsoft.graph.androidWorkProfileCompliancePolicy'; DisplayName = ${psStr(displayName)}; ${extra} }
$created = New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) DisplayName=$($created.DisplayName)"`
  }

  const lw = licWarn('$_licIntune', policy.id, 'Microsoft Intune license required — device compliance policies require Intune (included in E3/E5, Business Premium, EMS E3/E5)')

  const _raw = (() => { switch (policy.id) {
    case 'EN001': return policyBlock(policy.id, policy.name, winCompliance('BitLockerEnabled = $true; StorageRequireDeviceEncryption = $true'))
    // SignatureOutOfDate = $true means mark device non-compliant if AV signatures are stale
    case 'EN002': return policyBlock(policy.id, policy.name, winCompliance('DefenderEnabled = $true; rtpEnabled = $true; SignatureOutOfDate = $true'))
    case 'EN003': return policyBlock(policy.id, policy.name, winCompliance('FirewallEnabled = $true'))
    case 'EN004': return policyBlock(policy.id, policy.name, winCompliance(`OsMinimumVersion = ${psStr(config.minOsVersion || '10.0.19045.0')}`))
    case 'EN005': return policyBlock(policy.id, policy.name, winCompliance('SecureBootEnabled = $true'))
    case 'EN007': return policyBlock(policy.id, policy.name, macCompliance('StorageRequireEncryption = $true'))
    case 'EN008': return policyBlock(policy.id, policy.name, macCompliance(`OsMinimumVersion = ${psStr(config.minMacOsVersion || '13.0')}`))
    case 'EN009': return policyBlock(policy.id, policy.name, macCompliance('FirewallEnabled = $true'))
    case 'EN010': return policyBlock(policy.id, policy.name, iosCompliance(`OsMinimumVersion = ${psStr(config.minIosVersion || '16.0')}`))
    case 'EN011': return policyBlock(policy.id, policy.name, iosCompliance('PasscodeRequired = $true; PasscodeMinimumLength = 6; PasscodeBlockSimple = $true'))
    case 'EN012': return policyBlock(policy.id, policy.name, iosCompliance('SecurityBlockJailbrokenDevices = $true'))
    case 'EN013': return policyBlock(policy.id, policy.name, androidCompliance(`OsMinimumVersion = ${psStr(config.minAndroidVersion || '11.0')}`))
    case 'EN014': return policyBlock(policy.id, policy.name, androidCompliance('StorageRequireEncryption = $true'))
    case 'EN015': return policyBlock(policy.id, policy.name, androidCompliance('SecurityBlockJailbrokenDevices = $true; SecurityBlockDeviceAdministratorManagedDevices = $true'))
    // Signature update interval is a Device Configuration property, not compliance policy
    case 'EN049': return policyBlock(policy.id, policy.name,
      `$params = @{ '@odata.type' = '#microsoft.graph.windows10EndpointProtectionConfiguration'; DisplayName = ${psStr(displayName)}; defenderSignatureUpdateIntervalInHours = 1 }
$created = New-MgDeviceManagementDeviceConfiguration -BodyParameter $params
Write-Output "  CREATED: ID=$($created.Id) DisplayName=$($created.DisplayName)"`)

    default: return skipBlock(policy.id, policy.name, `Configure in Microsoft Intune admin centre. ${policy.description}`)
  } })()
  return _raw.includes('\ntry {\n')
    ? _raw.replace('\ntry {\n', `\ntry {\n    ${lw}\n`)
    : _raw
}

// ─── Defender ─────────────────────────────────────────────────────────────────

function buildDEScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)
  const enabled = (config.state || 'enabled') === 'enabled'
  const notifEmail = config.notificationEmail || ''

  const lw = licWarn('$_licDefO365', policy.id, 'Microsoft Defender for Office 365 Plan 1 required — Defender for O365 policies need the ATP_ENTERPRISE service plan (included in Business Premium, E5)')

  const _raw = (() => { switch (policy.id) {
    case 'DE001': return policyBlock(policy.id, policy.name,
      `Set-AtpPolicyForO365 -EnableATPForSPOTeamsODB $true -EnableSafeDocs $true -AllowSafeDocsOpen $false | Out-Null`)

    case 'DE002': return policyBlock(policy.id, policy.name,
      `try {
    Set-HostedContentFilterPolicy -Identity 'Strict Preset Security Policy' -SpamAction Quarantine -HighConfidenceSpamAction Quarantine -PhishSpamAction Quarantine -HighConfidencePhishAction Quarantine -BulkThreshold 4 -ErrorAction Stop | Out-Null
} catch {
    Write-Output "  INFO: Strict preset security policy requires Defender for Office 365 Plan 1+"
}`)

    case 'DE038': return policyBlock(policy.id, policy.name,
      `Set-AtpPolicyForO365 -EnableSafeDocs $true -AllowSafeDocsOpen $false | Out-Null`)

    default: return skipBlock(policy.id, policy.name,
      `Configure in Microsoft Defender portal (security.microsoft.com). ${policy.description}`)
  } })()
  return _raw.includes('\ntry {\n')
    ? _raw.replace('\ntry {\n', `\ntry {\n    ${lw}\n`)
    : _raw
}

// ─── Audit & Compliance ───────────────────────────────────────────────────────

function buildACScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)
  const enabled = (config.state || 'enabled') === 'enabled'
  const $e = enabled ? '$true' : '$false'
  const notifEmail = config.notificationEmail || ''

  const PURVIEW_AC = new Set(['AC007', 'AC012', 'AC013', 'AC014', 'AC043'])
  const lw = PURVIEW_AC.has(policy.id)
    ? licWarn('$_licPurview', policy.id, 'Microsoft Purview (E5 Compliance) license required — DLP and retention compliance policies need the INFORMATION_PROTECTION_COMPLIANCE service plan (included in E5 Compliance, M365 E5)')
    : licWarn('$_licExchange', policy.id, 'Exchange Online license required — audit log configuration requires an Exchange Online subscription (included in E1/E3/E5, Business plans)')

  function retentionPolicy(location, years) {
    const days = (parseInt(years, 10) || 7) * 365
    return `$pn = ${psStr(displayName)}
if (Get-RetentionCompliancePolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Write-Output "  Retention policy already exists: $pn"
} else {
    New-RetentionCompliancePolicy -Name $pn ${location} -Enabled ${$e} | Out-Null
    New-RetentionComplianceRule -Name "${safe(displayName)} - Rule" -Policy $pn -RetentionDuration ${days} -RetentionComplianceAction 'Keep' | Out-Null
}`
  }

  const _raw = (() => { switch (policy.id) {
    case 'AC001': return policyBlock(policy.id, policy.name,
      `Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled ${$e} -ErrorAction SilentlyContinue | Out-Null
Write-Output "  Unified audit log enabled: ${enabled}"`)

    case 'AC004': return policyBlock(policy.id, policy.name,
      `Get-Mailbox -ResultSize Unlimited | ForEach-Object {
    Set-Mailbox -Identity $_.Identity -AuditEnabled ${$e} -AuditAdmin @('Copy','Create','FolderBind','HardDelete','Move','SendAs','SoftDelete','Update') -ErrorAction SilentlyContinue
}
Write-Output "  Admin mailbox audit actions configured"`)

    case 'AC005': return policyBlock(policy.id, policy.name,
      `Get-Mailbox -ResultSize Unlimited | ForEach-Object {
    Set-Mailbox -Identity $_.Identity -AuditEnabled ${$e} -AuditDelegate @('Create','FolderBind','HardDelete','Move','SendAs','SendOnBehalf','SoftDelete','Update') -ErrorAction SilentlyContinue
}
Write-Output "  Delegate mailbox audit actions configured"`)

    case 'AC007': return policyBlock(policy.id, policy.name,
      `$pn = ${psStr(displayName)}
if (Get-DlpCompliancePolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Set-DlpCompliancePolicy -Identity $pn -Mode ${enabled ? 'Enable' : 'Disable'} | Out-Null
} else {
    New-DlpCompliancePolicy -Name $pn -SharePointLocation 'All' -ExchangeLocation 'All' -OneDriveLocation 'All' -TeamsLocation 'All' -Mode ${enabled ? 'Enable' : 'Disable'} | Out-Null
    New-DlpComplianceRule -Name "${safe(displayName)} - Rule" -Policy $pn -ContentContainsSensitiveInformation @(@{Name='Credit Card Number';minCount=1},@{Name='U.S. Social Security Number (SSN)';minCount=1}) -BlockAccess $true | Out-Null
}`)

    case 'AC012': return policyBlock(policy.id, policy.name,
      retentionPolicy(`-TeamsChannelLocation 'All' -TeamsChatLocation 'All'`, config.retentionYears || 7))

    case 'AC013': return policyBlock(policy.id, policy.name,
      retentionPolicy(`-SharePointLocation 'All' -OneDriveLocation 'All'`, config.retentionYears || 7))

    case 'AC014': return policyBlock(policy.id, policy.name,
      retentionPolicy(`-ExchangeLocation 'All'`, config.retentionYears || 7))

    case 'AC043': return policyBlock(policy.id, policy.name,
      `$pn = ${psStr(displayName)}
if (Get-DlpCompliancePolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Set-DlpCompliancePolicy -Identity $pn -Mode ${enabled ? 'Enable' : 'Disable'} | Out-Null
} else {
    New-DlpCompliancePolicy -Name $pn -SharePointLocation 'All' -ExchangeLocation 'All' -OneDriveLocation 'All' -TeamsLocation 'All' -Mode ${enabled ? 'Enable' : 'Disable'} | Out-Null
    New-DlpComplianceRule -Name "${safe(displayName)} - Rule" -Policy $pn -ContentContainsSensitiveInformation @(@{Name='Credit Card Number';minCount=1;minConfidence=75}) -BlockAccess $true | Out-Null
}`)

    default: return skipBlock(policy.id, policy.name,
      `Configure in Microsoft Purview compliance portal. ${policy.description}`)
  } })()
  return _raw.includes('\ntry {\n')
    ? _raw.replace('\ntry {\n', `\ntry {\n    ${lw}\n`)
    : _raw
}

// ─── Admin Security ───────────────────────────────────────────────────────────

function buildASScript(policy, config) {
  switch (policy.id) {
    case 'AS002': return skipBlock(policy.id, policy.name,
      'PIM is available with Azure AD P2. Activate via Entra admin centre > Identity Governance > Privileged Identity Management.')

    case 'AS007': return skipBlock(policy.id, policy.name,
      'Create dedicated admin accounts (admin@domain.com) and remove admin roles from daily-use accounts in Azure AD.')

    case 'AS008': {
      const max = parseInt(config.maxGlobalAdmins || '5', 10)
      return policyBlock(policy.id, policy.name,
        `$gaRole = Get-MgDirectoryRole -Filter "DisplayName eq 'Global Administrator'" -ErrorAction SilentlyContinue
if ($gaRole) {
    $members = Get-MgDirectoryRoleMember -DirectoryRoleId $gaRole.Id
    Write-Output "  Global Administrator count: $($members.Count)"
    if ($members.Count -gt ${max}) {
        Write-Output "  WARNING: $($members.Count) Global Admins exceeds threshold of ${max}"
    }
}`)
    }

    case 'AS018': return policyBlock(policy.id, policy.name,
      licWarn('$_licP1', policy.id, 'Azure AD Premium P1 required — OAuth app consent policy configuration needs Entra ID P1 (included in E3, E5, Business Premium)') + '\n' +
      `$body = @{ permissionGrantPolicyIdsAssignedToDefaultUserRole = @('ManagePermissionGrantsForSelf.microsoft-user-default-low') } | ConvertTo-Json
Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.com/v1.0/policies/authorizationPolicy' -Body $body -ContentType 'application/json' | Out-Null
Write-Output "  User consent restricted to verified low-risk apps"`)

    case 'AS019': return policyBlock(policy.id, policy.name,
      `$gaRole = Get-MgDirectoryRole -Filter "DisplayName eq 'Global Administrator'" -ErrorAction SilentlyContinue
if ($gaRole) {
    $members = Get-MgDirectoryRoleMember -DirectoryRoleId $gaRole.Id
    Write-Output "  $($members.Count) Global Administrator(s) found"
    Write-Output "  Ensure exactly 2 break-glass accounts exist, excluded from all CA policies, with passwords stored offline"
}`)

    default: return skipBlock(policy.id, policy.name,
      `Configure in Microsoft Entra admin centre. ${policy.description}`)
  }
}

// ─── Tenant Baseline ──────────────────────────────────────────────────────────

function buildTBScript(policy, config) {
  const enabled = (config.state || 'enabled') === 'enabled'
  const $e = enabled ? '$true' : '$false'

  const patch = (uri, body) =>
    `Invoke-MgGraphRequest -Method PATCH -Uri '${uri}' -Body (${body} | ConvertTo-Json -Depth 10) -ContentType 'application/json' | Out-Null`

  // TB002 = EXO cmdlet (no Graph P1 needed), TB011/TB016 = free tenant settings
  const TB_FREE = new Set(['TB002', 'TB011', 'TB016'])
  const lw = TB_FREE.has(policy.id) ? null
    : licWarn('$_licP1', policy.id, 'Azure AD Premium P1 required — authentication and tenant security configuration needs Entra ID P1 (included in E3, E5, Business Premium)')

  const _raw = (() => { switch (policy.id) {
    case 'TB002': return policyBlock(policy.id, policy.name,
      `Set-OrganizationConfig -OAuth2ClientProfileEnabled ${$e} -ErrorAction SilentlyContinue | Out-Null`)

    case 'TB007': return policyBlock(policy.id, policy.name,
      patch(`'https://graph.microsoft.com/v1.0/policies/authorizationPolicy'`,
        `@{ permissionGrantPolicyIdsAssignedToDefaultUserRole = @('ManagePermissionGrantsForSelf.microsoft-user-default-low') }`))

    case 'TB008': return policyBlock(policy.id, policy.name,
      patch(`'https://graph.microsoft.com/v1.0/policies/authorizationPolicy'`,
        `@{ defaultUserRolePermissions = @{ allowedToCreateTenants = $false } }`))

    case 'TB009': return policyBlock(policy.id, policy.name,
      patch(`'https://graph.microsoft.com/v1.0/policies/authorizationPolicy'`,
        `@{ allowInvitesFrom = 'adminsAndGuestInviters' }`))

    case 'TB011': return policyBlock(policy.id, policy.name,
      `Get-MgOrganization | ForEach-Object {
    $body = @{ isLinkedInEnabled = $false } | ConvertTo-Json
    Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/organization/$($_.Id)" -Body $body -ContentType 'application/json' | Out-Null
}`)

    case 'TB012': return policyBlock(policy.id, policy.name,
      patch(`'https://graph.microsoft.com/v1.0/policies/authorizationPolicy'`,
        `@{ defaultUserRolePermissions = @{ allowedToCreateApps = $false } }`))

    case 'TB015': {
      const threshold = parseInt(config.lockoutThreshold || '10', 10)
      // Smart Lockout is configured via the PasswordRuleSettings directory setting template
      return policyBlock(policy.id, policy.name,
        `$templateId = '5cf42378-d67d-4f36-ba46-e8b86229381d'
$settingValues = @(
    @{ name = 'LockoutThreshold'; value = '${threshold}' }
    @{ name = 'LockoutDurationInSeconds'; value = '120' }
)
$existing = (Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/settings' -OutputType PSObject).value | Where-Object { $_.templateId -eq $templateId } | Select-Object -First 1
if ($existing) {
    $body = @{ templateId = $templateId; values = $settingValues } | ConvertTo-Json -Depth 5
    Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/beta/settings/$($existing.id)" -Body $body -ContentType 'application/json' | Out-Null
    Write-Output "  Smart Lockout updated: threshold=${threshold}, duration=120s"
} else {
    $body = @{ templateId = $templateId; values = $settingValues } | ConvertTo-Json -Depth 5
    Invoke-MgGraphRequest -Method POST -Uri 'https://graph.microsoft.com/beta/settings' -Body $body -ContentType 'application/json' | Out-Null
    Write-Output "  Smart Lockout created: threshold=${threshold}, duration=120s"
}`)
    }

    case 'TB016': return policyBlock(policy.id, policy.name,
      `Get-MgDomain | ForEach-Object {
    $body = @{ passwordValidityPeriodInDays = 2147483647; passwordNotificationWindowInDays = 0 } | ConvertTo-Json
    Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/domains/$($_.Id)" -Body $body -ContentType 'application/json' -ErrorAction SilentlyContinue | Out-Null
    Write-Output "  Password expiry disabled: $($_.Id)"
}`)

    case 'TB017': return policyBlock(policy.id, policy.name,
      patch(`'https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/microsoftAuthenticator'`,
        `@{ state = '${enabled ? "enabled" : "disabled"}'; featureSettings = @{ displayAppInformationRequiredState = @{ state = 'enabled'; includeTarget = @{ targetType = 'group'; id = 'all_users' } }; numberMatchingRequiredState = @{ state = 'enabled'; includeTarget = @{ targetType = 'group'; id = 'all_users' } } } }`))

    case 'TB024': return policyBlock(policy.id, policy.name,
      patch(`'https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/microsoftAuthenticator'`,
        `@{ state = 'enabled'; featureSettings = @{ numberMatchingRequiredState = @{ state = 'enabled'; includeTarget = @{ targetType = 'group'; id = 'all_users' } } } }`))

    case 'TB025': return policyBlock(policy.id, policy.name,
      patch(`'https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/microsoftAuthenticator'`,
        `@{ state = 'enabled'; featureSettings = @{ displayAppInformationRequiredState = @{ state = 'enabled'; includeTarget = @{ targetType = 'group'; id = 'all_users' } }; displayLocationInformationRequiredState = @{ state = 'enabled'; includeTarget = @{ targetType = 'group'; id = 'all_users' } } } }`))

    default: return skipBlock(policy.id, policy.name,
      `Configure in Microsoft Entra admin centre. ${policy.description}`)
  } })()
  if (!lw) return _raw
  return _raw.includes('\ntry {\n')
    ? _raw.replace('\ntry {\n', `\ntry {\n    ${lw}\n`)
    : _raw
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function buildPolicyScript(policy, config, prefix) {
  if (config.skip) return skipBlock(policy.id, policy.name, 'Skipped — set policy mode to Active to deploy')
  switch (policy.category) {
    case 'Conditional Access':    return buildCAScript(policy, config, prefix)
    case 'Identity Protection':   return buildIPScript(policy, config)
    case 'Exchange Online':       return buildEXScript(policy, config, prefix)
    case 'SharePoint & OneDrive': return buildSPScript(policy, config)
    case 'Teams':                 return buildTEScript(policy, config, prefix)
    case 'Intune / Endpoint':     return buildENScript(policy, config, prefix)
    case 'Defender':              return buildDEScript(policy, config, prefix)
    case 'Audit & Compliance':    return buildACScript(policy, config, prefix)
    case 'Admin Security':        return buildASScript(policy, config)
    case 'Tenant Baseline':       return buildTBScript(policy, config)
    default:                      return skipBlock(policy.id, policy.name, 'Unknown category')
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function buildModuleImports(graph, exo, ipps) {
  const lines = []
  if (graph) lines.push(
    `if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) { Write-Output "ERROR: Microsoft Graph modules not found - install them on the Modules page"; exit 1 }`,
    `Import-Module Microsoft.Graph.Authentication -ErrorAction Stop`,
    `Import-Module Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue`,
    `Import-Module Microsoft.Graph.DeviceManagement -ErrorAction SilentlyContinue`,
    `Import-Module Microsoft.Graph.Identity.DirectoryManagement -ErrorAction SilentlyContinue`
  )
  if (exo) lines.push(
    `if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) { Write-Output "ERROR: ExchangeOnlineManagement module not found - install it on the Modules page"; exit 1 }`,
    `Import-Module ExchangeOnlineManagement -ErrorAction Stop`
  )
  return lines.join('\n')
}

function buildScript(policies, credentials, prefix, authMode = 'interactive', policyConfigs = {}, opts = {}) {
  const hasGraph = policies.some(p => !needsExo(p))
  const hasExo   = policies.some(p => needsExo(p))
  const hasIpps  = policies.some(p => needsIpps(p))

  const parts = [PS_PREFS, '', buildModuleImports(hasGraph, hasExo, hasIpps), '']

  if (hasGraph) parts.push(buildConnectGraph(credentials, authMode, opts))
  if (hasExo)   parts.push(buildConnectExo(credentials, authMode))
  if (hasIpps)  parts.push(buildConnectIpps(credentials, authMode))

  if (hasGraph) parts.push(buildLicenseCheckScript())
  parts.push('')
  for (const policy of policies) {
    parts.push(buildPolicyScript(policy, policyConfigs[policy.id] || {}, prefix))
  }

  parts.push('')
  parts.push(buildDisconnects(hasGraph, hasExo, hasIpps))

  return parts.join('\n')
}

// Builds only the policy creation blocks — no auth, no module imports, no disconnect.
// Used when running through an already-authenticated persistent session.
function buildPoliciesScript(policies, prefix, policyConfigs = {}) {
  const parts = [PS_PREFS, '', buildLicenseCheckScript()]
  for (const policy of policies) {
    parts.push(buildPolicyScript(policy, policyConfigs[policy.id] || {}, prefix))
  }
  return parts.join('\n')
}

module.exports = { buildScript, buildConnectGraph, buildPoliciesScript, buildPolicyScript, needsExo, needsIpps }
