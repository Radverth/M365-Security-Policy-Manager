'use strict'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PS_PREFS = `$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'`

function safe(s) { return (s || '').replace(/'/g, "''") }
function psStr(s) { return `'${safe(s)}'` }
function psArr(str) {
  if (!str || !str.trim()) return '@()'
  const items = str.split(',').map(s => s.trim()).filter(Boolean)
  return items.length ? `@(${items.map(i => `'${safe(i)}'`).join(', ')})` : '@()'
}
function hasItems(str) { return !!(str && str.trim()) }

function policyBlock(id, name, body) {
  const indented = body.trim().split('\n').map(l => '    ' + l).join('\n')
  return `
Write-Output "CREATING: ${id} - ${name}"
try {
${indented}
    Write-Output "SUCCESS: ${id} created"
} catch {
    Write-Output "FAILURE: ${id} - $($_.Exception.Message)"
}`
}

function skipBlock(id, name, reason) {
  return `
Write-Output "CREATING: ${id} - ${name}"
Write-Output "INFO: ${id} - ${reason}"
Write-Output "SUCCESS: ${id} noted"`
}

function dn(policy, prefix) {
  const base = `${policy.id}: ${policy.name}`
  return prefix ? `${safe(prefix)} - ${base}` : base
}

// ─── Connection detection ─────────────────────────────────────────────────────

const EXO_CATS = new Set(['Exchange Online'])
const EXO_IDS  = new Set(['DE001','DE002','DE038','AC001','AC004','AC005','EX028'])
const IPPS_IDS = new Set(['AC007','AC008','AC012','AC013','AC014','AC043','SP007','SP008','SP009','TE009','TE010'])

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
    return `Write-Output "CONNECTING: Follow the device code prompt below..."
try {
    Connect-MgGraph ${tid} -UseDeviceAuthentication -Scopes ${scopes} -NoWelcome -ErrorAction Stop
    Write-Output "CONNECTED: Microsoft Graph"
} catch {
    $errMsg = $_.Exception.Message
    if ($errMsg -match 'listener') {${verifyBlock}
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
            Connect-MgGraph ${tid} -UseDeviceAuthentication -Scopes ${scopes} -NoWelcome -ErrorAction Stop
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

function buildConnectExo(credentials, authMode) {
  if (authMode === 'interactive') {
    return `Write-Output "CONNECTING: Exchange Online (device code)..."
try {
    Connect-ExchangeOnline -Device -ShowBanner:$false -ErrorAction Stop
    Write-Output "CONNECTED: Exchange Online"
} catch {
    Write-Output "ERROR: EXO connect failed - $($_.Exception.Message)"
}`
  }
  const upn = credentials?.username ? `-UserPrincipalName '${safe(credentials.username)}'` : ''
  return `Write-Output "CONNECTING: Exchange Online..."
try {
    Connect-ExchangeOnline ${upn} -ShowBanner:$false
    Write-Output "CONNECTED: Exchange Online"
} catch {
    Write-Output "ERROR: EXO connect failed - $($_.Exception.Message)"
}`
}

function buildConnectIpps(credentials, authMode) {
  if (authMode === 'interactive') {
    return `Write-Output "CONNECTING: Security & Compliance (device code)..."
try {
    Connect-IPPSSession -Device -ShowBanner:$false -ErrorAction Stop
    Write-Output "CONNECTED: Security & Compliance"
} catch {
    Write-Output "ERROR: IPPS connect failed - $($_.Exception.Message)"
}`
  }
  const upn = credentials?.username ? `-UserPrincipalName '${safe(credentials.username)}'` : ''
  return `Write-Output "CONNECTING: Security & Compliance..."
try {
    Connect-IPPSSession ${upn} -ShowBanner:$false
    Write-Output "CONNECTED: Security & Compliance"
} catch {
    Write-Output "ERROR: IPPS connect failed - $($_.Exception.Message)"
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
  const excGrps = psArr(config.excludeGroups)
  const hasExc = hasItems(config.excludeGroups)
  const excClause = hasExc ? `; ExcludeGroups = ${excGrps}` : ''

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
New-MgIdentityConditionalAccessPolicy -BodyParameter $params | Out-Null`
  }

  switch (policy.id) {
    case 'CA001': return policyBlock(policy.id, policy.name, caPolicy(
      `@{ IncludeUsers = @('All'); ExcludeRoles = @('62e90394-69f5-4237-9190-012177145e10')${excClause} }`,
      allApps, grantMfa))

    case 'CA002': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantBlock, `; ClientAppTypes = @('exchangeActiveSync', 'other')`))

    case 'CA003': return policyBlock(policy.id, policy.name, caPolicy(adminRoles(), allApps, grantMfa))

    case 'CA004': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), allApps, grantCompliant))

    case 'CA005': return policyBlock(policy.id, policy.name,
      `$nlParams = @{ '@odata.type' = '#microsoft.graph.countryNamedLocation'; DisplayName = 'United Kingdom (CA005)'; CountriesAndRegions = @('GB'); IncludeUnknownCountriesAndRegions = $false }
$nl = New-MgIdentityConditionalAccessNamedLocation -BodyParameter $nlParams
Write-Output "  Created named location: United Kingdom (GB)"
$params = @{
    DisplayName = ${psStr(displayName)}; State = ${psStr(state)}
    Conditions = @{ Users = ${allUsers()}; Applications = ${allApps}; Locations = @{ IncludeLocations = @('All'); ExcludeLocations = @($nl.Id) } }
    GrantControls = ${grantBlock}
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params | Out-Null`)

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
New-MgIdentityConditionalAccessPolicy -BodyParameter $params | Out-Null`)

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
    Conditions = @{ Users = ${allUsers()}; Applications = ${allApps}; AuthenticationFlows = @{ TransferMethods = @('deviceCodeFlow') } }
    GrantControls = ${grantBlock}
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params | Out-Null`)

    case 'CA026': return policyBlock(policy.id, policy.name, caPolicy(adminRoles(), allApps, grantPhishRes))

    case 'CA027': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), exoApp, grantCompliant))

    case 'CA028': {
      const ranges = (config.ipRanges || '').split(',').map(s => s.trim()).filter(Boolean)
      if (!ranges.length) return skipBlock(policy.id, policy.name, 'No IP ranges provided. Add IP ranges in the Configure step.')
      const rangesPs = ranges.map(r => `@{ '@odata.type' = '#microsoft.graph.iPv4CidrRange'; CidrAddress = '${safe(r)}' }`).join(', ')
      return policyBlock(policy.id, policy.name,
        `$nlParams = @{ '@odata.type' = '#microsoft.graph.ipNamedLocation'; DisplayName = ${psStr(config.locationName || 'Corporate Office IPs')}; IsTrusted = $true; IpRanges = @(${rangesPs}) }
New-MgIdentityConditionalAccessNamedLocation -BodyParameter $nlParams | Out-Null`)
    }

    case 'CA030': return policyBlock(policy.id, policy.name,
      `$params = @{
    DisplayName = ${psStr(displayName)}; State = ${psStr(state)}
    Conditions = @{ Users = ${allUsers()}; Applications = ${allApps} }
    SessionControls = @{ ApplicationEnforcedRestrictions = @{ IsEnabled = $true } }
}
New-MgIdentityConditionalAccessPolicy -BodyParameter $params | Out-Null`)

    case 'CA031': return policyBlock(policy.id, policy.name, caPolicy(allUsers(), intuneApp, grantMfa))

    case 'CA032': return skipBlock(policy.id, policy.name,
      'Time-of-day access controls are not supported in Azure AD CA policies via Graph API.')

    case 'CA033': return policyBlock(policy.id, policy.name, caPolicy(adminRoles(), allApps, grantMfa))

    case 'CA034': return policyBlock(policy.id, policy.name, caPolicy(
      allUsers(), allApps, grantMfa, '',
      `@{ ContinuousAccessEvaluation = @{ Mode = 'strictlocation' } }`))

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
New-MgIdentityConditionalAccessPolicy -BodyParameter $params | Out-Null`)

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
  }
}

