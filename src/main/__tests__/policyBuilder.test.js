'use strict'

const { buildScript, buildPoliciesScript, needsExo, needsIpps } = require('../policyBuilder')

// Minimal policy objects matching the shape used by the UI
function pol(id, category, name = id) {
  return { id, category, name, description: 'Test policy' }
}

const CA = 'Conditional Access'
const IP = 'Identity Protection'
const EX = 'Exchange Online'
const SP = 'SharePoint & OneDrive'
const TE = 'Teams'
const EN = 'Intune / Endpoint'
const DE = 'Defender'
const AC = 'Audit & Compliance'
const AS = 'Admin Security'
const TB = 'Tenant Baseline'

// Helper: generate a single-policy script with no prefix and no config overrides
function script1(id, category, name, config = {}) {
  return buildPoliciesScript([pol(id, category, name)], '', { [id]: config })
}

// ─── needsExo / needsIpps ────────────────────────────────────────────────────

describe('needsExo', () => {
  test('true for Exchange Online category', () => {
    expect(needsExo(pol('EX001', EX))).toBe(true)
  })
  test('true for EXO_IDS set members', () => {
    expect(needsExo(pol('DE001', DE))).toBe(true)
    expect(needsExo(pol('DE002', DE))).toBe(true)
    expect(needsExo(pol('AC001', AC))).toBe(true)
  })
  test('false for Conditional Access', () => {
    expect(needsExo(pol('CA001', CA))).toBe(false)
  })
  test('true for TB002 (uses Set-OrganizationConfig EXO cmdlet)', () => {
    expect(needsExo(pol('TB002', TB))).toBe(true)
  })
  test('false for SharePoint', () => {
    expect(needsExo(pol('SP001', SP))).toBe(false)
  })
})

describe('needsIpps', () => {
  test('true for IPPS IDs (AC007, AC012, AC013, AC014, AC043)', () => {
    expect(needsIpps(pol('AC007', AC))).toBe(true)
    expect(needsIpps(pol('AC012', AC))).toBe(true)
    expect(needsIpps(pol('AC043', AC))).toBe(true)
  })
  test('false for CA policies', () => {
    expect(needsIpps(pol('CA001', CA))).toBe(false)
  })
  test('false for EX policies', () => {
    expect(needsIpps(pol('EX001', EX))).toBe(false)
  })
})

// ─── policyBlock format ───────────────────────────────────────────────────────

describe('policyBlock format (via CA001)', () => {
  let s
  beforeAll(() => { s = script1('CA001', CA, 'Require MFA for All Users') })

  test('contains CREATING marker', () => {
    expect(s).toContain('Write-Output "CREATING: CA001 - Require MFA for All Users"')
  })
  test('contains SUCCESS marker', () => {
    expect(s).toContain('Write-Output "SUCCESS: CA001 created"')
  })
  test('contains FAILURE marker', () => {
    expect(s).toContain('Write-Output "FAILURE: CA001')
  })
  test('has try-catch structure', () => {
    expect(s).toContain('try {')
    expect(s).toContain('} catch {')
  })
  test('extracts Graph API error code from JSON', () => {
    expect(s).toContain('$errJson.error.code')
    expect(s).toContain('$errJson.error.message')
  })
  test('sets ErrorActionPreference to Stop', () => {
    expect(s).toContain("$ErrorActionPreference = 'Stop'")
  })
})

// ─── skipBlock format ─────────────────────────────────────────────────────────

describe('skipBlock format (via CA028 with no IP ranges)', () => {
  let s
  beforeAll(() => { s = script1('CA028', CA, 'Named Location: Office IPs', {}) })

  test('contains CREATING marker', () => {
    expect(s).toContain('Write-Output "CREATING: CA028')
  })
  test('contains INFO marker with reason', () => {
    expect(s).toContain('Write-Output "INFO: CA028 - No IP ranges provided')
  })
  test('contains SKIPPED marker', () => {
    expect(s).toContain('Write-Output "SKIPPED: CA028')
  })
  test('does NOT contain SUCCESS marker', () => {
    // skipBlock must not emit SUCCESS — that was the original bug
    expect(s).not.toContain('Write-Output "SUCCESS: CA028')
  })
})

// ─── Conditional Access ───────────────────────────────────────────────────────

describe('CA001 - Require MFA for All Users', () => {
  let s
  beforeAll(() => { s = script1('CA001', CA, 'Require MFA for All Users') })

  test('calls New-MgIdentityConditionalAccessPolicy', () => {
    expect(s).toContain('New-MgIdentityConditionalAccessPolicy')
  })
  test('includes all users', () => {
    expect(s).toContain("IncludeUsers = @('All')")
  })
  test('requires MFA grant', () => {
    expect(s).toContain("BuiltInControls = @('mfa')")
  })
  test('logs created policy ID', () => {
    expect(s).toContain('$created = New-MgIdentityConditionalAccessPolicy')
    expect(s).toContain('$created.Id')
    expect(s).toContain('$created.State')
  })
  test('excludes Global Administrator role', () => {
    expect(s).toContain('62e90394-69f5-4237-9190-012177145e10')
  })
  test('uses enabled state by default', () => {
    expect(s).toContain("State = 'enabled'")
  })
  test('respects report-only state override', () => {
    const r = script1('CA001', CA, 'Require MFA for All Users', { state: 'enabledForReportingButNotEnforced' })
    expect(r).toContain("State = 'enabledForReportingButNotEnforced'")
  })
})

