// ─── Bits & Studios — Mind Map D3.js Visualization ────────────────────────

class MindMap {
  constructor(containerId, dataLayer) {
    this.container = document.getElementById(containerId);
    this.data = dataLayer;
    
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    
    this.selectedNodeId = null;
    this.callbacks = {
      onNodeSelect: () => {},
      onNodeDoubleTap: () => {},
    };

    // D3 Elements
    this.svg = null;
    this.g = null;
    this.zoom = null;
    this.linkGroup = null;
    this.nodeGroup = null;

    this.init();
    
    // Bind to window resize
    window.addEventListener('resize', () => {
      this.width = this.container.clientWidth;
      this.height = this.container.clientHeight;
      if (this.svg) {
        this.svg.attr('width', this.width).attr('height', this.height);
      }
    });

    this.setupKeyboardShortcuts();
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input/textarea (like the chat or sidebar)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (!this.selectedNodeId) return;
      const node = this.data.getNode(this.selectedNodeId);
      if (!node) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        const newNode = this.data.addNode(this.selectedNodeId, { label: 'New Task' });
        this.selectNode(newNode.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (node.parentId) {
          const newNode = this.data.addNode(node.parentId, { label: 'New Task' });
          this.selectNode(newNode.id);
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (node.id !== 'root') {
          const parentId = node.parentId;
          this.data.deleteNode(node.id);
          if (parentId) this.selectNode(parentId);
        }
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        this.navigateTree(e.key, node);
      }
    });
  }

  navigateTree(key, node) {
    if (key === 'ArrowLeft' && node.parentId) {
      this.selectNode(node.parentId);
    } else if (key === 'ArrowRight') {
      const children = this.data.getChildren(node.id);
      if (children.length > 0) this.selectNode(children[0].id);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (node.parentId) {
        const siblings = this.data.getChildren(node.parentId);
        const idx = siblings.findIndex(n => n.id === node.id);
        if (key === 'ArrowUp' && idx > 0) {
          this.selectNode(siblings[idx - 1].id);
        } else if (key === 'ArrowDown' && idx < siblings.length - 1) {
          this.selectNode(siblings[idx + 1].id);
        }
      }
    }
  }

  init() {
    this.container.innerHTML = '';
    
    // Set up Zoom
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
      });

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('id', 'mindmap-svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .call(this.zoom)
      .on('click', (event) => {
        if (event.target.tagName === 'svg') {
          this.selectNode(null);
        }
      });
    
    this.g = this.svg.append('g')
      .attr('transform', `translate(100, ${this.height / 2})`); // Center Y, padding left
    
    // We update the zoom's internal transform state to match
    this.svg.call(this.zoom.transform, d3.zoomIdentity.translate(100, this.height / 2));

    this.linkGroup = this.g.append('g').attr('class', 'links');
    this.nodeGroup = this.g.append('g').attr('class', 'nodes');

    this.render();
  }

  getNodeColor(d) {
    if (d.data.id === 'root') return '#ff6600'; // Primary
    if (d.data.department && window.DEPARTMENTS[d.data.department]) {
      return window.DEPARTMENTS[d.data.department].color;
    }
    return '#64748b'; // Default muted
  }

  render() {
    const rawTree = this.data.toTreeData();
    if (!rawTree) return;

    // Create D3 Hierarchy
    const root = d3.hierarchy(rawTree);
    
    // Create Tree Layout
    // nodeSize creates a standard compact layout, horizontal mode means y is width, x is height
    const treeLayout = d3.tree().nodeSize([45, 300]); 
    treeLayout(root);

    // D3 tree outputs top-to-bottom. We want left-to-right, so we'll swap x and y when rendering.
    const nodes = root.descendants();
    const links = root.links();

    /* ─── Links ─── */
    const link = this.linkGroup.selectAll('.mm-link')
      .data(links, d => d.source.data.id + '-' + d.target.data.id);

    link.exit().remove();
    
    const linkEnter = link.enter().append('path')
      .attr('class', 'mm-link');

    this.linkElements = linkEnter.merge(link);
    
    // Diagonal bezier path
    this.linkElements.attr('d', d => {
       const sourceX = d.source.y;
       const sourceY = d.source.x;
       const targetX = d.target.y;
       const targetY = d.target.x;
       
       return `M ${sourceX} ${sourceY}
               C ${(sourceX + targetX) / 2} ${sourceY},
                 ${(sourceX + targetX) / 2} ${targetY},
                 ${targetX} ${targetY}`;
    });

    /* ─── Nodes ─── */
    const node = this.nodeGroup.selectAll('.mm-node')
      .data(nodes, d => d.data.id);

    node.exit().remove();

    const nodeEnter = node.enter().append('g')
      .attr('class', 'mm-node')
      .attr('id', d => 'ui-' + d.data.id)
      .on('click', (e, d) => {
        e.stopPropagation();
        this.selectNode(d.data.id);
      })
      .on('dblclick', (e, d) => {
        e.stopPropagation();
        this.callbacks.onNodeDoubleTap(d.data);
      })
      .on('contextmenu', (e, d) => {
        e.preventDefault();
        this.selectNode(d.data.id);
        this.showContextMenu(e, d.data);
      });

    // Rect shape
    const rectHeight = 36;
    nodeEnter.append('rect')
      .attr('class', 'mm-node-rect')
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('height', rectHeight)
      .attr('y', -rectHeight / 2);

    // Icon
    nodeEnter.append('text')
      .attr('class', 'mm-node-icon')
      .attr('x', 14)
      .attr('y', 0)
      .attr('dominant-baseline', 'central')
      .text(d => d.data.icon || (d.data.id === 'root' ? '🎯' : '📌'));

    // Text Label
    nodeEnter.append('text')
      .attr('class', 'mm-node-label')
      .attr('x', 36)
      .attr('y', 0)
      .attr('dominant-baseline', 'central')
      .text(d => {
        // limit to ~45 chars
        let txt = d.data.label;
        if (txt.length > 45) txt = txt.substring(0, 42) + '...';
        return txt;
      });

    // Expand/Collapse Button (if has children)
    const collapseGroup = nodeEnter.append('g')
      .attr('class', 'mm-collapse-btn')
      .on('click', (e, d) => {
        e.stopPropagation();
        this.data.updateNode(d.data.id, { collapsed: !d.data.collapsed });
      });

    collapseGroup.append('circle')
      .attr('class', 'mm-collapse-circle')
      .attr('r', 10);

    collapseGroup.append('text')
      .attr('class', 'mm-collapse-text')
      .text(d => d.data.collapsed ? '+' : '-');

    this.nodeElements = nodeEnter.merge(node);
    
    // Position the nodes (swap x and y for horizontal)
    this.nodeElements.attr('transform', d => `translate(${d.y},${d.x})`);

    // Dynamic width based on text
    this.nodeElements.each((d, i, elements) => {
      const g = d3.select(elements[i]);
      const textNode = g.select('.mm-node-label').node();
      let textWidth = textNode.getComputedTextLength();
      let totalWidth = textWidth + 50; // padding
      if (totalWidth < 120) totalWidth = 120;
      
      const isDone = d.data.status === 'done';
      
      g.select('.mm-node-rect')
        .attr('width', totalWidth)
        .attr('x', 0)
        .attr('fill', isDone ? '#d1fae5' : '#ffffff')
        .attr('stroke', this.getNodeColor(d))
        .attr('stroke-width', 2);
        
      g.select('.mm-collapse-btn')
        .style('display', d.data._childCount > 0 ? 'block' : 'none')
        .attr('transform', `translate(${totalWidth + 10}, 0)`);
        
      // Also update text and icon for dynamic re-renders
      g.select('.mm-node-label').text(() => {
          let txt = d.data.label;
          if (txt.length > 45) txt = txt.substring(0, 42) + '...';
          return txt;
      });
      g.select('.mm-node-icon').text(d.data.icon || (d.data.id === 'root' ? '🎯' : '📌'));
      g.select('.mm-collapse-text').text(d.data.collapsed ? '+' : '-');
    });

    this.updateSelection();
  }

  selectNode(id) {
    this.selectedNodeId = id;
    this.updateSelection();
    this.callbacks.onNodeSelect(id);
  }

  updateSelection() {
    this.nodeGroup.selectAll('.mm-node')
      .classed('selected', d => d.data.id === this.selectedNodeId);
      
    this.linkGroup.selectAll('.mm-link')
      .classed('highlighted', d => d.source.data.id === this.selectedNodeId || d.target.data.id === this.selectedNodeId);
  }
  
  focusNode(id) {
    const nodeEl = this.nodeGroup.selectAll('.mm-node').filter(d => d.data.id === id);
    if (!nodeEl.empty()) {
      const d = nodeEl.datum();
      this.svg.transition().duration(750).call(
        this.zoom.transform,
        d3.zoomIdentity.translate(this.width / 2, this.height / 2).scale(1.2).translate(-d.y, -d.x)
      );
    }
  }

  // --- Context Menu ---
  showContextMenu(e, d) {
    let menu = document.getElementById('context-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'context-menu';
      document.body.appendChild(menu);
      
      document.addEventListener('click', () => {
         menu.classList.add('hidden');
      });
    }
    
    menu.innerHTML = '';
    menu.classList.remove('hidden');
    
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    
    const options = [];
    options.push({
      label: 'Add Child Task (Tab)', icon: '➕', action: () => {
         const n = this.data.addNode(d.id, { label: 'New Task' });
         setTimeout(() => { this.selectNode(n.id); }, 100);
      }
    });
    
    if (d.id !== 'root') {
      options.push({
        label: 'Add Sibling (Enter)', icon: '➡️', action: () => {
           const n = this.data.addNode(d.parentId, { label: 'New Task' });
           setTimeout(() => { this.selectNode(n.id); }, 100);
        }
      });
    }

    options.push({
      label: d.collapsed ? 'Expand Branch' : 'Collapse Branch', icon: d.collapsed ? '🔽' : '🔼', action: () => {
         this.data.updateNode(d.id, { collapsed: !d.collapsed });
      }
    });
    
    if (d.id !== 'root') {
      options.push({ divider: true });
      options.push({
        label: 'Mark Done', icon: '✅', action: () => {
           this.data.updateNode(d.id, { status: 'done' });
        }
      });
      options.push({
        label: 'Delete Node (Del)', icon: '🗑️', danger: true, action: () => {
           if (confirm(`Delete "${d.label}" and all sub-tasks?`)) {
             this.data.deleteNode(d.id);
             this.selectNode(null);
           }
        }
      });
    }
    
    options.forEach(opt => {
      if (opt.divider) {
        const div = document.createElement('div');
        div.className = 'ctx-divider';
        menu.appendChild(div);
        return;
      }
      
      const btn = document.createElement('button');
      btn.className = 'ctx-item' + (opt.danger ? ' danger' : '');
      btn.innerHTML = `<span class="ctx-icon">${opt.icon}</span> ${opt.label}`;
      btn.onclick = () => {
         opt.action();
         menu.classList.add('hidden');
      };
      menu.appendChild(btn);
    });
  }
}

window.MindMap = MindMap;
