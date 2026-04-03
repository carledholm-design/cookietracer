// Tab Manager v19 — tab switching and gear dropdowns

class TabManagerV18 {
  constructor() {
    this.pinnedTabs = ['cookietracer'];
    this.init();
  }

  init() {
    this.setupTabSwitching();
    this.setupGearDropdowns();
  }

  setupTabSwitching() {
    document.querySelectorAll('.tab[data-tab]').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-close')) {
          this.switchToTab(tab.dataset.tab);
        }
      });
    });
  }

  switchToTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector(`[data-tab="${tabId}"]`);
    if (activeTab) activeTab.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const activeContent = document.getElementById(`content-${tabId}`);
    if (activeContent) activeContent.classList.add('active');

    const pinned = document.getElementById('pinnedIndicator');
    const health = document.getElementById('healthScoreBar');
    const show = this.pinnedTabs.includes(tabId);
    if (pinned) pinned.style.display = show ? '' : 'none';
    if (health) health.style.display = show ? '' : 'none';
  }

  setupGearDropdowns() {
    document.querySelectorAll('.settings-gear-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.querySelector('.settings-dropdown');
        if (!dropdown) return;
        document.querySelectorAll('.settings-dropdown.open').forEach(d => {
          if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
      });
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('.settings-dropdown.open').forEach(d => d.classList.remove('open'));
    });

    document.querySelectorAll('.settings-dropdown').forEach(d => {
      d.addEventListener('click', (e) => e.stopPropagation());
    });
  }
}

window.tabManagerV17 = new TabManagerV18();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.settings-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});
