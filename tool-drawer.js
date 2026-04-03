// Tool Drawer — opens from the "+" tab button, adds/removes tool tabs

const TOOL_DEFINITIONS = {
  fontchecker: {
    name: 'Font Inspector',
    desc: 'Detect fonts, sizes, weights',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9.5" y1="4" x2="9.5" y2="20"/><line x1="14.5" y1="4" x2="14.5" y2="20"/><line x1="7" y1="20" x2="17" y2="20"/></svg>`
  },
  colorinspector: {
    name: 'Color Inspector',
    desc: 'Extract palettes & CSS colors',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 22C6.5 22 2 17.5 2 12s4.5-10 10-10c.926 0 1.648.816 1.648 1.748 0 .896-.538 1.464-1.148 2.252-.61.788-1.5 1.752-1.5 3C11 11.104 11.896 12 13 12h1.5c2.485 0 4.5 2.015 4.5 4.5C19 20.096 16 22 12 22z"/></svg>`
  },
  cssinspector: {
    name: 'CSS Inspector',
    desc: 'Copy styles, spacing, layout',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
  },
  screenemulator: {
    name: 'Screen Emulator',
    desc: 'Preview at any screen size',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><rect x="7" y="7" width="6" height="10" rx="1"/></svg>`
  }
};

const TAB_ICONS = {
  fontchecker: `<svg class="tabIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9.5" y1="4" x2="9.5" y2="20"/><line x1="14.5" y1="4" x2="14.5" y2="20"/><line x1="7" y1="20" x2="17" y2="20"/></svg>`,
  colorinspector: `<svg class="tabIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 22C6.5 22 2 17.5 2 12s4.5-10 10-10c.926 0 1.648.816 1.648 1.748 0 .896-.538 1.464-1.148 2.252-.61.788-1.5 1.752-1.5 3C11 11.104 11.896 12 13 12h1.5c2.485 0 4.5 2.015 4.5 4.5C19 20.096 16 22 12 22z"/></svg>`,
  cssinspector: `<svg class="tabIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  screenemulator: `<svg class="tabIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><rect x="7" y="7" width="6" height="10" rx="1"/></svg>`
};

class ToolDrawer {
  constructor() {
    this.activeTabs = [];
    this.isOpen = false;
    this.init();
  }

  init() {
    this.injectAddButton();
    this.bindDrawer();
    this.bindSearch();
    this.restorePersistedTabs();
  }

  injectAddButton() {
    const tabsContainer = document.getElementById('tabsContainer');
    if (!tabsContainer || document.getElementById('addToolBtn')) return;

    const btn = document.createElement('button');
    btn.className = 'tab-add-btn';
    btn.id = 'addToolBtn';
    btn.title = 'Add Tool';
    btn.setAttribute('aria-label', 'Add Tool');
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    btn.addEventListener('click', () => this.openDrawer());
    tabsContainer.appendChild(btn);
  }

  openDrawer() {
    const drawer = document.getElementById('toolDrawer');
    const scrim = document.getElementById('toolDrawerScrim');
    if (!drawer || !scrim) return;
    this.updateDrawerItems();
    drawer.classList.add('open');
    scrim.classList.add('open');
    this.isOpen = true;
    const searchInput = document.getElementById('toolDrawerSearch');
    if (searchInput) { searchInput.value = ''; this.filterTools(''); searchInput.focus(); }
  }

  closeDrawer() {
    const drawer = document.getElementById('toolDrawer');
    const scrim = document.getElementById('toolDrawerScrim');
    if (!drawer || !scrim) return;
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    this.isOpen = false;
  }

  bindDrawer() {
    const closeBtn = document.getElementById('toolDrawerClose');
    const scrim = document.getElementById('toolDrawerScrim');
    const list = document.getElementById('toolDrawerList');

    if (closeBtn) closeBtn.addEventListener('click', () => this.closeDrawer());
    if (scrim) scrim.addEventListener('click', () => this.closeDrawer());

    if (list) {
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.tool-drawer-item[data-tool]');
        if (!item) return;
        const toolId = item.dataset.tool;
        if (this.activeTabs.includes(toolId)) {
          this.removeTab(toolId);
        } else {
          this.addTab(toolId);
        }
        this.updateDrawerItems();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.closeDrawer();
    });
  }

  bindSearch() {
    const searchInput = document.getElementById('toolDrawerSearch');
    if (!searchInput) return;
    searchInput.addEventListener('input', () => this.filterTools(searchInput.value.trim().toLowerCase()));
  }

  filterTools(query) {
    const items = document.querySelectorAll('.tool-drawer-item[data-tool]');
    items.forEach(item => {
      const toolId = item.dataset.tool;
      const def = TOOL_DEFINITIONS[toolId];
      if (!def) return;
      const match = !query || def.name.toLowerCase().includes(query) || def.desc.toLowerCase().includes(query);
      item.style.display = match ? '' : 'none';
    });
  }

  updateDrawerItems() {
    const list = document.getElementById('toolDrawerList');
    if (!list) return;
    list.innerHTML = '';

    Object.entries(TOOL_DEFINITIONS).forEach(([toolId, def]) => {
      const isActive = this.activeTabs.includes(toolId);
      const btn = document.createElement('button');
      btn.className = 'tool-drawer-item' + (isActive ? ' active' : '');
      btn.dataset.tool = toolId;
      btn.innerHTML = `
        <div class="tool-drawer-icon">${def.icon}</div>
        <div class="tool-drawer-label">
          <span class="tool-drawer-name">${def.name}</span>
          <span class="tool-drawer-desc">${def.desc}</span>
        </div>
        <div class="tool-drawer-status">${isActive ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'}</div>
      `;
      list.appendChild(btn);
    });
  }

  addTab(toolId) {
    if (this.activeTabs.includes(toolId)) return;
    const def = TOOL_DEFINITIONS[toolId];
    if (!def) return;

    this.activeTabs.push(toolId);
    this.renderTabButton(toolId, def);
    this.persistTabs();
    this.closeDrawer();

    if (window.tabManagerV17) {
      window.tabManagerV17.switchToTab(toolId);
    }
  }

  renderTabButton(toolId, def) {
    const tabsContainer = document.getElementById('tabsContainer');
    const addBtn = document.getElementById('addToolBtn');
    if (!tabsContainer) return;

    const existing = tabsContainer.querySelector(`[data-tab="${toolId}"]`);
    if (existing) return;

    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.tab = toolId;
    tab.title = def.name;
    tab.innerHTML = `
      ${TAB_ICONS[toolId] || ''}
      <span class="tabName">${def.name}</span>
      <span class="tab-fade"></span>
      <button class="tab-close" data-close="${toolId}" aria-label="Close ${def.name}" title="Close">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) {
        e.stopPropagation();
        this.removeTab(toolId);
        return;
      }
      if (window.tabManagerV17) window.tabManagerV17.switchToTab(toolId);
    });

    if (addBtn) {
      tabsContainer.insertBefore(tab, addBtn);
    } else {
      tabsContainer.appendChild(tab);
    }

    if (window.tabManagerV17) {
      window.tabManagerV17.setupGearDropdowns();
    }
  }

  removeTab(toolId) {
    this.activeTabs = this.activeTabs.filter(id => id !== toolId);
    const tab = document.querySelector(`[data-tab="${toolId}"]`);
    if (tab) tab.remove();

    const activeContent = document.getElementById(`content-${toolId}`);
    if (activeContent && activeContent.classList.contains('active')) {
      if (window.tabManagerV17) window.tabManagerV17.switchToTab('cookietracer');
    }

    this.persistTabs();
  }

  persistTabs() {
    try {
      chrome.storage.local.set({ activeToolTabs: this.activeTabs });
    } catch (e) {}
  }

  restorePersistedTabs() {
    try {
      chrome.storage.local.get(['activeToolTabs'], (result) => {
        const saved = result.activeToolTabs || [];
        saved.forEach(toolId => {
          if (TOOL_DEFINITIONS[toolId] && !this.activeTabs.includes(toolId)) {
            this.activeTabs.push(toolId);
            this.renderTabButton(toolId, TOOL_DEFINITIONS[toolId]);
          }
        });
      });
    } catch (e) {}
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.toolDrawer = new ToolDrawer();
});
