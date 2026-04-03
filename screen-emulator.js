// Screen Emulator — multi-device queue, opens pinned URL in a sized window per device

const EMULATOR_DEVICES = {
  mobile: [
    { name: 'iPhone SE', w: 375, h: 667 },
    { name: 'iPhone 14', w: 390, h: 844 },
    { name: 'iPhone 14 Pro Max', w: 430, h: 932 },
    { name: 'Galaxy S23', w: 360, h: 800 },
    { name: 'Pixel 7', w: 412, h: 915 },
    { name: 'Galaxy Fold (open)', w: 717, h: 1000 }
  ],
  tablet: [
    { name: 'iPad Mini', w: 768, h: 1024 },
    { name: 'iPad Air', w: 820, h: 1180 },
    { name: 'iPad Pro 11"', w: 834, h: 1194 },
    { name: 'iPad Pro 12.9"', w: 1024, h: 1366 },
    { name: 'Surface Pro 9', w: 912, h: 1368 }
  ],
  desktop: [
    { name: 'Small Laptop', w: 1280, h: 800 },
    { name: 'MacBook Air', w: 1440, h: 900 },
    { name: 'Full HD', w: 1920, h: 1080 },
    { name: '4K / Wide', w: 2560, h: 1440 }
  ]
};

class ScreenEmulator {
  constructor() {
    this.currentCategory = 'mobile';
    this.selectedDevices = []; // [{ device, isLandscape, uid }]
    this.uidCounter = 0;
    this.customW = 0;
    this.customH = 0;
    this.init();
  }

  init() {
    this.bindCategoryPills();
    this.bindCustomInputs();
    this.bindOpenBtn();
    this.renderGrid('mobile');
    this.renderDeviceList();
    this.restoreState();
  }

  // ── Category pills ──────────────────────────────────────────────────