describe('CA002 - Block Legacy Authentication', () => {
  let s
  beforeAll(() => { s = script1('CA002', CA, 'Block Legacy Auth') })

  test('targets legacy client app types', () => {
    expect(s).toContain('exchangeActiveSync')
    expect(s).toContain("'other'")
  })
  test('grant is block', () => {
    expect(s).toContain("BuiltInControls = @('block')")
  })
})

describe('CA003 - Require MFA for Admins', () => {
  let s
  beforeAll(() => { s = script1('CA003', CA, 'Require MFA for Admins') })

  test('targets admin roles', () => {
    expect(s).toContain('IncludeRoles')
    // Global Administrator role GUID
    expect(s).toContain('62e90394-69f5-4237-9190-012177145e10')
  })
})

describe('CA005 - Block All Non-UK Access', () => {
  let s
  beforeAll(() => { s = script1('CA005', CA, 'Block Non-UK Access') })

  test('creates a country named location for GB', () => {
    expect(s).toContain("CountriesAndRegions = @('GB')")
    expect(s).toContain('New-MgIdentityConditionalAccessNamedLocation')
  })
  test('logs created named location ID', () => {
    expect(s).toContain('ID=$($nl.Id)')
  })
  test('logs created CA policy ID', () => {
    expect(s).toContain('$created = New-MgIdentityConditionalAccessPolicy')
    expect(s).toContain('$created.Id')
  })
  test('blocks all locations except UK', () => {
    expect(s).toContain("IncludeLocations = @('All')")
    expect(s).toContain('ExcludeLocations = @($nl.Id)')
  })
})

describe('CA015 - Session Control: Sign-in Frequency', () => {
  test('uses default 8 hours', () => {
    const s = script1('CA015', CA, 'Sign-in Frequency')
    expect(s).toContain('Value = 8')
    expect(s).toContain("Type = 'hours'")
  })
  test('uses custom frequency', () => {
    const s = script1('CA015', CA, 'Sign-in Frequency', { sessionFrequencyHours: '4' })
    expect(s).toContain('Value = 4')
  })
})

describe('CA025 - Block Device Code Flow', () => {
  let s
  beforeAll(() => { s = script1('CA025', CA, 'Block Device Code Flow') })

  test('targets device code flow', () => {
    expect(s).toContain("TransferMethods = 'deviceCodeFlow'")
  })
  test('grant is block', () => {
    expect(s).toContain("BuiltInControls = @('block')")
  })
  test('logs created policy ID', () => {
    expect(s).toContain('$created = New-MgIdentityConditionalAccessPolicy')
  })
})

describe('CA028 - Named Location: Office IPs', () => {
  test('skips when no IP ranges provided', () => {
    const s = script1('CA028', CA, 'Named Location: Office IPs', {})
    expect(s).toContain('SKIPPED:')
    expect(s).not.toContain('New-MgIdentityConditionalAccessNamedLocation')
  })
  test('creates named location when IP ranges provided', () => {
    const s = script1('CA028', CA, 'Named Location: Office IPs', { ipRanges: '203.0.113.0/24' })
    expect(s).toContain('New-MgIdentityConditionalAccessNamedLocation')
    expect(s).toContain('203.0.113.0/24')
    expect(s).not.toContain('SKIPPED:')
  })
  test('uses default location name when not specified', () => {
    const s = script1('CA028', CA, 'Named Location: Office IPs', { ipRanges: '10.0.0.0/8' })
    expect(s).toContain('Corporate Office IPs')
  })
  test('uses custom location name', () => {
    const s = script1('CA028', CA, 'Named Location: Office IPs', { ipRanges: '10.0.0.0/8', locationName: 'HQ London' })
    expect(s).toContain('HQ London')
  })
  test('handles multiple IP ranges', () => {
    const s = script1('CA028', CA, 'Named Location: Office IPs', { ipRanges: '203.0.113.0/24, 198.51.100.0/24' })
    expect(s).toContain('203.0.113.0/24')
    expect(s).toContain('198.51.100.0/24')
  })
  test('marks existing location as trusted', () => {
    const s = script1('CA028', CA, 'Named Location: Office IPs', { ipRanges: '10.0.0.0/8' })
    expect(s).toContain('IsTrusted = $true')
  })
})

describe('CA045 - Session Lifetime: Admin Accounts', () => {
  test('uses default 1 hour', () => {
    const s = script1('CA045', CA, 'Session Lifetime Admin')
    expect(s).toContain('Value = 1')
  })
  test('uses custom session lifetime', () => {
    const s = script1('CA045', CA, 'Session Lifetime Admin', { sessionLifetimeHours: '4' })
    expect(s).toContain('Value = 4')
  })
  test('targets admin roles', () => {
    const s = script1('CA045', CA, 'Session Lifetime Admin')
    expect(s).toContain('IncludeRoles')
  })
})

