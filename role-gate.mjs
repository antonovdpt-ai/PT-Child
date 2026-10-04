// Only authoritative database roles grant access; browser metadata is never a role.
export function createSpecialistRoleGate({ sb, setReady, redirect }) {
  let roles = new Set(), revision = 0;
  function reset() { revision++; roles = new Set(); setReady(false); }
  async function loadCurrentRoles() {
    const current = ++revision;
    roles = new Set(); setReady(false);
    const { data, error } = await sb.rpc('current_app_roles');
    if (current !== revision) return new Set();
    if (error || !Array.isArray(data)) throw new Error('Не удалось проверить доступ');
    roles = new Set(data.map(row => row.role).filter(role => ['specialist', 'parent'].includes(role)));
    if (!roles.has('specialist') && roles.has('parent')) redirect('parent.html');
    setReady(roles.has('specialist'));
    return new Set(roles);
  }
  return { reset, loadCurrentRoles, canNavigate: () => roles.has('specialist') };
}
