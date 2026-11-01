export function localMetaMockConfig(apiOrigin = 'http://127.0.0.1:4290') {
  return {
    accessToken: 'integration-test-token', phoneNumberId: '12345', graphVersion: 'v22.0', apiOrigin,
    templates: {
      verification: { name: 'profiles_verification', language: 'es' },
      reminder: { name: 'profiles_reminder', language: 'es' },
      automation: { name: 'profiles_automation', language: 'es' },
      'risk-alert': { name: 'profiles_risk_alert', language: 'es' },
      'weekly-summary': { name: 'profiles_weekly_summary', language: 'es' },
      ProjectCreated: { name: 'profiles_project_update', language: 'es' },
      ProjectUpdated: { name: 'profiles_project_update', language: 'es' },
      ProjectCompleted: { name: 'profiles_project_update', language: 'es' },
      BudgetThresholdExceeded: { name: 'profiles_budget_alert', language: 'es' },
      ResourceAssigned: { name: 'profiles_resource_update', language: 'es' },
      PriorityRecalculated: { name: 'profiles_priority_update', language: 'es' },
    },
  };
}
