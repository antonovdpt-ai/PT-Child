export function shouldRenderAuthEvent(event, previousUserId, nextUserId) {
  if (event === 'INITIAL_SESSION' || event === 'PASSWORD_RECOVERY' || event === 'SIGNED_OUT') return true;
  return (previousUserId || null) !== (nextUserId || null);
}
