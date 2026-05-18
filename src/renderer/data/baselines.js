// Security baseline definitions — sourced from Microsoft's common CA policy templates
// https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common

const MS_LEARN_SOURCE = 'Microsoft Learn'
const MS_LEARN_LABEL = 'Common CA Policies · Microsoft Learn'

export const BASELINES = [
  {
    id: 'secure-foundation',
    name: 'Secure Foundation',
    subtitle: 'Microsoft recommended base for all organisations',
    source: MS_LEARN_SOURCE,
    sourceUrl: 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common?tabs=secure-foundation',
    sourceLabel: MS_LEARN_LABEL,
    color: { card: 'border-blue-300 bg-blue-50', badge: 'bg-blue-600 text-white', source: 'text-blue-700 bg-blue-100', accent: 'bg-blue-600' },
    description: 'Microsoft recommends these policies as the base for all organisations. Deploy these policies as a group to establish foundational identity security across your tenant.',
    highlights: [
      'Require MFA for all users',
      'Block legacy authentication',
      'Secure security info registration',
      'Require compliant or hybrid joined device',
    ],
    policyIds: [
      'CA001', 'CA002', 'CA003', 'CA004',
      'CA006', 'CA019', 'CA033',
    ],
  },

  {
    id: 'zero-trust',
    name: 'Zero Trust',
    subtitle: 'Policies that support a Zero Trust architecture',
    source: MS_LEARN_SOURCE,
    sourceUrl: 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common?tabs=zero-trust',
    sourceLabel: MS_LEARN_LABEL,
    color: { card: 'border-purple-300 bg-purple-50', badge: 'bg-purple-700 text-white', source: 'text-purple-700 bg-purple-100', accent: 'bg-purple-700' },
    description: 'These policies help support a Zero Trust architecture. Includes risk-based access controls (requires Microsoft Entra ID P2), device platform restrictions, app protection policies, and no persistent browser sessions.',
    highlights: [
      'MFA for risky sign-ins (Entra ID P2)',
      'No persistent browser session',
      'Approved client apps / app protection',
      'Block unknown or unsupported device platforms',
    ],
    policyIds: [
      'CA001', 'CA002', 'CA003', 'CA004', 'CA006',
      'CA008', 'CA009', 'CA011', 'CA012', 'CA014',
      'CA016', 'CA018', 'CA019', 'CA033',
      'IP001', 'IP002', 'IP003',
    ],
  },

  {
    id: 'remote-work',
    name: 'Remote Workers',
    subtitle: 'Policies to secure organisations with remote workers',
    source: MS_LEARN_SOURCE,
    sourceUrl: 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common?tabs=remote-work',
    sourceLabel: MS_LEARN_LABEL,
    color: { card: 'border-emerald-300 bg-emerald-50', badge: 'bg-emerald-700 text-white', source: 'text-emerald-700 bg-emerald-100', accent: 'bg-emerald-700' },
    description: 'These policies help secure organisations with remote workers. Combines device compliance, app protection, session controls, and risk-based access to protect users working outside the corporate network.',
    highlights: [
      'Require compliant or hybrid joined device',
      'Approved client apps / app protection',
      'App-enforced restrictions for unmanaged devices',
      'No persistent browser session',
    ],
    policyIds: [
      'CA001', 'CA002', 'CA004', 'CA008', 'CA009',
      'CA011', 'CA012', 'CA014', 'CA016', 'CA018',
      'CA019', 'CA030',
      'IP001', 'IP002',
    ],
  },

  {
    id: 'protect-admins',
    name: 'Protect Administrators',
    subtitle: 'Hardened policies for highly privileged administrator accounts',
    source: MS_LEARN_SOURCE,
    sourceUrl: 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-policy-common?tabs=protect-administrator',
    sourceLabel: MS_LEARN_LABEL,
    color: { card: 'border-red-300 bg-red-50', badge: 'bg-red-700 text-white', source: 'text-red-700 bg-red-100', accent: 'bg-red-700' },
    description: 'These policies are for highly privileged administrators in your environment, where compromise might cause the most damage. Requires phishing-resistant MFA and compliant devices for all admin activity.',
    highlights: [
      'Require phishing-resistant MFA for admins',
      'Require compliant or hybrid joined device',
      'Block legacy authentication',
      'Require MFA for Azure management',
    ],
    policyIds: [
      'CA002', 'CA003', 'CA004', 'CA006',
      'CA026', 'CA033', 'CA045',
    ],
  },
]
