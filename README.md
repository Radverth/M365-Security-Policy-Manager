# M365 Security Policy Manager

A cross-platform Electron desktop application for IT administrators and MSPs to create, manage, and audit Microsoft 365 security policies at scale across multiple client organisations.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/Electron-30+-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Overview

M365 Security Policy Manager removes the complexity of deploying Microsoft 365 security policies across multiple tenants. Connect your IT Glue account, pick an organisation, select the policies you want, and the application handles the rest — generating and executing the required PowerShell against Microsoft Graph on your behalf.

**Key capabilities:**

- Deploy 113 security policies across 10 categories in a single guided workflow
- Load security baselines from Microsoft's official CA policy templates (Secure Foundation, Zero Trust, Remote Workers, Protect Administrators)
- Pull tenant credentials directly from IT Glue — no manual password entry
- Manage and audit policies across multiple tenants from one interface
- Edit tool-managed policies in a structured form; open external policies directly in the Entra portal
- Full PowerShell module management with streaming install output
- Ships as a signed Windows EXE and Linux AppImage

---

## Screenshots

> Dashboard · Create Policies wizard · Manage Policies · Baselines · Modules · Settings

---

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 LTS or later |
| npm | 10 or later |
| PowerShell Core (`pwsh`) | 7+ |
| Git | any recent version |

**Install PowerShell Core:**
- **Windows:** `winget install Microsoft.PowerShell`
- **Linux:** use the Install PowerShell button in the app, or run `scripts/install-powershell.sh` directly
- **macOS:** `brew install --cask powershell`

### Installation

```bash
git clone https://github.com/TomAustin94/M365-Security-Policy-Manager.git
cd M365-Security-Policy-Manager
npm install
```

### Running in development

```bash
npm run dev
```

This starts the Vite dev server for the renderer (port 5173) and launches Electron with nodemon watching the main process. Hot module replacement is active in the renderer.

---

## Usage

### 1. Configure IT Glue

Open **Settings** and enter your IT Glue API key. Click **Test Connection** to verify. The app will confirm how many organisations are accessible.

The base URL defaults to `https://api.eu.itglue.com`. Change this in Settings if your IT Glue account is on a different region.

### 2. Check PowerShell Modules

Open the **Modules** page. The app checks for all required modules against PSGallery and shows installed vs latest versions. Use **Install All** or update individual modules as needed.

Required modules:

| Module | Purpose |
|---|---|
| `Microsoft.Graph` | Core Graph API access |
| `Microsoft.Graph.Identity.SignIns` | Conditional Access policies |
| `Microsoft.Graph.DeviceManagement` | Intune / device compliance |
| `ExchangeOnlineManagement` | Exchange Online policies |
| `AzureAD` | Azure AD tenant management |

### 3. Create Policies

Open **Create Policies** and follow the six-step wizard:

1. **Select Organisation** — searchable list of all IT Glue organisations
2. **Select Credentials** — choose which IT Glue password record to authenticate with
3. **Configure Prefix** — optionally prepend the organisation name to every policy display name (e.g. `AffinityIT — CA001: Require MFA for All Users`)
4. **Select Policies** — compact 2-column grid grouped by category; select all or pick individually
5. **Configure** — expand any policy to adjust its state, target users, exclusions, and policy-specific settings; defaults are pre-filled from best practice
6. **Review & Create** — summary of what will be created
7. **Progress & Results** — live streaming PowerShell output with per-policy success/failure badges

### 4. Baselines

Open **Baselines** to apply a curated set of policies in one click. Four baselines are provided, sourced directly from Microsoft's common CA policy templates on Microsoft Learn:

| Baseline | Description |
|---|---|
| **Secure Foundation** | Microsoft's recommended base for all organisations |
| **Zero Trust** | Risk-based access, device controls, no persistent sessions (requires Entra ID P2) |
| **Remote Workers** | Device compliance, app protection, and session controls for remote teams |
| **Protect Administrators** | Phishing-resistant MFA and compliant device requirements for privileged accounts |

Selecting a baseline pre-populates the policy selection in Create Policies so you can review and customise before deploying.

### 5. Manage Policies

