// ─── Bits & Studios — RBAC Permission System ─────────────────────────────────
// Central permission check used by all UI modules.
// Usage: window.RBAC.can('add_task') → true/false
//        window.RBAC.check('delete_task') → true/false + shows toast if denied

'use strict';

// What employees are allowed to do
const EMPLOYEE_ALLOWED = new Set([
  'view_map',           // see the mind map
  'view_chat',          // open Jarvis chat
  'send_chat',          // send messages to Jarvis
  'view_docs',          // view documents panel
  'view_meetings',      // view meeting history
  'process_meeting',    // process a meeting transcript
  'add_own_task',       // add a task (becomes owner)
  'update_own_status',  // mark own task done/in-progress etc
  'add_subtask_own',    // add subtask to own task
  'edit_own_task',      // edit description/title of own task
  'upload_file_own',    // upload file to own task
  'add_collaborator_own', // add collaborator to own task
]);

// Everything else requires admin:
// add_task_any, delete_task, import, export, settings, view_history,
// clear_history, run_agent, supervisor, assign_any, run_all_agents, etc.

window.RBAC = {
  /**
   * Check if current user CAN do `action`.
   * For task-scoped actions (own vs others), pass `nodeId`.
   */
  can(action, nodeId) {
    const user = window.Auth?.currentUser;
    if (!user) return false;
    if (user.role === 'admin') return true;

    // Employee check
    if (EMPLOYEE_ALLOWED.has(action)) return true;

    // Task-ownership checks
    if (nodeId) {
      const node = window.DB?.getNode(nodeId);
      if (!node) return false;
      const isOwner = node.createdBy === user.id;
      const isCollab = (node.collaborators || []).includes(user.id);
      const isAssigned = (node.assignees || []).includes(user.name);
      const hasAccess = isOwner || isCollab || isAssigned;

      if (action === 'edit_task'   && hasAccess) return true;
      if (action === 'update_status' && hasAccess) return true;
      if (action === 'add_subtask' && hasAccess) return true;
      if (action === 'upload_file' && hasAccess) return true;
      if (action === 'delete_subtask' && hasAccess) return true;
      if (action === 'add_collaborator' && isOwner) return true;
    }

    return false;
  },

  /**
   * Check permission and show a toast if denied.
   * Returns true if allowed, false if denied.
   */
  check(action, nodeId) {
    if (this.can(action, nodeId)) return true;
    const user = window.Auth?.currentUser;
    const name = user?.name || 'You';
    window.app?.showToast(`⛔ ${name} doesn't have permission for this`, 'error');
    return false;
  },

  /**
   * Is the current user the owner of this node?
   */
  isOwner(nodeId) {
    const user = window.Auth?.currentUser;
    if (!user) return false;
    if (user.role === 'admin') return true;
    const node = window.DB?.getNode(nodeId);
    return node?.createdBy === user.id;
  },

  /**
   * Does the current user have edit access to this node?
   */
  canEditNode(nodeId) {
    return this.can('edit_task', nodeId);
  },

  /**
   * Lock / unlock sidebar fields based on current user's access to nodeId.
   */
  applySidebarLock(nodeId) {
    const canEdit = this.canEditNode(nodeId);
    const isAdmin = window.Auth?.isAdmin;

    // Fields that require edit access
    const editFields = ['sb-title', 'sb-desc', 'sb-due', 'sb-dept'];
    editFields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !canEdit;
    });

    // Status pills — can update if has access
    document.querySelectorAll('.status-pill').forEach(p => {
      p.style.pointerEvents = canEdit ? '' : 'none';
      p.style.opacity = canEdit ? '' : '0.5';
    });

    // Priority pills — admin only
    document.querySelectorAll('.priority-pill').forEach(p => {
      p.style.pointerEvents = isAdmin ? '' : 'none';
      p.style.opacity = isAdmin ? '' : '0.5';
    });

    // Delete button — admin only
    const del = document.getElementById('sb-delete');
    if (del) del.style.display = isAdmin ? 'block' : 'none';

    // Assign — admin only
    const assignEl = document.getElementById('sb-new-assignee');
    if (assignEl) assignEl.disabled = !isAdmin;

    // Collaborators add — owner or admin
    const collabAdd = document.getElementById('sb-add-collab');
    if (collabAdd) collabAdd.style.display = (isAdmin || this.isOwner(nodeId)) ? 'block' : 'none';

    // Lock hint
    let hint = document.getElementById('sb-access-hint');
    if (!canEdit && !isAdmin) {
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'sb-access-hint';
        hint.className = 'sb-access-hint';
        const hdr = document.querySelector('.sidebar-header');
        if (hdr) hdr.after(hint);
      }
      const node = window.DB?.getNode(nodeId);
      const ownerName = node?.ownerName || 'Admin';
      hint.innerHTML = `🔒 View only — owned by <strong>${ownerName}</strong>. Ask to be added as collaborator.`;
      hint.style.display = 'block';
    } else {
      if (hint) hint.style.display = 'none';
    }
  },
};

window.can    = (action, nodeId) => window.RBAC.can(action, nodeId);
window.check  = (action, nodeId) => window.RBAC.check(action, nodeId);