// ─── Identity Protection ──────────────────────────────────────────────────────

function buildIPScript(policy, config) {
  const enabled = (config.state || 'enabled') === 'enabled'
  const state = enabled ? 'enabled' : 'disabled'

  const graphPatch = (uri, body) =>
    `Invoke-MgGraphRequest -Method PATCH -Uri '${uri}' -Body (${body} | ConvertTo-Json -Depth 10) -ContentType 'application/json' | Out-Null`

  switch (policy.id) {
    case 'IP001': return policyBlock(policy.id, policy.name,
      graphPatch('https://graph.microsoft.com/beta/identityProtection/policies/signInRiskPolicy',
        `@{ state = '${state}'; riskLevel = 'medium' }`))

    case 'IP002': return policyBlock(policy.id, policy.name,
      graphPatch('https://graph.microsoft.com/beta/identityProtection/policies/userRiskPolicy',
        `@{ state = '${state}'; riskLevel = 'medium' }`))

    case 'IP003': return policyBlock(policy.id, policy.name,
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

  switch (policy.id) {
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
      `$pn = ${psStr(displayName)}
$p = @{ RecipientLimitExternalPerHour = 500; RecipientLimitInternalPerHour = 1000; RecipientLimitPerDay = 1000; ActionWhenThresholdReached = 'BlockUserForToday'; AutoForwardingMode = 'Off' }
if (Get-HostedOutboundSpamFilterPolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Set-HostedOutboundSpamFilterPolicy -Identity $pn @p
} else {
    New-HostedOutboundSpamFilterPolicy -Name $pn @p | Out-Null
}`)

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
    if (-not $_.ExternalDirectoryObjectId) {
        Set-CASMailbox -Identity $_.Identity -SmtpClientAuthenticationDisabled $true -ErrorAction SilentlyContinue
    }
}
Write-Output "  SMTP AUTH disabled for mailboxes not requiring it"`)

    default: return skipBlock(policy.id, policy.name,
      `Configure in Exchange admin centre or Defender portal. ${policy.description}`)
  }
}

// ─── SharePoint & OneDrive ────────────────────────────────────────────────────

function buildSPScript(policy, config) {
  const enabled = (config.state || 'enabled') === 'enabled'
  const patch = (body) =>
    `$body = ${body} | ConvertTo-Json -Depth 5
Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.com/v1.0/admin/sharepoint/settings' -Body $body -ContentType 'application/json' | Out-Null`

  switch (policy.id) {
    case 'SP001': return policyBlock(policy.id, policy.name, patch(`@{ sharingCapability = 'ExistingExternalUserSharingOnly' }`))
    case 'SP002': return policyBlock(policy.id, policy.name, patch(`@{ sharingCapability = 'ExistingExternalUserSharingOnly' }`))
    case 'SP003': return policyBlock(policy.id, policy.name, patch(`@{ defaultSharingLinkType = 'specific' }`))
    case 'SP011': {
      const days = parseInt(config.guestExpiryDays || '30', 10)
      return policyBlock(policy.id, policy.name, patch(`@{ guestSharingGroupAllowListInTenantByPrincipalIdentity = @(); isGuestUserSharingLimitedToSelectedDomains = $false; guestExpirationEnabled = $true; guestExpirationInDays = ${days} }`))
    }
    case 'SP016': return policyBlock(policy.id, policy.name, patch(`@{ isOneDriveForGuestsEnabled = $false }`))
    case 'SP023': return policyBlock(policy.id, policy.name, patch(`@{ isTlsEnabled = $true }`))
    default: return skipBlock(policy.id, policy.name, `Configure in SharePoint admin centre. ${policy.description}`)
  }
}

// ─── Teams ────────────────────────────────────────────────────────────────────

function buildTEScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)
  const enabled = (config.state || 'enabled') === 'enabled'

  switch (policy.id) {
    case 'TE003': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsMeetingPolicy -Identity 'Global' -AllowAnonymousUsersToJoinMeeting $false -AllowAnonymousUsersToStartMeeting $false -ErrorAction SilentlyContinue`)

    case 'TE004': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsMeetingPolicy -Identity 'Global' -AutoAdmittedUsers 'EveryoneInCompanyExcludingGuests' -AllowPSTNUsersToBypassLobby $false -ErrorAction SilentlyContinue`)

    case 'TE005': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsMeetingPolicy -Identity 'Global' -AllowCloudRecording $false -ErrorAction SilentlyContinue`)

    case 'TE011': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsAppSetupPolicy -Identity 'Global' -AllowSideLoading $false -ErrorAction SilentlyContinue`)

    case 'TE015': return policyBlock(policy.id, policy.name,
      `Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.com/beta/teamwork/teamsAppSettings' -Body (@{ isPersonalAccountsEnabled = $false } | ConvertTo-Json) -ContentType 'application/json' -ErrorAction SilentlyContinue | Out-Null`)

    case 'TE017': return policyBlock(policy.id, policy.name,
      `Set-CsTeamsMeetingPolicy -Identity 'Global' -MeetingRecordingExpirationDays 60 -ErrorAction SilentlyContinue`)

    default: return skipBlock(policy.id, policy.name, `Configure in Teams admin centre. ${policy.description}`)
  }
}