describe('CA exclusions', () => {
  test('excludeGroups appear in conditions', () => {
    const s = script1('CA001', CA, 'Require MFA', {
      excludeGroups: [{ id: 'group-id-123', displayName: 'Break Glass' }]
    })
    expect(s).toContain("ExcludeGroups = @('group-id-123')")
  })
  test('excludeUsers appear in conditions', () => {
    const s = script1('CA001', CA, 'Require MFA', {
      excludeUsers: [{ id: 'user-id-456', displayName: 'Admin Account' }]
    })
    expect(s).toContain("ExcludeUsers = @('user-id-456')")
  })
})

describe('CA prefix', () => {
  test('prefix is prepended to display name', () => {
    const s = buildPoliciesScript([pol('CA001', CA, 'Require MFA for All Users')], 'ACME Corp', {})
    expect(s).toContain("DisplayName = 'ACME Corp - CA001: Require MFA for All Users'")
  })
  test('no prefix when empty string', () => {
    const s = buildPoliciesScript([pol('CA001', CA, 'Require MFA for All Users')], '', {})
    expect(s).toContain("DisplayName = 'CA001: Require MFA for All Users'")
  })
})

// ─── Identity Protection ──────────────────────────────────────────────────────

describe('IP001 - Sign-In Risk Policy', () => {
  let s
  beforeAll(() => { s = script1('IP001', IP, 'Enable Sign-In Risk Policy') })

  test('patches signInRiskPolicy endpoint', () => {
    expect(s).toContain('signInRiskPolicy')
    expect(s).toContain('Invoke-MgGraphRequest')
    expect(s).toContain('PATCH')
  })
  test('sets medium and high risk levels with MFA grant', () => {
    expect(s).toContain("signInRiskLevels = @('medium', 'high')")
    expect(s).toContain("builtInControls = @('mfa')")
  })
  test('verifies state after PATCH with GET', () => {
    expect(s).toContain('Method GET')
    expect(s).toContain('Confirmed: state=')
  })
  test('warns about P2 licensing requirement', () => {
    expect(s).toContain('Azure AD Premium P2')
  })
})

describe('IP002 - User Risk Policy', () => {
  let s
  beforeAll(() => { s = script1('IP002', IP, 'Enable User Risk Policy') })

  test('patches userRiskPolicy endpoint', () => {
    expect(s).toContain('userRiskPolicy')
  })
  test('verifies state after PATCH with GET', () => {
    expect(s).toContain('Method GET')
    expect(s).toContain('Confirmed: state=')
  })
  test('warns about P2 licensing requirement', () => {
    expect(s).toContain('Azure AD Premium P2')
  })
})

describe('IP003 - MFA Registration Policy', () => {
  let s
  beforeAll(() => { s = script1('IP003', IP, 'MFA Registration Policy') })

  test('patches microsoftAuthenticator configuration', () => {
    expect(s).toContain('microsoftAuthenticator')
    expect(s).toContain('Invoke-MgGraphRequest')
  })
})

// ─── Exchange Online ──────────────────────────────────────────────────────────

describe('EX001 - Enable DKIM Signing', () => {
  let s
  beforeAll(() => { s = script1('EX001', EX, 'Enable DKIM Signing') })

  test('gets accepted domains', () => {
    expect(s).toContain('Get-AcceptedDomain')
  })
  test('sets DKIM signing config', () => {
    expect(s).toContain('Set-DkimSigningConfig')
  })
  test('creates DKIM config if missing', () => {
    expect(s).toContain('New-DkimSigningConfig')
  })
  test('captures the domain name before the try/catch ($_ is the ErrorRecord inside catch)', () => {
    expect(s).toContain('$domain = $_.DomainName')
    expect(s).toContain('New-DkimSigningConfig -DomainName $domain')
    expect(s).not.toContain('New-DkimSigningConfig -DomainName $_.DomainName')
  })
})

describe('EX006 - Anti-Malware: Default Policy', () => {
  let s
  beforeAll(() => { s = script1('EX006', EX, 'Anti-Malware Default') })

  test('uses FileTypeAction instead of the removed Action parameter', () => {
    expect(s).toContain('Set-MalwareFilterPolicy')
    expect(s).toContain("-FileTypeAction 'Reject'")
    expect(s).not.toContain('-Action DeleteMessage')
  })
  test('enables the common attachments filter', () => {
    expect(s).toContain('-EnableFileFilter')
    expect(s).toContain("'exe'")
  })
})

