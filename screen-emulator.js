// Screen Emulator — opens pinned URL in a sized Chrome window

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
    this.selectedDevice = null;
    this.isLandscape = false;
    this.customW = 0;
    this.customH = 0;
    this.init();
  }

  init() {
    this.bindCategoryPills();
    this.bindCustomInputs();
    this.bindRotate();
    this.bindOpenBtn();
    this.renderGrid('mobile');
    this.restoreState();
  }

  bindCategoryPills() {
    document.querySelectorAll('.emulator-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.emulator-cat').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentCategory = btn.dataset.cat;
        this.selectedDevice = null;
        this.isLandscape = false;
        this.renderGrid(this.currentCategory);
        this.updateSelectedInfo();
        this.updateOpenBtn();
      });
    });
  }

  bindCustomInputs() {
    const wInput = document.getElementById('emulatorW');
    const hInput = document.getElementById('emulatorH');
    if (!wInput || !hInput) return;

    const onChange = () => {
      this.customW = parseInt(wInput.value) || 0;
      this.customH = parseInt(hInput.value) || 0;
      if (this.customW > 0 && this.customH > 0) {
        this.selectedDevice = { name: 'Custom', w: this.customW, h: this.customH };
        this.updateSelectedInfo();
        this.updateOpenBtn();
      }
    };
    wInput.addEventListener('input', onChange);
    hInput.addEventListener('input', onChange);
  }

  bindRotate() {
    const rotateBtn = document.getElementById('emulatorRotate');
    if (!rotateBtn) return;
    rotateBtn.addEventListener('click', () => {
      if (!this.selectedDevice) return;
      this.isLandscape = !this.isLandscape;
      rotateBtn.classList.toggle('rotated', this.isLandscape);
      this.updateSelectedInfo();
    });
  }

  bindOpenBtn() {
    const openBtn = document.getElementById('emulatorOpenBtn');
    if (!openBtn) return;
    openBtn.addEventListener('click', async () => {
      if (!this.selectedDevice) return;
      const url = await this.getPinnedUrl();
      const w = this.isLandscape ? this.selectedDevice.h : this.selectedDevice.w;
      const h = this.isLandscape ? this.selectedDevice.w : this.selectedDevice.h;

      const originalHTML = openBtn.innerHTML;
      openBtn.disabled = true;
      openBtn.textContent = 'Opening...';

      try {
        await chrome.windows.create({ url: url || 'about:blank', width: w, height: h, type: 'popup' });
      } catch (e) {
        console.error('Screen Emulator: failed to open window', e);
      }

      setTimeout(() => {
        openBtn.innerHTML = originalHTML;
        openBtn.disabled = false;
        this.updateOpenBtn();
      }, 800);
    });
  }

  async getPinnedUrl() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_TRACKED' });
      return resp?.trackedUrl || null;
    } catch {
      return null;
    }
  }

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

    devices.forEach((device, i) => {
      const card = document.createElement('button');
      card.className = 'emulator-card';
      card.dataset.index = i;
      card.dataset.cat = category;

      const ratio = Math.min(device.w, device.h) / Math.max(device.w, device.h);
      const isNarrow = device.w < device.h;

      card.innerHTML = `
        <div class="emulator-card-screen" style="aspect-ratio: ${device.w}/${device.h}">
          <div class="emulator-card-screen-inner"></div>
        </div>
        <div class="emulator-card-name">${device.name}</div>
        <div class="emulator-card-dims">${device.w} × ${device.h}</div>
      `;

      card.addEventListener('click', () => {
        grid.querySelectorAll('.emulator-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.selectedDevice = device;
        this.isLandscape = false;
        const rotateBtn = document.getElementById('emulatorRotate');
        if (rotateBtn) rotateBtn.classList.remove('rotated');
        this.updateSelectedInfo();
        this.updateOpenBtn();
        this.saveState();
      });

      grid.appendChild(card);
    });
  }

  updateSelectedInfo() {
    const nameEl = document.getElementById('emulatorDeviceName');
    const dimsEl = document.getElementById('emulatorDimensions');
    const selectedBar = document.getElementById('emulatorSelected');

    if (!this.selectedDevice) {
      if (nameEl) nameEl.textContent = 'No device selected';
      if (dimsEl) dimsEl.textContent = '';
      if (selectedBar) selectedBar.classList.remove('has-device');
      return;
    }

    const w = this.isLandscape ? this.selectedDevice.h : this.selectedDevice.w;
    const h = this.isLandscape ? this.selectedDevice.w : this.selectedDevice.h;
    if (nameEl) nameEl.textContent = this.selectedDevice.name + (this.isLandscape ? ' (Landscape)' : '');
    if (dimsEl) dimsEl.textContent = `${w} × ${h} px`;
    if (selectedBar) selectedBar.classList.add('has-device');
  }

  updateOpenBtn() {
    const openBtn = document.getElementById('emulatorOpenBtn');
    if (!openBtn) return;
    openBtn.disabled = !this.selectedDevice;
  }

  saveState() {
    try {
      if (this.selectedDevice) {
        chrome.storage.local.set({
          emulatorState: {
            category: this.currentCategory,
            device: this.selectedDevice
          }
        });
      }
    } catch (e) {}
  }

  restoreState() {
    try {
      chrome.storage.local.get(['emulatorState'], (result) => {
        const saved = result.emulatorState;
        if (!saved) return;

        const catBtn = document.querySelector(`.emulator-cat[data-cat="${saved.category}"]`);
        if (catBtn) catBtn.click();

        if (saved.device && saved.category !== 'custom') {
          const grid = document.getElementById('emulatorGrid');
          const devices = EMULATOR_DEVICES[saved.category] || [];
          const idx = devices.findIndex(d => d.name === saved.device.name);
          if (idx >= 0 && grid) {
            setTimeout(() => {
              const cards = grid.querySelectorAll('.emulator-card');
              if (cards[idx]) cards[idx].click();
            }, 50);
          }
        }
      });
    } catch (e) {}
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.screenEmulator = new ScreenEmulator();
});