// ─── Intune / Endpoint ────────────────────────────────────────────────────────

function buildENScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)

  function winCompliance(extra) {
    return `$params = @{ '@odata.type' = '#microsoft.graph.windows10CompliancePolicy'; DisplayName = ${psStr(displayName)}; ${extra}; scheduledActionsForRule = @() }
New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params | Out-Null`
  }
  function macCompliance(extra) {
    return `$params = @{ '@odata.type' = '#microsoft.graph.macOSCompliancePolicy'; DisplayName = ${psStr(displayName)}; ${extra}; scheduledActionsForRule = @() }
New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params | Out-Null`
  }
  function iosCompliance(extra) {
    return `$params = @{ '@odata.type' = '#microsoft.graph.iosCompliancePolicy'; DisplayName = ${psStr(displayName)}; ${extra}; scheduledActionsForRule = @() }
New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params | Out-Null`
  }
  function androidCompliance(extra) {
    return `$params = @{ '@odata.type' = '#microsoft.graph.androidWorkProfileCompliancePolicy'; DisplayName = ${psStr(displayName)}; ${extra}; scheduledActionsForRule = @() }
New-MgDeviceManagementDeviceCompliancePolicy -BodyParameter $params | Out-Null`
  }

  switch (policy.id) {
    case 'EN001': return policyBlock(policy.id, policy.name, winCompliance('BitLockerEnabled = $true; StorageRequireDeviceEncryption = $true'))
    case 'EN002': return policyBlock(policy.id, policy.name, winCompliance('DefenderEnabled = $true; RTPEnabled = $true; SignatureOutOfDate = $false'))
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
    case 'EN049': return policyBlock(policy.id, policy.name, winCompliance('DefenderSignatureUpdateIntervalInHours = 72'))
    default: return skipBlock(policy.id, policy.name, `Configure in Microsoft Intune admin centre. ${policy.description}`)
  }
}