describe('EX004 - Anti-Spam Inbound Policy', () => {
  test('creates hosted content filter policy', () => {
    const s = script1('EX004', EX, 'Anti-Spam Inbound')
    expect(s).toContain('New-HostedContentFilterPolicy')
    expect(s).toContain('New-HostedContentFilterRule')
  })
  test('uses default quarantine action', () => {
    const s = script1('EX004', EX, 'Anti-Spam Inbound')
    expect(s).toContain("SpamAction = 'Quarantine'")
  })
  test('respects custom spam action', () => {
    const s = script1('EX004', EX, 'Anti-Spam Inbound', { spamAction: 'MoveToJmf' })
    expect(s).toContain("SpamAction = 'MoveToJmf'")
  })
  test('updates existing policy', () => {
    const s = script1('EX004', EX, 'Anti-Spam Inbound')
    expect(s).toContain('Get-HostedContentFilterPolicy')
    expect(s).toContain('Set-HostedContentFilterPolicy')
  })
  test('SPF hard fail uses the SpamFilteringOption enum, not a boolean', () => {
    const s = script1('EX004', EX, 'Anti-Spam Inbound')
    expect(s).toContain("MarkAsSpamSpfRecordHardFail = 'On'")
    expect(s).not.toContain('MarkAsSpamSpfRecordHardFail = $true')
  })
})

describe('EX009 - Safe Links Policy', () => {
  test('does not pass the removed IsEnabled parameter', () => {
    const s = script1('EX009', EX, 'Safe Links')
    expect(s).toContain('New-SafeLinksPolicy')
    expect(s).not.toContain('IsEnabled')
    expect(s).toContain('EnableSafeLinksForEmail = $true')
  })
})

describe('EX008 - Safe Attachments Policy', () => {
  let s
  beforeAll(() => { s = script1('EX008', EX, 'Safe Attachments') })

  test('creates safe attachment policy', () => {
    expect(s).toContain('New-SafeAttachmentPolicy')
  })
  test('creates safe attachment rule for all domains', () => {
    expect(s).toContain('New-SafeAttachmentRule')
    expect(s).toContain('Get-AcceptedDomain')
  })
  test('sets action to Block', () => {
    expect(s).toContain("Action = 'Block'")
  })
})

describe('EX011 - Disable Auto-Forwarding', () => {
  let s
  beforeAll(() => { s = script1('EX011', EX, 'Disable Auto-Forward') })

  test('sets AutoForwardEnabled to false', () => {
    expect(s).toContain('Set-RemoteDomain')
    expect(s).toContain('AutoForwardEnabled $false')
  })
})

describe('EX016 - Disable Basic Authentication', () => {
  let s
  beforeAll(() => { s = script1('EX016', EX, 'Disable Basic Auth') })

  test('iterates authentication policies', () => {
    expect(s).toContain('Get-AuthenticationPolicy')
    expect(s).toContain('Set-AuthenticationPolicy')
  })
  test('disables all basic auth protocols', () => {
    expect(s).toContain('AllowBasicAuthActiveSync:$false')
    expect(s).toContain('AllowBasicAuthImap:$false')
    expect(s).toContain('AllowBasicAuthSmtp:$false')
  })
})

describe('EX017 - Transport Rule: Block Macro-Enabled Docs', () => {
  let s
  beforeAll(() => { s = script1('EX017', EX, 'Block Macro Docs') })

  test('creates transport rule', () => {
    expect(s).toContain('New-TransportRule')
  })
  test('targets macro-enabled file extensions', () => {
    expect(s).toContain('docm')
    expect(s).toContain('xlsm')
    expect(s).toContain('pptm')
  })
  test('uses AttachmentExtensionMatchesWords (AttachmentFileExtensionMatchesWords does not exist)', () => {
    expect(s).toContain('-AttachmentExtensionMatchesWords')
    expect(s).not.toContain('AttachmentFileExtensionMatchesWords')
  })
  test('prepends warning to subject', () => {
    expect(s).toContain('[MACRO WARNING]')
  })
})

describe('EX035 - Zero-Hour Auto Purge (ZAP)', () => {
  test('uses SpamZapEnabled/PhishZapEnabled (ZapEnabled only exists on the malware policy)', () => {
    const s = script1('EX035', EX, 'Zero-Hour Auto Purge')
    expect(s).toContain('-SpamZapEnabled $true')
    expect(s).toContain('-PhishZapEnabled $true')
    expect(s).not.toContain('-ZapEnabled')
  })
})

describe('EX018 - Transport Rule: External Email Warning', () => {
  let s
  beforeAll(() => { s = script1('EX018', EX, 'External Email Warning') })

  test('targets messages from outside the org', () => {
    expect(s).toContain("'NotInOrganization'")
  })
  test('prepends EXTERNAL tag', () => {
    expect(s).toContain('[EXTERNAL]')
  })
})

describe('EX031 - Disable POP3/IMAP4', () => {
  let s
  beforeAll(() => { s = script1('EX031', EX, 'Disable POP3 IMAP4') })

  test('disables POP and IMAP on all mailboxes', () => {
    expect(s).toContain('Get-CASMailbox')
    expect(s).toContain('POPEnabled $false')
    expect(s).toContain('IMAPEnabled $false')
  })
})

// ─── SharePoint & OneDrive ────────────────────────────────────────────────────

describe('SP001 - Restrict External Sharing', () => {
  let s
  beforeAll(() => { s = script1('SP001', SP, 'Restrict External Sharing') })

  test('patches SharePoint settings via Graph', () => {
    expect(s).toContain('Invoke-MgGraphRequest')
    expect(s).toContain('admin/sharepoint/settings')
    expect(s).toContain('PATCH')
  })
  test('disables anonymous Anyone links (ExternalUserSharingOnly)', () => {
    expect(s).toContain('ExternalUserSharingOnly')
  })
})

