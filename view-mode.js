// ─── Bits & Studios — View Mode Engine ───────────────────────────────────────
// Controls which nodes are visible/faded on the mindmap based on the
// selected view mode: All | My Tasks | Focus (due soon) | Dept filter

'use strict';

window.ViewMode = (() => {
  let _mode      = 'all';   // 'all' | 'mine' | 'focus'
  let _dept      = '';      // '' = all depts
  let _showDone  = false;   // hide done/cancelled by default

  // STATUS groups
  const DONE_STATUSES     = new Set(['done', 'cancelled']);
  const URGENT_STATUSES   = new Set(['need_support', 'blocked']);

  // How faded completed nodes appear (0 = invisible, 1 = full)
  const DONE_OPACITY      = 0.28;
  const DIMMED_OPACITY    = 0.35;

  function _applyToCanvas() {
    if (!window.app?.data) return;
    const nodes    = window.app.data.getAllNodes();
    const user     = window.Auth?.currentUser;
    const userId   = window.Auth?.userId;
    const userName = user?.name || '';
    const now      = Date.now();
    const in7days  = now + 7 * 24 * 60 * 60 * 1000;

    let visibleCount = 0;

    nodes.forEach(node => {
      if (node.id === 'root') return;

      const isDone      = DONE_STATUSES.has(node.status);
      const isUrgent    = URGENT_STATUSES.has(node.status);
      const isMyTask    = (node.createdBy === userId) ||
                          (node.collaborators || []).includes(userId) ||
                          (node.assignees || []).some(a =>
                            a.toLowerCase() === userName.toLowerCase());
      const hasDueSoon  = node.dueDate &&
                          new Date(node.dueDate).getTime() <= in7days &&
                          !isDone;
      const matchesDept = !_dept || node.department === _dept;

      // Determine visibility
      let visible = true;
      let opacity = 1;
      let dimmed  = false;

      // Hide/show done tasks based on toggle
      if (isDone && !_showDone) {
        visible = false;
      }

      // Mode filter
      if (visible) {
        if (_mode === 'mine' && !isMyTask) {
          dimmed = true; opacity = DIMMED_OPACITY;
        } else if (_mode === 'focus' && !hasDueSoon && !isUrgent) {
          dimmed = true; opacity = DIMMED_OPACITY;
        }
      }

      // Dept filter
      if (visible && _dept && !matchesDept) {
        dimmed = true; opacity = DIMMED_OPACITY;
      }

      // Done tasks that ARE shown get faded appearance
      if (visible && isDone) {
        opacity = DONE_OPACITY;
        dimmed  = true;
      }

      if (visible) visibleCount++;

      // Apply to SVG node element
      const el = document.querySelector(`[data-node-id="${node.id}"]`);
      if (!el) return;

      if (!visible) {
        el.style.display  = 'none';
        el.style.opacity  = '';
      } else {
        el.style.display  = '';
        el.style.opacity  = opacity < 1 ? opacity : '';
        el.style.filter   = dimmed && !isDone ? 'saturate(0.4)' : '';
        el.style.transition = 'opacity 0.3s ease, filter 0.3s ease';

        // Add done strikethrough class
        el.classList.toggle('node-done', isDone);
        el.classList.toggle('node-urgent', isUrgent && !isDone);
      }
    });

    _updateCounter(visibleCount, nodes.length - 1); // -1 for root
  }

  function _updateCounter(visible, total) {
    const el = document.getElementById('vmb-count');
    if (!el) return;
    if (_mode === 'all' && !_dept) {
      el.textContent = total ? `${total} tasks` : '';
    } else {
      el.textContent = `${visible} of ${total} shown`;
    }
  }

  return {
    // Set view mode — 'all' | 'mine' | 'focus'
    set(mode, btnEl) {
      _mode = mode;
      _dept = '';
      document.getElementById('vmb-dept-select').value = '';

      document.querySelectorAll('.vmb-btn').forEach(b => b.classList.remove('active'));
      if (btnEl) btnEl.classList.add('active');

      _applyToCanvas();
    },

    // Set department filter
    setDept(dept) {
      _dept = dept;
      _mode = 'all';

      document.querySelectorAll('.vmb-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === 'all');
      });

      _applyToCanvas();
    },

    // Toggle showing/hiding completed tasks
    toggleDone() {
      _showDone = !_showDone;
      const label = document.getElementById('vmb-done-label');
      if (label) label.textContent = _showDone ? '👁️ Showing Done' : '👁️ Hide Done';
      _applyToCanvas();
    },

    // Call this after any mindmap re-render to reapply current filter
    refresh() {
      _applyToCanvas();
    },

    // Expose state for other modules
    get mode()     { return _mode; },
    get dept()     { return _dept; },
    get showDone() { return _showDone; },
  };
})();
