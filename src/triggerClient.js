export async function fetchTriggerState() {
  const [triggersResponse, companiesResponse] = await Promise.all([
    fetch('/api/triggers', { headers: { Accept: 'application/json' } }),
    fetch('/api/companies', { headers: { Accept: 'application/json' } })
  ]);
  if (!triggersResponse.ok || !companiesResponse.ok) {
    throw new Error('Trigger service unavailable');
  }
  const triggers = await triggersResponse.json();
  const companies = await companiesResponse.json();
  return { triggers, company: companies[0] || null };
}

export async function postMockTrigger(scenario) {
  const response = await fetch('/api/triggers/mock', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ scenario })
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error('Trigger service returned an unreadable response');
  }
  if (!response.ok) {
    const detail = Array.isArray(body.issues) && body.issues.length > 0
      ? body.issues.map((entry) => entry.message).join('; ')
      : body.error;
    throw new Error(detail || 'Trigger request failed');
  }
  return body;
}