describe('SP003 - Default Sharing Link', () => {
  let s
  beforeAll(() => { s = script1('SP003', SP, 'Default Sharing Link') })

  test('sets default sharing link to specific people', () => {
    expect(s).toContain("defaultSharingLinkType = 'specific'")
  })
})

describe('SP011 - Guest Expiration Policy', () => {
  test('uses default 30 days', () => {
    const s = script1('SP011', SP, 'Guest Expiration')
    expect(s).toContain('guestExpirationEnabled = $true')
    expect(s).toContain('guestExpirationInDays = 30')
  })
  test('uses custom expiry days', () => {
    const s = script1('SP011', SP, 'Guest Expiration', { guestExpiryDays: '60' })
    expect(s).toContain('guestExpirationInDays = 60')
  })
})

// ─── Teams ────────────────────────────────────────────────────────────────────

describe('TE003 - Disable Anonymous Join', () => {
  let s
  beforeAll(() => { s = script1('TE003', TE, 'Disable Anonymous Join') })

  test('uses Set-CsTeamsMeetingPolicy', () => {
    expect(s).toContain('Set-CsTeamsMeetingPolicy')
  })
  test('disables anonymous users joining', () => {
    expect(s).toContain('AllowAnonymousUsersToJoinMeeting $false')
  })
})

describe('TE015 - Disable Personal Teams Accounts', () => {
  let s
  beforeAll(() => { s = script1('TE015', TE, 'Disable Personal Accounts') })

  test('emits SKIPPED (requires Teams admin centre)', () => {
    expect(s).toContain('SKIPPED: TE015')
  })
  test('includes guidance for Teams admin centre', () => {
    expect(s).toContain('Teams admin centre')
  })
})

// ─── Intune / Endpoint ────────────────────────────────────────────────────────

describe('EN001 - Windows Compliance: Require BitLocker', () => {
  let s
  beforeAll(() => { s = script1('EN001', EN, 'Windows Compliance BitLocker') })

  test('creates a windows10CompliancePolicy', () => {
    expect(s).toContain('#microsoft.graph.windows10CompliancePolicy')
    expect(s).toContain('New-MgDeviceManagementDeviceCompliancePolicy')
  })
  test('requires BitLocker', () => {
    expect(s).toContain('BitLockerEnabled = $true')
  })
  test('logs created policy ID', () => {
    expect(s).toContain('$created = New-MgDeviceManagementDeviceCompliancePolicy')
    expect(s).toContain('$created.Id')
  })
  test('does not include scheduledActionsForRule in body', () => {
    // scheduledActionsForRule = @() caused API errors; it's a navigation property
    expect(s).not.toContain('scheduledActionsForRule')
  })
})

describe('EN004 - Windows Compliance: Minimum OS Version', () => {
  test('uses default minimum version', () => {
    const s = script1('EN004', EN, 'Min OS Version')
    expect(s).toContain('10.0.19045.0')
  })
  test('uses custom minimum version', () => {
    const s = script1('EN004', EN, 'Min OS Version', { minOsVersion: '10.0.22621.0' })
    expect(s).toContain('10.0.22621.0')
  })
})

describe('EN007 - macOS Compliance: Require FileVault', () => {
  let s
  beforeAll(() => { s = script1('EN007', EN, 'macOS FileVault') })

  test('creates a macOSCompliancePolicy', () => {
    expect(s).toContain('#microsoft.graph.macOSCompliancePolicy')
  })
  test('requires storage encryption', () => {
    expect(s).toContain('StorageRequireEncryption = $true')
  })
})

describe('EN011 - iOS Compliance: Require Passcode', () => {
  let s
  beforeAll(() => { s = script1('EN011', EN, 'iOS Passcode') })

  test('creates an iosCompliancePolicy', () => {
    expect(s).toContain('#microsoft.graph.iosCompliancePolicy')
  })
  test('requires passcode with minimum length', () => {
    expect(s).toContain('PasscodeRequired = $true')
    expect(s).toContain('PasscodeMinimumLength = 6')
  })
})

describe('EN013 - Android Compliance: Minimum OS Version', () => {
  test('uses default Android version', () => {
    const s = script1('EN013', EN, 'Android Min OS')
    expect(s).toContain('#microsoft.graph.androidWorkProfileCompliancePolicy')
    expect(s).toContain('11.0')
  })
  test('uses custom Android version', () => {
    const s = script1('EN013', EN, 'Android Min OS', { minAndroidVersion: '12.0' })
    expect(s).toContain('12.0')
  })
})

// ─── Defender ─────────────────────────────────────────────────────────────────

describe('DE001 - Enable Defender for O365', () => {
  let s
  beforeAll(() => { s = script1('DE001', DE, 'Defender for O365') })

  test('sets ATP policy for O365', () => {
    expect(s).toContain('Set-AtpPolicyForO365')
    expect(s).toContain('EnableATPForSPOTeamsODB $true')
    expect(s).toContain('EnableSafeDocs $true')
  })
})

