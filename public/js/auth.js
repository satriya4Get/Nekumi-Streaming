/**
 * Nekumi Streaming Platform - Authentication & User Profile Manager
 */

const Auth = {
  tokenKey: 'nekumi_jwt_token',
  userKey: 'nekumi_user_data',

  currentUser: null,
  selectedAvatarPreset: '',
  currentRegCaptchaId: '',
  currentForgotCaptchaId: '',

  avatarPresets: [
    { name: 'Nekumi Cat', url: '/images/nekumi-logo.png' },
    { name: 'Gojo Satoru', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=GojoSatoru' },
    { name: 'Marin Kitagawa', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=MarinKitagawa' },
    { name: 'Anya Forger', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=AnyaPeanuts' },
    { name: 'Tanjiro', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=TanjiroKamado' },
    { name: 'Luffy', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=MonkeyDLuffy' }
  ],

  init() {
    this.loadSession();
    this.setupEventListeners();
  },

  getToken() {
    return localStorage.getItem(this.tokenKey) || localStorage.getItem('aninonton_jwt_token');
  },

  isLoggedIn() {
    return !!this.getToken() && !!this.currentUser;
  },

  isAdmin() {
    return this.isLoggedIn() && this.currentUser.role === 'admin';
  },

  getRankTitle(level = 1) {
    const lvl = parseInt(level) || 1;
    if (lvl >= 50) return '👑 Hokage Streaming';
    if (lvl >= 35) return '💎 Master Otaku';
    if (lvl >= 20) return '🥇 Wibu Elite';
    if (lvl >= 10) return '🥈 Senpai Streamer';
    if (lvl >= 5) return '🥉 Anime Scout';
    return '🌱 Otaku Pemula';
  },

  loadSession() {
    const token = this.getToken();
    const storedUser = localStorage.getItem(this.userKey) || localStorage.getItem('aninonton_user_data');

    if (token && storedUser) {
      try {
        this.currentUser = JSON.parse(storedUser);
        this.updateUI();
        this.verifyToken();
      } catch (e) {
        this.logout();
      }
    } else {
      this.updateUI();
    }
  },

  async verifyToken() {
    const token = this.getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.user) {
        this.currentUser = data.user;
        localStorage.setItem(this.userKey, JSON.stringify(data.user));
        this.updateUI();
      } else {
        this.logout();
      }
    } catch (err) {
      console.warn('Network issue during token verification:', err.message);
    }
  },

  async login(loginIdentifier, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginIdentifier, password })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Login gagal.');
      }

      localStorage.setItem(this.tokenKey, data.token);
      localStorage.setItem(this.userKey, JSON.stringify(data.user));
      this.currentUser = data.user;

      this.updateUI();
      this.closeModal();
      showToast(data.message, 'success');

      if (window.App) {
        App.loadUserHistory();
        App.loadUserBookmarks();
      }
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  },

  async register(username, email, password, captcha_id, captcha_code) {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, captcha_id, captcha_code })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        this.fetchCaptcha('reg');
        throw new Error(data.message || 'Pendaftaran gagal.');
      }

      localStorage.setItem(this.tokenKey, data.token);
      localStorage.setItem(this.userKey, JSON.stringify(data.user));
      this.currentUser = data.user;

      this.updateUI();
      this.closeModal();
      showToast(data.message, 'success');

      if (window.App) {
        App.loadUserHistory();
        App.loadUserBookmarks();
      }
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  },

  logout() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    localStorage.removeItem('aninonton_jwt_token');
    localStorage.removeItem('aninonton_user_data');
    this.currentUser = null;
    this.updateUI();
    showToast('Anda telah keluar dari Nekumi.', 'info');
    
    if (location.hash === '#admin' || location.hash === '#history' || location.hash === '#watchlist') {
      window.location.hash = '';
    }

    if (window.App) {
      const contSection = document.getElementById('continueWatchingSection');
      if (contSection) contSection.style.display = 'none';
    }
  },

  updateUI() {
    const guestNav = document.getElementById('guestNavGroup');
    const userNav = document.getElementById('userNavGroup');
    const adminNav = document.getElementById('adminNavLink');
    const menuItemAdmin = document.getElementById('menuItemAdmin');
    const mobileAdmin = document.getElementById('mobileAdminLink');
    const commentNotice = document.getElementById('commentUserNotice');

    if (this.isLoggedIn()) {
      if (guestNav) guestNav.style.display = 'none';
      if (userNav) userNav.style.display = 'block';

      const avatar = this.currentUser.avatar || '/images/nekumi-logo.png';
      const navAvatar = document.getElementById('navUserAvatar');
      const userBtn = document.getElementById('userMenuToggle');
      const navName = document.getElementById('navUserName');
      const navRole = document.getElementById('navUserRole');
      const navLevel = document.getElementById('navUserLevel');
      const dropdownFull = document.getElementById('dropdownUserFull');
      const dropdownEmail = document.getElementById('dropdownUserEmail');
      const dropdownRank = document.getElementById('dropdownUserRank');
      const dropdownXP = document.getElementById('dropdownUserXP');

      const userLevel = this.currentUser.level || 1;
      const userXP = this.currentUser.xp || 0;
      const rankTitle = this.getRankTitle(userLevel);
      const isAdmin = this.isAdmin();

      if (navAvatar) {
        navAvatar.src = avatar;
        navAvatar.onerror = () => { navAvatar.src = '/images/nekumi-logo.png'; };
        navAvatar.classList.toggle('is-admin', isAdmin);
      }
      if (userBtn) {
        userBtn.classList.toggle('is-admin', isAdmin);
      }

      if (navName) navName.textContent = this.currentUser.username;
      if (navLevel) navLevel.textContent = `Lv. ${userLevel}`;
      if (dropdownFull) dropdownFull.textContent = this.currentUser.username;
      if (dropdownEmail) dropdownEmail.textContent = this.currentUser.email;
      if (dropdownRank) dropdownRank.textContent = rankTitle;
      if (dropdownXP) dropdownXP.textContent = `${userXP} EXP`;

      if (navRole) {
        navRole.textContent = this.currentUser.role.toUpperCase();
        navRole.className = this.currentUser.role === 'admin' ? 'role-tag admin' : 'role-tag';
      }

      if (menuItemAdmin) menuItemAdmin.style.display = isAdmin ? 'flex' : 'none';
      if (mobileAdmin) mobileAdmin.style.display = isAdmin ? 'block' : 'none';

      if (commentNotice) commentNotice.textContent = `Masuk sebagai: ${this.currentUser.username} (${rankTitle})`;
    } else {
      const navAvatar = document.getElementById('navUserAvatar');
      const userBtn = document.getElementById('userMenuToggle');
      if (navAvatar) navAvatar.classList.remove('is-admin');
      if (userBtn) userBtn.classList.remove('is-admin');

      if (guestNav) guestNav.style.display = 'flex';
      if (userNav) userNav.style.display = 'none';
      if (menuItemAdmin) menuItemAdmin.style.display = 'none';
      if (mobileAdmin) mobileAdmin.style.display = 'none';
      if (commentNotice) commentNotice.textContent = 'Masuk untuk dapat berkomentar';
    }
  },

  openProfileModal() {
    if (!this.isLoggedIn()) {
      showToast('Silakan masuk akun terlebih dahulu.', 'info');
      this.openModal('login');
      return;
    }

    const backdrop = document.getElementById('profileModalBackdrop');
    if (!backdrop) return;

    const user = this.currentUser;
    const level = user.level || 1;
    const xp = user.xp || 0;
    
    // Accurate Level & EXP calculation
    let xpInLevel = 0;
    let xpPercent = 0;
    let xpNeeded = 0;
    let xpCounterText = '';
    let nextLevelHintText = '';

    if (level >= 99) {
      xpInLevel = 100;
      xpPercent = 100;
      xpNeeded = 0;
      xpCounterText = `MAX LEVEL (${xp.toLocaleString()} EXP)`;
      nextLevelHintText = 'Level Maksimal Tercapai!';
    } else {
      xpInLevel = xp % 100;
      xpPercent = Math.min(100, Math.round((xpInLevel / 100) * 100));
      xpNeeded = 100 - xpInLevel;
      xpCounterText = `${xpInLevel} / 100 EXP (Total: ${xp} EXP)`;
      nextLevelHintText = `${xpNeeded} EXP lagi menuju Level ${level + 1}`;
    }

    const rankTitle = this.getRankTitle(level);

    // Header info
    const modalAvatar = document.getElementById('profileModalAvatar');
    if (modalAvatar) {
      modalAvatar.src = user.avatar || '/images/nekumi-logo.png';
      modalAvatar.onerror = () => { modalAvatar.src = '/images/nekumi-logo.png'; };
      modalAvatar.classList.toggle('is-admin', user.role === 'admin');
    }
    const levelBadge = document.getElementById('profileModalLevelBadge');
    if (levelBadge) levelBadge.textContent = `Lv. ${level}`;

    const nameElem = document.getElementById('profileModalName');
    if (nameElem) nameElem.textContent = user.username;

    const rankElem = document.getElementById('profileModalRank');
    if (rankElem) rankElem.textContent = rankTitle;

    const emailElem = document.getElementById('profileModalEmail');
    if (emailElem) emailElem.textContent = user.email;

    // Level widget
    const xpCounterElem = document.getElementById('profileModalXpCounter');
    if (xpCounterElem) xpCounterElem.textContent = xpCounterText;

    const xpFillElem = document.getElementById('profileModalXpFill');
    if (xpFillElem) xpFillElem.style.width = `${xpPercent}%`;

    const nextHintElem = document.getElementById('profileModalNextLevelHint');
    if (nextHintElem) nextHintElem.textContent = nextLevelHintText;

    // Stats
    const epsWatched = document.getElementById('profileModalEpsWatched');
    if (epsWatched) epsWatched.textContent = user.episodes_watched || 0;

    const watchMins = document.getElementById('profileModalWatchMins');
    if (watchMins) watchMins.textContent = `${Math.round(user.watch_minutes || 0)}m`;

    const roleElem = document.getElementById('profileModalRole');
    if (roleElem) roleElem.textContent = user.role.toUpperCase();

    // Form inputs
    const editUsername = document.getElementById('editProfileUsername');
    if (editUsername) editUsername.value = user.username;

    const editCustomAvatar = document.getElementById('editProfileCustomAvatar');
    if (editCustomAvatar) editCustomAvatar.value = user.avatar?.startsWith('http') ? user.avatar : '';

    this.selectedAvatarPreset = user.avatar || '';

    // Render Avatar Presets
    const presetsGrid = document.getElementById('avatarPresetsGrid');
    if (presetsGrid) {
      presetsGrid.innerHTML = this.avatarPresets.map(p => `
        <button type="button" class="avatar-preset-btn ${user.avatar === p.url ? 'active' : ''}" data-url="${p.url}" title="${p.name}">
          <img src="${p.url}" alt="${p.name}">
        </button>
      `).join('');

      presetsGrid.querySelectorAll('.avatar-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          presetsGrid.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.selectedAvatarPreset = btn.getAttribute('data-url');
          if (editCustomAvatar) editCustomAvatar.value = '';
          if (modalAvatar) modalAvatar.src = this.selectedAvatarPreset;
        });
      });
    }

    backdrop.classList.add('show');
  },

  closeProfileModal() {
    const backdrop = document.getElementById('profileModalBackdrop');
    if (backdrop) backdrop.classList.remove('show');
  },

  async fetchCaptcha(type = 'reg') {
    try {
      const res = await fetch('/api/auth/captcha');
      const data = await res.json();
      if (data && data.success) {
        if (type === 'reg') {
          this.currentRegCaptchaId = data.id;
          const preview = document.getElementById('regCaptchaPreview');
          if (preview) preview.innerHTML = data.svg;
          const input = document.getElementById('regCaptchaInput');
          if (input) input.value = '';
        } else {
          this.currentForgotCaptchaId = data.id;
          const preview = document.getElementById('forgotCaptchaPreview');
          if (preview) preview.innerHTML = data.svg;
          const input = document.getElementById('forgotCaptchaInput');
          if (input) input.value = '';
        }
      }
    } catch (err) {
      console.warn('Gagal memuat CAPTCHA:', err);
    }
  },

  async saveProfile(newUsername, newAvatar) {
    const token = this.getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          username: newUsername,
          avatar: newAvatar
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Gagal memperbarui profil.');
      }

      this.currentUser = data.user;
      localStorage.setItem(this.userKey, JSON.stringify(data.user));
      this.updateUI();
      this.closeProfileModal();
      showToast('Profil & Avatar berhasil disimpan ke database!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  // Called when user streams an episode to dynamically update level
  updateStreamLevel(stats) {
    if (!stats || !this.currentUser) return;
    this.currentUser.level = stats.level;
    this.currentUser.xp = stats.xp;
    this.currentUser.episodes_watched = (this.currentUser.episodes_watched || 0) + 1;
    localStorage.setItem(this.userKey, JSON.stringify(this.currentUser));
    this.updateUI();

    if (stats.leveledUp) {
      const rank = this.getRankTitle(stats.level);
      showToast(`🎉 LEVEL UP! Kamu naik ke Level ${stats.level} (${rank})!`, 'success');
    }
  },

  openModal(tab = 'login') {
    const backdrop = document.getElementById('authModalBackdrop');
    if (backdrop) {
      backdrop.classList.add('show');
      this.switchTab(tab);
    }
  },

  closeModal() {
    const backdrop = document.getElementById('authModalBackdrop');
    if (backdrop) backdrop.classList.remove('show');
  },

  switchTab(tab) {
    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const forgotForm = document.getElementById('forgotPasswordForm');

    tabLoginBtn?.classList.remove('active');
    tabRegisterBtn?.classList.remove('active');
    loginForm?.classList.add('hidden');
    registerForm?.classList.add('hidden');
    forgotForm?.classList.add('hidden');

    if (tab === 'login') {
      tabLoginBtn?.classList.add('active');
      loginForm?.classList.remove('hidden');
    } else if (tab === 'register') {
      tabRegisterBtn?.classList.add('active');
      registerForm?.classList.remove('hidden');
      this.fetchCaptcha('reg');
    } else if (tab === 'forgot') {
      forgotForm?.classList.remove('hidden');
      this.fetchCaptcha('forgot');
    }
  },

  setupEventListeners() {
    // Buttons to open modal
    document.getElementById('openLoginBtn')?.addEventListener('click', () => this.openModal('login'));
    document.getElementById('openRegisterBtn')?.addEventListener('click', () => this.openModal('register'));
    document.getElementById('closeAuthModalBtn')?.addEventListener('click', () => this.closeModal());
    
    // Tab toggles
    document.getElementById('tabLoginBtn')?.addEventListener('click', () => this.switchTab('login'));
    document.getElementById('tabRegisterBtn')?.addEventListener('click', () => this.switchTab('register'));
    document.getElementById('switchToRegisterLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('register');
    });
    document.getElementById('switchToLoginLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('login');
    });

    // Forgot password links
    document.getElementById('openForgotPasswordLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('forgot');
      const loginVal = (document.getElementById('loginIdentifier')?.value || '').trim();
      if (loginVal && loginVal.includes('@')) {
        const forgotEmail = document.getElementById('forgotEmail');
        if (forgotEmail) forgotEmail.value = loginVal;
      }
    });

    document.getElementById('backToLoginFromForgot')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.switchTab('login');
    });

    // Close on backdrop click
    document.getElementById('authModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'authModalBackdrop') this.closeModal();
    });

    // User Dropdown toggle
    const toggleBtn = document.getElementById('userMenuToggle');
    const dropdownMenu = document.getElementById('userDropdownMenu');
    if (toggleBtn && dropdownMenu) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('show');
      });
      document.addEventListener('click', () => dropdownMenu.classList.remove('show'));
    }

    // Profile Modal Open & Close
    document.getElementById('menuItemProfile')?.addEventListener('click', () => {
      dropdownMenu?.classList.remove('show');
      this.openProfileModal();
    });
    document.getElementById('closeProfileModalBtn')?.addEventListener('click', () => this.closeProfileModal());
    document.getElementById('profileModalBackdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'profileModalBackdrop') this.closeProfileModal();
    });

    // Preview Custom Avatar in Real-time
    const previewBtn = document.getElementById('btnPreviewCustomAvatar');
    const customAvatarInput = document.getElementById('editProfileCustomAvatar');
    const modalAvatar = document.getElementById('profileModalAvatar');

    const handleAvatarPreview = () => {
      const url = customAvatarInput?.value.trim();
      if (url && modalAvatar) {
        modalAvatar.src = url;
        const presetsGrid = document.getElementById('avatarPresetsGrid');
        presetsGrid?.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('active'));
        this.selectedAvatarPreset = '';
      }
    };

    previewBtn?.addEventListener('click', handleAvatarPreview);
    customAvatarInput?.addEventListener('input', handleAvatarPreview);

    // Profile Form Submit (Save to DB)
    document.getElementById('editProfileForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = (document.getElementById('editProfileUsername')?.value || '').trim();
      const customAvatar = (document.getElementById('editProfileCustomAvatar')?.value || '').trim();
      const finalAvatar = customAvatar || this.selectedAvatarPreset || this.currentUser?.avatar || '/images/nekumi-logo.png';
      
      if (!username) {
        showToast('Nama pengguna tidak boleh kosong.', 'error');
        return;
      }
      this.saveProfile(username, finalAvatar);
    });

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());

    // Login Form Submit (with client-side validation)
    document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const loginVal = (document.getElementById('loginIdentifier')?.value || '').trim();
      const passVal = document.getElementById('loginPassword')?.value || '';

      if (!loginVal || !passVal) {
        showToast('Username/Email dan Password wajib diisi.', 'error');
        return;
      }
      if (loginVal.length < 2 || loginVal.length > 100) {
        showToast('Panjang Username atau Email tidak valid.', 'error');
        return;
      }
      await this.login(loginVal, passVal);
    });

    // CAPTCHA Refresh listeners
    document.getElementById('regRefreshCaptchaBtn')?.addEventListener('click', () => this.fetchCaptcha('reg'));
    document.getElementById('regCaptchaPreview')?.addEventListener('click', () => this.fetchCaptcha('reg'));
    document.getElementById('forgotRefreshCaptchaBtn')?.addEventListener('click', () => this.fetchCaptcha('forgot'));
    document.getElementById('forgotCaptchaPreview')?.addEventListener('click', () => this.fetchCaptcha('forgot'));

    // Register Form Submit (with CAPTCHA)
    document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = (document.getElementById('regUsername')?.value || '').trim();
      const email = (document.getElementById('regEmail')?.value || '').trim().toLowerCase();
      const pass = document.getElementById('regPassword')?.value || '';
      const captchaCode = (document.getElementById('regCaptchaInput')?.value || '').trim();

      const usernameRegex = /^[a-zA-Z0-9_]{3,25}$/;
      if (!usernameRegex.test(username)) {
        showToast('Username hanya boleh 3-25 karakter alfanumerik dan garis bawah (_).', 'error');
        return;
      }

      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email) || email.length > 100) {
        showToast('Format email tidak valid.', 'error');
        return;
      }

      if (pass.length < 6 || pass.length > 100) {
        showToast('Password minimal 6 dan maksimal 100 karakter.', 'error');
        return;
      }

      if (!captchaCode) {
        showToast('Silakan masukkan 5 karakter kode CAPTCHA keamanan.', 'error');
        return;
      }

      await this.register(username, email, pass, this.currentRegCaptchaId, captchaCode);
    });

    // Reset Password Form Submit (with CAPTCHA)
    document.getElementById('forgotPasswordForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (document.getElementById('forgotEmail')?.value || '').trim().toLowerCase();
      const newPassword = document.getElementById('forgotNewPassword')?.value || '';
      const captchaCode = (document.getElementById('forgotCaptchaInput')?.value || '').trim();

      if (!email || !newPassword || !captchaCode) {
        showToast('Harap lengkapi email, password baru, dan kode CAPTCHA.', 'error');
        return;
      }
      if (newPassword.length < 6 || newPassword.length > 100) {
        showToast('Password baru minimal 6 dan maksimal 100 karakter.', 'error');
        return;
      }

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            new_password: newPassword,
            captcha_id: this.currentForgotCaptchaId,
            captcha_code: captchaCode
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          this.fetchCaptcha('forgot');
          throw new Error(data.message || 'Gagal mereset password.');
        }

        showToast(data.message, 'success');
        this.switchTab('login');
        const loginIdent = document.getElementById('loginIdentifier');
        if (loginIdent) loginIdent.value = email;
        const loginPass = document.getElementById('loginPassword');
        if (loginPass) loginPass.value = '';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
};

// Global Toast System
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

window.Auth = Auth;
window.showToast = showToast;
document.addEventListener('DOMContentLoaded', () => Auth.init());
