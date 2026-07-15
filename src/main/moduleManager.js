const { runScript } = require('./powershell')

// Cache module status for 10 minutes to avoid repeated PSGallery network calls on every app launch.
let _moduleStatusCache = null
let _moduleStatusCacheAt = 0
const MODULE_CACHE_TTL_MS = 10 * 60 * 1000

function invalidateModuleCache() {
  _moduleStatusCache = null
}

// Only the Graph sub-modules the app actually uses — the Microsoft.Graph
// meta-module pulls in ~40 sub-modules and takes 5-15 minutes to install.
const REQUIRED_MODULES = [
  { name: 'Microsoft.Graph.Authentication', description: 'Microsoft Graph authentication and connection management' },
  { name: 'Microsoft.Graph.Identity.SignIns', description: 'Conditional Access policy management' },
  { name: 'Microsoft.Graph.Identity.DirectoryManagement', description: 'Directory roles, organisation and domain lookups' },
  { name: 'Microsoft.Graph.Users', description: 'User lookups and updates' },
  { name: 'Microsoft.Graph.Groups', description: 'Group lookups for policy assignment' },
  { name: 'Microsoft.Graph.DeviceManagement', description: 'Intune / device compliance policies' },
  { name: 'ExchangeOnlineManagement', description: 'Exchange Online policies' },
]

function validateModuleNames(moduleNames) {
  if (!Array.isArray(moduleNames) || moduleNames.length === 0) {
    throw new Error('No modules specified')
  }
  const known = new Set(REQUIRED_MODULES.map(m => m.name))
  const unknown = moduleNames.filter(n => !known.has(n))
  if (unknown.length > 0) {
    throw new Error(`Unknown module name(s): ${unknown.join(', ')}`)
  }
}

function unknownModuleStatus() {
  return REQUIRED_MODULES.map(m => ({
    Name: m.name,
    description: m.description,
    Installed: false,
    InstalledVersion: null,
    LatestVersion: null,
    Status: 'unknown',
  }))
}

// Windows PowerShell 5 defaults to TLS 1.0, which PSGallery rejects.
// Note: $IsWindows does not exist on WinPS5 — test PSEdition instead.
const PS_TLS12 = `
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {}
}
`

async function getModuleStatus() {
  const now = Date.now()
  if (_moduleStatusCache && (now - _moduleStatusCacheAt) < MODULE_CACHE_TTL_MS) {
    return _moduleStatusCache
  }

  const moduleNames = REQUIRED_MODULES.map(m => m.name)
  const script = `
$ProgressPreference = 'SilentlyContinue'
${PS_TLS12}
$moduleNames = @(${moduleNames.map(n => `'${n}'`).join(',')})
$results = @()
foreach ($name in $moduleNames) {
    # Get-InstalledModule is more reliable for modules installed via Install-Module
    $installed = Get-InstalledModule -Name $name -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    # Fall back to Get-Module -ListAvailable if not found via PowerShellGet
    if (-not $installed) {
        $mod = Get-Module -ListAvailable -Name $name | Sort-Object Version -Descending | Select-Object -First 1
        if ($mod) {
            $installed = [PSCustomObject]@{ Version = $mod.Version }
        }
    }

    $latest = $null
    try {
        $latest = Find-Module -Name $name -Repository PSGallery -ErrorAction SilentlyContinue | Select-Object -First 1
    } catch {}

    $status = 'not_installed'
    if ($installed) {
        if ($latest) {
            # Cast both sides — depending on the PowerShellGet version these can be
            # strings, and string -gt compares lexically ('10.0' -lt '9.0').
            $newer = $false
            try {
                $newer = [version]$latest.Version -gt [version]$installed.Version
            } catch {
                $newer = $latest.Version.ToString() -ne $installed.Version.ToString()
            }
            $status = if ($newer) { 'update_available' } else { 'up_to_date' }
        } else {
            # Gallery unreachable — don't claim up to date when we couldn't check
            $status = 'update_unknown'
        }
    }

    $results += [PSCustomObject]@{
        Name = $name
        Installed = ($installed -ne $null)
        InstalledVersion = if ($installed) { $installed.Version.ToString() } else { $null }
        LatestVersion = if ($latest) { $latest.Version.ToString() } else { $null }
        Status = $status
    }
}
$results | ConvertTo-Json -Depth 3
`
  const { output } = await runScript(script, null, null)
  try {
    const jsonMatch = output.match(/\[[\s\S]*\]|\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      const result = arr.map(m => ({
        ...m,
        description: REQUIRED_MODULES.find(r => r.name === m.Name)?.description || '',
      }))
      _moduleStatusCache = result
      _moduleStatusCacheAt = Date.now()
      return result
    }
  } catch {}
  return unknownModuleStatus()
}

const PS_SILENT_PREFS = `
$ProgressPreference   = 'SilentlyContinue'
$VerbosePreference    = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$WarningPreference    = 'SilentlyContinue'
`