describe('DE002 - Strict Preset Security Policy', () => {
  let s
  beforeAll(() => { s = script1('DE002', DE, 'Strict Preset') })

  test('applies strict preset to hosted content filter', () => {
    expect(s).toContain('Set-HostedContentFilterPolicy')
    expect(s).toContain('Strict Preset Security Policy')
  })
})

// ─── Audit & Compliance ───────────────────────────────────────────────────────

describe('AC001 - Enable Unified Audit Log', () => {
  let s
  beforeAll(() => { s = script1('AC001', AC, 'Unified Audit Log') })

  test('enables audit log ingestion', () => {
    expect(s).toContain('Set-AdminAuditLogConfig')
    expect(s).toContain('UnifiedAuditLogIngestionEnabled $true')
  })
})

describe('AC007 - DLP Global Policy', () => {
  let s
  beforeAll(() => { s = script1('AC007', AC, 'DLP Global') })

  test('creates DLP compliance policy covering all workloads', () => {
    expect(s).toContain('New-DlpCompliancePolicy')
    expect(s).toContain("SharePointLocation 'All'")
    expect(s).toContain("ExchangeLocation 'All'")
    expect(s).toContain("TeamsLocation 'All'")
  })
  test('creates DLP rule for sensitive info types', () => {
    expect(s).toContain('New-DlpComplianceRule')
    expect(s).toContain('Credit Card Number')
  })
})

describe('AC012 - Retention Policy: Teams Messages', () => {
  test('creates retention policy for Teams', () => {
    const s = script1('AC012', AC, 'Teams Retention')
    expect(s).toContain('New-RetentionCompliancePolicy')
    expect(s).toContain('New-RetentionComplianceRule')
    expect(s).toContain('TeamsChannelLocation')
    expect(s).toContain('TeamsChatLocation')
  })
  test('uses default 7 years (2555 days)', () => {
    const s = script1('AC012', AC, 'Teams Retention')
    expect(s).toContain('RetentionDuration 2555')
  })
  test('uses custom retention years', () => {
    const s = script1('AC012', AC, 'Teams Retention', { retentionYears: 5 })
    expect(s).toContain('RetentionDuration 1825')
  })
})

// ─── Admin Security ───────────────────────────────────────────────────────────

describe('AS008 - Global Admin Count Check', () => {
  test('queries directory roles', () => {
    const s = script1('AS008', AS, 'Global Admin Count')
    expect(s).toContain('Get-MgDirectoryRole')
    expect(s).toContain('Get-MgDirectoryRoleMember')
    expect(s).toContain('Global Administrator')
  })
  test('uses default threshold of 5', () => {
    const s = script1('AS008', AS, 'Global Admin Count')
    expect(s).toContain('5')
  })
  test('uses custom threshold', () => {
    const s = script1('AS008', AS, 'Global Admin Count', { maxGlobalAdmins: 3 })
    expect(s).toContain('3')
  })
})

describe('AS018 - Restrict API Permission Grant', () => {
  let s
  beforeAll(() => { s = script1('AS018', AS, 'Restrict API Consent') })

  test('patches authorization policy', () => {
    expect(s).toContain('authorizationPolicy')
    expect(s).toContain('Invoke-MgGraphRequest')
  })
  test('restricts to low-risk verified publisher apps', () => {
    expect(s).toContain('ManagePermissionGrantsForSelf.microsoft-user-default-low')
  })
})

// ─── Tenant Baseline ──────────────────────────────────────────────────────────

describe('TB002 - Enable Modern Authentication', () => {
  let s
  beforeAll(() => { s = script1('TB002', TB, 'Enable Modern Auth') })

  test('sets OAuth2 client profile', () => {
    expect(s).toContain('Set-OrganizationConfig')
    expect(s).toContain('OAuth2ClientProfileEnabled $true')
  })
})

describe('TB008 - Disable User Tenant Creation', () => {
  let s
  beforeAll(() => { s = script1('TB008', TB, 'Disable Tenant Creation') })

  test('patches authorizationPolicy to block tenant creation', () => {
    expect(s).toContain('authorizationPolicy')
    expect(s).toContain('allowedToCreateTenants = $false')
  })
})

describe('TB011 - Disable LinkedIn Connection', () => {
  let s
  beforeAll(() => { s = script1('TB011', TB, 'Disable LinkedIn') })

  test('iterates organizations and disables LinkedIn', () => {
    expect(s).toContain('Get-MgOrganization')
    expect(s).toContain('isLinkedInEnabled = $false')
  })
})

describe('TB015 - Smart Lockout', () => {
  test('uses directory settings template ID for PasswordRuleSettings', () => {
    const s = script1('TB015', TB, 'Smart Lockout')
    expect(s).toContain('5cf42378-d67d-4f36-ba46-e8b86229381d')
    expect(s).toContain('LockoutThreshold')
    expect(s).toContain('LockoutDurationInSeconds')
  })
  test('uses default threshold of 10', () => {
    const s = script1('TB015', TB, 'Smart Lockout')
    expect(s).toContain("'LockoutThreshold'; value = '10'")
  })
  test('uses custom threshold', () => {
    const s = script1('TB015', TB, 'Smart Lockout', { lockoutThreshold: 5 })
    expect(s).toContain("'LockoutThreshold'; value = '5'")
  })
  test('uses beta/settings Graph endpoint', () => {
    const s = script1('TB015', TB, 'Smart Lockout')
    expect(s).toContain('beta/settings')
    expect(s).toContain('Invoke-MgGraphRequest')
  })
})