// ─── Defender ─────────────────────────────────────────────────────────────────

function buildDEScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)
  const enabled = (config.state || 'enabled') === 'enabled'
  const notifEmail = config.notificationEmail || ''

  switch (policy.id) {
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
  }
}

// ─── Audit & Compliance ───────────────────────────────────────────────────────

function buildACScript(policy, config, prefix) {
  const displayName = dn(policy, prefix)
  const enabled = (config.state || 'enabled') === 'enabled'
  const $e = enabled ? '$true' : '$false'
  const notifEmail = config.notificationEmail || ''

  function retentionPolicy(location, years) {
    const days = (parseInt(years, 10) || 7) * 365
    return `$pn = ${psStr(displayName)}
if (Get-RetentionCompliancePolicy -Identity $pn -ErrorAction SilentlyContinue) {
    Write-Output "  Retention policy already exists: $pn"
} else {
    New-RetentionCompliancePolicy -Name $pn ${location} -Enabled ${$e} | Out-Null
    New-RetentionComplianceRule -Name "${safe(displayName)} - Rule" -Policy $pn -RetentionDuration ${days} -RetentionDurationDisplayHint 'Days' -ExpirationDateOption 'CreationAgeInDays' | Out-Null
}`
  }

  switch (policy.id) {
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
  }
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

  switch (policy.id) {
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
      return policyBlock(policy.id, policy.name,
        patch(`'https://graph.microsoft.com/beta/settings/smartLockout'`,
          `@{ lockoutThreshold = ${threshold}; lockoutDurationInSeconds = 120 }`))
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
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function buildPolicyScript(policy, config, prefix) {
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
    `if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) { Write-Output "ERROR: Microsoft.Graph module not found - install it on the Modules page"; exit 1 }`,
    `Import-Module Microsoft.Graph.Authentication -ErrorAction Stop`,
    `Import-Module Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue`,
    `Import-Module Microsoft.Graph.DeviceManagement -ErrorAction SilentlyContinue`,
    `Import-Module Microsoft.Graph -ErrorAction SilentlyContinue`
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

  parts.push('')
  for (const policy of policies) {
    parts.push(buildPolicyScript(policy, policyConfigs[policy.id] || {}, prefix))
  }

  parts.push('')
  parts.push(buildDisconnects(hasGraph, hasExo, hasIpps))

  return parts.join('\n')
}

module.exports = { buildScript, buildConnectGraph }