  bindCategoryPills() {
    document.querySelectorAll('.emulator-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.emulator-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentCategory = btn.dataset.cat;
        this.renderGrid(this.currentCategory);
      });
    });
  }

  // ── Custom size ─────────────────────────────────────────────────────

  bindCustomInputs() {
    const wInput = document.getElementById('emulatorW');
    const hInput = document.getElementById('emulatorH');
    if (!wInput || !hInput) return;

    const onAdd = () => {
      const w = parseInt(wInput.value) || 0;
      const h = parseInt(hInput.value) || 0;
      if (w >= 240 && h >= 240) {
        this.addDevice({ name: `Custom ${w}×${h}`, w, h });
      }
    };

    // Add on Enter in either field
    [wInput, hInput].forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') onAdd(); });
    });

    // Custom add button
    const addCustomBtn = document.getElementById('emulatorCustomAdd');
    if (addCustomBtn) addCustomBtn.addEventListener('click', onAdd);
  }

  // ── Device grid ─────────────────────────────────────────────────────

  renderGrid(category) {
    const grid = document.getElementById('emulatorGrid');
    const customPanel = document.getElementById('emulatorCustom');
    if (!grid) return;

    if (category === 'custom') {
      grid.innerHTML = '';
      if (customPanel) customPanel.classList.remove('hidden');
      return;
    }

    if (customPanel) customPanel.classList.add('hidden');
    const devices = EMULATOR_DEVICES[category] || [];
    grid.innerHTML = '';

    devices.forEach(device => {
      const card = document.createElement('button');
      card.className = 'emulator-card';
      card.dataset.name = device.name;

      card.innerHTML = `
        <div class="emulator-card-screen" style="aspect-ratio: ${device.w}/${device.h}">
          <div class="emulator-card-screen-inner"></div>
        </div>
        <div class="emulator-card-name">${device.name}</div>
        <div class="emulator-card-dims">${device.w} × ${device.h}</div>
        <div class="emulator-card-add-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
      `;

      card.addEventListener('click', () => {
        this.addDevice(device);
        card.classList.add('pulse');
        setTimeout(() => card.classList.remove('pulse'), 400);
      });

      grid.appendChild(card);
    });
  }

  // ── Device list management ──────────────────────────────────────────

  addDevice(device) {
    const uid = ++this.uidCounter;
    this.selectedDevices.push({ device, isLandscape: false, uid });
    this.renderDeviceList();
    this.updateOpenBtn();
    this.saveState();
  }

  removeDevice(uid) {
    this.selectedDevices = this.selectedDevices.filter(d => d.uid !== uid);
    this.renderDeviceList();
    this.updateOpenBtn();
    this.saveState();
  }

  toggleRotation(uid) {
    const entry = this.selectedDevices.find(d => d.uid === uid);
    if (!entry) return;
    entry.isLandscape = !entry.isLandscape;
    this.renderDeviceList();
    this.saveState();
  }

  renderDeviceList() {
    const list = document.getElementById('emulatorDeviceList');
    if (!list) return;

    if (this.selectedDevices.length === 0) {
      list.innerHTML = '<div class="emulator-list-empty">Tap a device above to add it</div>';
      return;
    }

    list.innerHTML = '';

    this.selectedDevices.forEach(entry => {
      const { device, isLandscape, uid } = entry;
      const w = isLandscape ? device.h : device.w;
      const h = isLandscape ? device.w : device.h;

      const item = document.createElement('div');
      item.className = 'emulator-device-item';

      item.innerHTML = `
        <div class="emulator-item-thumb" style="aspect-ratio: ${w}/${h}">
          <div class="emulator-card-screen-inner"></div>
        </div>
        <div class="emulator-item-info">
          <span class="emulator-item-name">${device.name}</span>
          <span class="emulator-item-dims">${w} × ${h} px${isLandscape ? ' · ⟳' : ''}</span>
        </div>
        <button class="emulator-item-rotate${isLandscape ? ' rotated' : ''}" title="Toggle Landscape / Portrait" aria-label="Rotate">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <button class="emulator-item-remove" aria-label="Remove ${device.name}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;

      item.querySelector('.emulator-item-rotate').addEventListener('click', () => this.toggleRotation(uid));
      item.querySelector('.emulator-item-remove').addEventListener('click', () => this.removeDevice(uid));

      list.appendChild(item);
    });
  }

  // ── Open button ─────────────────────────────────────────────────────

  bindOpenBtn() {
    const openBtn = document.getElementById('emulatorOpenBtn');
    if (!openBtn) return;

    openBtn.addEventListener('click', async () => {
      if (this.selectedDevices.length === 0) return;
      const url = await this.getPinnedUrl();

      const originalHTML = openBtn.innerHTML;
      openBtn.disabled = true;
      openBtn.textContent = 'Opening…';

      try {
        // Store launch data for the emulator view tab to read
        await chrome.storage.local.set({
          emulatorLaunchData: {
            devices: this.selectedDevices.map(e => ({
              device: e.device,
              isLandscape: e.isLandscape
            })),
            url: url || 'about:blank'
          }
        });

        // Open the multi-device view as a new tab (to the left of the current tab)
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const insertIndex = activeTabs[0]?.index ?? 0;

        await chrome.tabs.create({
          url: chrome.runtime.getURL('emulator-view.html'),
          index: insertIndex,
          active: true
        });
      } catch (e) {
        console.error('Screen Emulator: failed to open view', e);
      }

      setTimeout(() => {
        openBtn.innerHTML = originalHTML;
        openBtn.disabled = false;
        this.updateOpenBtn();
      }, 800);
    });
  }

  updateOpenBtn() {
    const openBtn = document.getElementById('emulatorOpenBtn');
    if (!openBtn) return;
    openBtn.disabled = this.selectedDevices.length === 0;

    const countEl = document.getElementById('emulatorOpenCount');
    if (countEl) {
      if (this.selectedDevices.length > 1) {
        countEl.textContent = ` (${this.selectedDevices.length})`;
        countEl.style.display = '';
      } else {
        countEl.style.display = 'none';
      }
    }
  }

  async getPinnedUrl() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_TRACKED' });
      return resp?.trackedUrl || null;
    } catch {
      return null;
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────

  saveState() {
    try {
      chrome.storage.local.set({
        emulatorState: {
          category: this.currentCategory,
          devices: this.selectedDevices.map(e => ({ device: e.device, isLandscape: e.isLandscape }))
        }
      });
    } catch (e) {}
  }

  restoreState() {
    try {
      chrome.storage.local.get(['emulatorState'], (result) => {
        const saved = result.emulatorState;
        if (!saved) return;

        const catBtn = document.querySelector(`.emulator-cat[data-cat="${saved.category}"]`);
        if (catBtn) catBtn.click();

        if (Array.isArray(saved.devices)) {
          saved.devices.forEach(entry => {
            const uid = ++this.uidCounter;
            this.selectedDevices.push({ device: entry.device, isLandscape: entry.isLandscape, uid });
          });
          this.renderDeviceList();
          this.updateOpenBtn();
        }
      });
    } catch (e) {}
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.screenEmulator = new ScreenEmulator();
});