describe('TB016 - Disable Password Expiry', () => {
  let s
  beforeAll(() => { s = script1('TB016', TB, 'Disable Password Expiry') })

  test('queries all domains', () => {
    expect(s).toContain('Get-MgDomain')
  })
  test('sets password validity to maximum', () => {
    expect(s).toContain('passwordValidityPeriodInDays = 2147483647')
  })
})

describe('TB017 - Enable Microsoft Authenticator Passwordless', () => {
  let s
  beforeAll(() => { s = script1('TB017', TB, 'Authenticator Passwordless') })

  test('enables Authenticator with number matching', () => {
    expect(s).toContain('microsoftAuthenticator')
    expect(s).toContain('numberMatchingRequiredState')
    expect(s).toContain("state = 'enabled'")
  })
  test('enables display app information', () => {
    expect(s).toContain('displayAppInformationRequiredState')
  })
})

describe('TB024 - Disable MFA Number Matching Bypass', () => {
  let s
  beforeAll(() => { s = script1('TB024', TB, 'MFA Number Matching') })

  test('enables number matching for all users', () => {
    expect(s).toContain('numberMatchingRequiredState')
    expect(s).toContain("id = 'all_users'")
  })
})

// ─── buildScript (full script with auth) ─────────────────────────────────────

describe('buildScript - module imports', () => {
  let s
  beforeAll(() => {
    s = buildScript([pol('CA001', CA, 'Require MFA')], null, '', 'interactive', {})
  })

  test('imports Microsoft.Graph.Authentication', () => {
    expect(s).toContain('Import-Module Microsoft.Graph.Authentication')
  })
  test('imports Microsoft.Graph.Identity.SignIns', () => {
    expect(s).toContain('Import-Module Microsoft.Graph.Identity.SignIns')
  })
  test('imports Microsoft.Graph.DeviceManagement', () => {
    expect(s).toContain('Import-Module Microsoft.Graph.DeviceManagement')
  })
  test('imports Microsoft.Graph.Identity.DirectoryManagement', () => {
    expect(s).toContain('Import-Module Microsoft.Graph.Identity.DirectoryManagement')
  })
  test('checks for Graph module before importing', () => {
    expect(s).toContain('Get-Module -ListAvailable -Name Microsoft.Graph.Authentication')
  })
})

describe('buildScript - EXO connection', () => {
  test('includes EXO connection when Exchange policy selected', () => {
    const s = buildScript([pol('EX001', EX, 'DKIM')], null, '', 'interactive', {})
    expect(s).toContain('Connect-ExchangeOnline')
    expect(s).toContain('Import-Module ExchangeOnlineManagement')
  })
  test('no EXO connection for CA-only policies', () => {
    const s = buildScript([pol('CA001', CA, 'MFA')], null, '', 'interactive', {})
    expect(s).not.toContain('Connect-ExchangeOnline')
  })
  test('-Device is guarded by a PowerShell 7 version check (unsupported on 5.1)', () => {
    const s = buildScript([pol('EX001', EX, 'DKIM')], null, '', 'interactive', {})
    expect(s).toContain('Connect-ExchangeOnline -Device')
    expect(s).toContain('$PSVersionTable.PSVersion.Major -ge 7')
    expect(s).toContain('Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop')
  })
  test('aborts the run when the EXO connection fails', () => {
    const s = buildScript([pol('EX001', EX, 'DKIM')], null, '', 'interactive', {})
    const catchBlock = s.split('ERROR: EXO connect failed')[1]
    expect(catchBlock).toContain('exit 1')
  })
})

describe('buildScript - IPPS connection', () => {
  test('includes IPPS connection when compliance policy selected', () => {
    const s = buildScript([pol('AC007', AC, 'DLP')], null, '', 'interactive', {})
    expect(s).toContain('Connect-IPPSSession')
  })
  test('no IPPS for CA-only policies', () => {
    const s = buildScript([pol('CA001', CA, 'MFA')], null, '', 'interactive', {})
    expect(s).not.toContain('Connect-IPPSSession')
  })
  test('never passes -Device (Connect-IPPSSession has no device code flow)', () => {
    const s = buildScript([pol('AC007', AC, 'DLP')], null, '', 'interactive', {})
    expect(s).not.toContain('Connect-IPPSSession -Device')
    expect(s).toContain('Connect-IPPSSession -ShowBanner:$false -ErrorAction Stop')
  })
  test('aborts the run when the IPPS connection fails', () => {
    const s = buildScript([pol('AC007', AC, 'DLP')], null, '', 'interactive', {})
    const catchBlock = s.split('ERROR: IPPS connect failed')[1]
    expect(catchBlock).toContain('exit 1')
  })
})