const BOOTSTRAP = `
$psEd = $PSVersionTable.PSEdition  # 'Desktop' = WinPS5, 'Core' = PS7+
Write-Output "SETUP: PowerShell $($PSVersionTable.PSVersion) ($psEd)"

if ($psEd -eq 'Desktop') {
    # Windows PowerShell 5 only ('Desktop' edition only exists on Windows;
    # $IsWindows is not defined on WinPS5) — needs NuGet provider + TLS 1.2 bootstrap
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {}
    try {
        $nuget = Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue |
                 Sort-Object Version -Descending | Select-Object -First 1
        if (-not $nuget -or [version]$nuget.Version -lt [version]'2.8.5.201') {
            Write-Output "SETUP: Installing NuGet provider (required for PowerShell 5)..."
            Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction Stop
            Import-PackageProvider -Name NuGet -Force -ErrorAction SilentlyContinue
            Write-Output "SETUP: NuGet provider ready"
        }
        Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
    } catch {
        Write-Output "WARNING: NuGet bootstrap - $($_.Exception.Message)"
    }
} else {
    # PowerShell 7+ (Windows/Linux/macOS) — NuGet provider not required.
    # Just mark PSGallery as trusted (local config, no network call).
    try { Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue } catch {}
}
`

// $IsLinux/$IsWindows don't exist on WinPS5, so check PSEdition first
const SETUP_PREAMBLE = `
${PS_SILENT_PREFS}
Write-Output "SETUP: Starting on $(if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { 'Windows' } elseif ($IsLinux) { 'Linux' } else { 'macOS' })..."
${BOOTSTRAP}
Write-Output "SETUP: Package source ready"
`

async function installModules(moduleNames, onData, onError) {
  validateModuleNames(moduleNames)
  invalidateModuleCache()
  const script = `
${SETUP_PREAMBLE}
$modules = @(${moduleNames.map(n => `'${n}'`).join(',')})
foreach ($mod in $modules) {
    Write-Output "INSTALLING: $mod (this may take a few minutes)..."
    try {
        Install-Module -Name $mod -Scope CurrentUser -Force -AllowClobber -SkipPublisherCheck -Confirm:$false -Repository PSGallery -ErrorAction Stop
        Write-Output "SUCCESS: $mod installed"
    } catch {
        Write-Output "ERROR: $mod - $($_.Exception.Message)"
    }
}
Write-Output "DONE"
`
  return runScript(script, onData, onError)
}

async function updateModules(moduleNames, onData, onError) {
  validateModuleNames(moduleNames)
  invalidateModuleCache()
  const script = `
${SETUP_PREAMBLE}
$modules = @(${moduleNames.map(n => `'${n}'`).join(',')})
foreach ($mod in $modules) {
    Write-Output "UPDATING: $mod (this may take a few minutes)..."
    $updated = $false
    try {
        Update-Module -Name $mod -Force -Confirm:$false -ErrorAction Stop
        $updated = $true
    } catch {
        # Update-Module only works for modules installed via Install-Module in the
        # same scope — fall back to a fresh CurrentUser install for side-loaded or
        # admin-installed (AllUsers) modules.
        Write-Output "INFO: Update-Module failed for $mod, retrying with Install-Module..."
        try {
            Install-Module -Name $mod -Scope CurrentUser -Force -AllowClobber -SkipPublisherCheck -Confirm:$false -Repository PSGallery -ErrorAction Stop
            $updated = $true
        } catch {
            Write-Output "ERROR: $mod - $($_.Exception.Message)"
        }
    }
    if ($updated) {
        Write-Output "SUCCESS: $mod updated"
        # Update-Module installs side-by-side and never removes old versions,
        # which silently accumulate — clean up everything but the newest.
        # A failed removal must be surfaced: leftover old versions are what
        # cause "Assembly with same name is already loaded" errors later.
        try {
            Get-InstalledModule -Name $mod -AllVersions -ErrorAction Stop |
                Sort-Object { [version]$_.Version } -Descending |
                Select-Object -Skip 1 |
                ForEach-Object {
                    Write-Output "CLEANUP: Removing $mod $($_.Version)..."
                    try {
                        Uninstall-Module -Name $mod -RequiredVersion $_.Version -Force -ErrorAction Stop
                    } catch {
                        Write-Output "WARNING: Could not remove $mod $($_.Version) - $($_.Exception.Message)"
                        Write-Output "WARNING: The old version is likely loaded by another PowerShell process - close other PowerShell windows, restart this app and update again"
                    }
                }
        } catch {}
    }
}
Write-Output "DONE"
`
  return runScript(script, onData, onError)
}

module.exports = { getModuleStatus, installModules, updateModules, invalidateModuleCache, unknownModuleStatus, REQUIRED_MODULES }
