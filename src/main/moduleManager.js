const { runScript } = require('./powershell')

const REQUIRED_MODULES = [
  { name: 'Microsoft.Graph', description: 'Core Graph API access for policy creation' },
  { name: 'Microsoft.Graph.Identity.SignIns', description: 'Conditional Access policy management' },
  { name: 'Microsoft.Graph.DeviceManagement', description: 'Intune / device compliance policies' },
  { name: 'ExchangeOnlineManagement', description: 'Exchange Online policies' },
]

async function getModuleStatus(win) {
  const moduleNames = REQUIRED_MODULES.map(m => m.name)
  const script = `
$ProgressPreference = 'SilentlyContinue'
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
        if ($latest -and $latest.Version -gt $installed.Version) {
            $status = 'update_available'
        } else {
            $status = 'up_to_date'
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
      return arr.map(m => ({
        ...m,
        description: REQUIRED_MODULES.find(r => r.name === m.Name)?.description || '',
      }))
    }
  } catch {}
  return REQUIRED_MODULES.map(m => ({
    Name: m.name,
    description: m.description,
    Installed: false,
    InstalledVersion: null,
    LatestVersion: null,
    Status: 'unknown',
  }))
}

const PS_SILENT_PREFS = `
$ProgressPreference   = 'SilentlyContinue'
$VerbosePreference    = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
`

const BOOTSTRAP = `
$psEdition = $PSVersionTable.PSEdition  # 'Desktop' = WinPS5, 'Core' = PS7+
Write-Output "SETUP: PowerShell $($PSVersionTable.PSVersion) ($psEdition)"

if ($IsWindows -and $psEdition -eq 'Desktop') {
    # Windows PowerShell 5 only — needs NuGet provider + TLS 1.2 bootstrap
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

async function installModules(moduleNames, onData, onError) {
  const script = `
${PS_SILENT_PREFS}
Write-Output "SETUP: Starting on $(if ($IsLinux) { 'Linux' } elseif ($IsWindows) { 'Windows' } else { 'macOS' })..."
${BOOTSTRAP}
Write-Output "SETUP: Package source ready"
$modules = @(${moduleNames.map(n => `'${n}'`).join(',')})
foreach ($mod in $modules) {
    Write-Output "INSTALLING: $mod (large modules like Microsoft.Graph may take 5-15 minutes)..."
    try {
        Install-Module -Name $mod -Scope CurrentUser -Force -AllowClobber -AcceptLicense -SkipPublisherCheck -Confirm:$false -Repository PSGallery -ErrorAction Stop
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
  const script = `
${PS_SILENT_PREFS}
Write-Output "SETUP: Starting on $(if ($IsLinux) { 'Linux' } elseif ($IsWindows) { 'Windows' } else { 'macOS' })..."
${BOOTSTRAP}
Write-Output "SETUP: Package source ready"
$modules = @(${moduleNames.map(n => `'${n}'`).join(',')})
foreach ($mod in $modules) {
    Write-Output "UPDATING: $mod (large modules may take 5-15 minutes)..."
    try {
        Update-Module -Name $mod -Force -AcceptLicense -Confirm:$false -ErrorAction Stop
        Write-Output "SUCCESS: $mod updated"
    } catch {
        Write-Output "ERROR: $mod - $($_.Exception.Message)"
    }
}
Write-Output "DONE"
`
  return runScript(script, onData, onError)
}

module.exports = { getModuleStatus, installModules, updateModules, REQUIRED_MODULES }