describe('buildScript - disconnect block', () => {
  test('disconnects Graph after completion', () => {
    const s = buildScript([pol('CA001', CA, 'MFA')], null, '', 'interactive', {})
    expect(s).toContain('Disconnect-MgGraph')
    expect(s).toContain('DONE: All sessions closed')
  })
  test('disconnects EXO when EXO policies used', () => {
    const s = buildScript([pol('EX001', EX, 'DKIM')], null, '', 'interactive', {})
    expect(s).toContain('Disconnect-ExchangeOnline')
  })
})

describe('buildScript - interactive auth', () => {
  test('uses device authentication in interactive mode', () => {
    const s = buildScript([pol('CA001', CA, 'MFA')], null, '', 'interactive', {})
    expect(s).toContain('Connect-MgGraph')
    expect(s).toContain('UseDeviceAuthentication')
  })
  test('explains the mixed-module-version assembly conflict instead of the raw error', () => {
    const s = buildScript([pol('CA001', CA, 'MFA')], null, '', 'interactive', {})
    expect(s).toContain("Assembly with same name is already loaded")
    expect(s).toContain('A different version of the Microsoft Graph modules is already loaded')
  })
})

describe('buildScript - multiple policies', () => {
  test('includes all selected policies', () => {
    const s = buildScript(
      [pol('CA001', CA, 'Require MFA'), pol('TB002', TB, 'Modern Auth')],
      null, '', 'interactive', {}
    )
    expect(s).toContain('CREATING: CA001')
    expect(s).toContain('CREATING: TB002')
  })
})

// ─── buildPoliciesScript (session path) ──────────────────────────────────────

describe('buildPoliciesScript', () => {
  let s
  beforeAll(() => {
    s = buildPoliciesScript([pol('CA001', CA, 'Require MFA')], '', {})
  })

  test('does not include Connect-MgGraph', () => {
    expect(s).not.toContain('Connect-MgGraph')
  })
  test('does not include Import-Module', () => {
    expect(s).not.toContain('Import-Module')
  })
  test('does not include Disconnect-MgGraph', () => {
    expect(s).not.toContain('Disconnect-MgGraph')
  })
  test('includes the policy block', () => {
    expect(s).toContain('CREATING: CA001')
  })
  test('sets PowerShell preferences', () => {
    expect(s).toContain("$ErrorActionPreference = 'Stop'")
    expect(s).toContain("$ProgressPreference = 'SilentlyContinue'")
  })
})

// ─── config.skip — global report-only mode for non-CA policies ───────────────

describe('config.skip — skips non-CA policies in report-only mode', () => {
  const EX = 'Exchange Online'
  const EN = 'Intune / Endpoint'
  const SP = 'SharePoint & OneDrive'

  test('EX001 with skip:true emits SKIPPED not SUCCESS', () => {
    const s = buildPoliciesScript([pol('EX001', EX, 'Enable DKIM')], '', { EX001: { skip: true } })
    expect(s).toContain('SKIPPED: EX001')
    expect(s).not.toContain('SUCCESS: EX001')
    expect(s).not.toContain('Set-DkimSigningConfig')
  })

  test('EN001 with skip:true emits SKIPPED not SUCCESS', () => {
    const s = buildPoliciesScript([pol('EN001', EN, 'Require BitLocker')], '', { EN001: { skip: true } })
    expect(s).toContain('SKIPPED: EN001')
    expect(s).not.toContain('SUCCESS: EN001')
    expect(s).not.toContain('New-MgDeviceManagementDeviceCompliancePolicy')
  })

  test('SP001 with skip:true emits SKIPPED not SUCCESS', () => {
    const s = buildPoliciesScript([pol('SP001', SP, 'Restrict External Sharing')], '', { SP001: { skip: true } })
    expect(s).toContain('SKIPPED: SP001')
    expect(s).not.toContain('SUCCESS: SP001')
  })

  test('CA001 with skip:true also emits SKIPPED', () => {
    const s = buildPoliciesScript([pol('CA001', CA, 'Require MFA')], '', { CA001: { skip: true } })
    expect(s).toContain('SKIPPED: CA001')
    expect(s).not.toContain('New-MgIdentityConditionalAccessPolicy')
  })

  test('skip does not affect policies without skip flag', () => {
    const s = buildPoliciesScript(
      [pol('EX001', EX, 'Enable DKIM'), pol('CA001', CA, 'Require MFA')],
      '',
      { EX001: { skip: true } }
    )
    expect(s).toContain('SKIPPED: EX001')
    expect(s).toContain('New-MgIdentityConditionalAccessPolicy')
  })

  test('skip reason references Active mode', () => {
    const s = buildPoliciesScript([pol('EX001', EX, 'Enable DKIM')], '', { EX001: { skip: true } })
    expect(s).toContain('Active')
  })
})

// ─── Special character handling ───────────────────────────────────────────────

describe('special characters in prefix/name', () => {
  test('single quotes in prefix are escaped', () => {
    const s = buildPoliciesScript([pol('CA001', CA, 'Require MFA')], "Client's Corp", {})
    expect(s).toContain("Client''s Corp")
    expect(s).not.toMatch(/[^']'[^'].*DisplayName/)
  })
})