Open **Manage Policies**, select a tenant, and the app fetches all existing Conditional Access policies from Microsoft Graph. From here you can:

- Search and filter by name or status
- Toggle policy state (Enabled / Report-only / Disabled)
- Toggle **"Managed by tool"** to show only policies created by this application
- **Edit** tool-managed policies via a structured form (name, state, conditions summary)
- **Open in Entra ↗** — non-tool policies show a direct deep link to that policy in the Entra admin centre
- Delete policies individually

### 6. Security Report

Open **Security Report** to generate a summary of the current security posture across the connected tenant.

---

## Policy Categories

113 deployable policies across 10 categories:

| Category | IDs | Count |
|---|---|---|
| Conditional Access | CA001–CA049 | 39 |
| Identity Protection | IP001–IP003 | 3 |
| Exchange Online | EX001–EX036 | 19 |
| SharePoint & OneDrive | SP001–SP023 | 6 |
| Teams | TE003–TE017 | 6 |
| Intune / Endpoint | EN001–EN049 | 15 |
| Defender | DE001–DE038 | 3 |
| Audit & Compliance | AC001–AC043 | 8 |
| Admin Security | AS008–AS019 | 3 |
| Tenant Baseline | TB002–TB025 | 11 |

> All listed policies deploy directly to the tenant when selected. Policies that cannot be fully automated are excluded.

### Notable policies

- **CA005 — Block All Non-UK Access**: blocks every sign-in from outside the United Kingdom. Creates a UK named location (GB) and a Conditional Access policy that denies access to all users and apps unless the sign-in originates from the UK. Enable only when all users are UK-based.

---

## Building for Distribution

```bash
# Windows installer (.exe via NSIS)
npm run build:win

# Linux AppImage
npm run build:linux

# macOS DMG
npm run build:mac
```

Output files are written to the `dist/` directory.

---

## CI/CD

Every push to `main` triggers an automated pipeline:

```
push to main
    │
    ▼
Bump patch version (1.0.1 → 1.0.2)
Commit + tag + create draft release
    │
    ▼
Build matrix (Windows + Linux, parallel)
    │
    ├── success → attach artifacts → publish release
    │
    └── failure → delete draft release
```

Releases are published automatically to the [Releases](../../releases) page. No manual steps required.

---

## Security

- **IT Glue API key** is stored encrypted via `electron-store` and never exposed to the renderer process
- **Tenant credentials** are held in main-process memory only for the duration of the PowerShell session, passed as `SecureString`, and cleared immediately after
- No credential is ever written to a log file, temp file, or the electron-store
- Electron security hardening: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (required for native modules), strict CSP headers

---

## Project Structure

```
src/
├── main/               # Electron main process (Node.js)
│   ├── index.js        # App entry, window creation
│   ├── ipcHandlers.js  # IPC channel registrations
│   ├── powershell.js   # PS execution engine (streaming)
│   ├── moduleManager.js
│   ├── itGlue.js       # IT Glue API client (Axios)
│   ├── policyBuilder.js# PowerShell script generator per policy
│   └── store.js        # electron-store wrapper
├── preload/
│   └── preload.js      # contextBridge API surface
├── renderer/           # React + Vite (no Node.js access)
│   ├── components/     # Shared UI components
│   ├── data/           # baselines.js
│   ├── pages/          # Dashboard, CreatePolicies, ManagePolicies, SecurityReport,
│   │                   # Baselines, Modules, Settings
│   └── store/          # Zustand state slices
└── shared/
    └── constants.js    # All policy definitions (POLICIES, CATEGORY_FIELDS, POLICY_EXTRA_FIELDS)
scripts/
└── install-powershell.sh  # Linux PS Core installer
.github/workflows/
└── build.yml           # CI/CD pipeline
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 30+ |
| UI | React 18 + Vite |
| Styling | Tailwind CSS 3 |
| State | Zustand |
| IPC | Electron contextBridge |
| PowerShell | node-pty + child_process |
| Persistence | electron-store |
| HTTP | Axios |
| Build | electron-builder |
| CI/CD | GitHub Actions |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes
4. Push and open a pull request against `main`

---

## License

MIT © 2025
