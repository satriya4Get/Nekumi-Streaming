/**
 * AniNonton - Admin Panel Controller
 */

const Admin = {
  init() {
    this.setupEventListeners();
  },

  setupEventListeners() {
    // Admin Tabs Switcher
    const tabBtns = document.querySelectorAll('.admin-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-admintab');
        this.switchTab(tab);
      });
    });

    // Refresh Stats Button
    document.getElementById('adminRefreshStatsBtn')?.addEventListener('click', () => {
      this.loadDashboard();
      showToast('Data dashboard disegarkan.', 'info');
    });

    // Clear Cache Button
    document.getElementById('adminClearCacheBtn')?.addEventListener('click', async () => {
      if (!confirm('Bersihkan seluruh cache API? Ini akan memaksa sistem memuat data katalog anime terbaru.')) return;
      await this.clearCache();
    });

    // Add Stream Form Submit
    document.getElementById('addStreamForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleAddStream();
    });

    // Add Announcement Form Submit
    document.getElementById('addAnnouncementForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleAddAnnouncement();
    });
  },

  switchTab(tab) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      if (btn.getAttribute('data-admintab') === tab) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    document.querySelectorAll('.admin-tab-pane').forEach(pane => {
      if (pane.id === `admintab-${tab}`) pane.classList.add('active');
      else pane.classList.remove('active');
    });

    if (tab === 'users') this.loadUsers();
    if (tab === 'streams') this.loadStreams();
    if (tab === 'announcements') this.loadAnnouncements();
  },

  async loadDashboard() {
    if (!window.Auth?.isAdmin()) {
      showToast('Akses ditolak. Anda bukan admin.', 'error');
      window.location.hash = '';
      return;
    }

    const token = window.Auth.getToken();
    try {
      // 1. Fetch Stats
      const res = await fetch('/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.stats) {
        document.getElementById('statUsersCount').textContent = data.stats.users;
        document.getElementById('statHistoryCount').textContent = data.stats.history;
        document.getElementById('statBookmarksCount').textContent = data.stats.bookmarks;
        document.getElementById('statStreamsCount').textContent = data.stats.customStreams;
        document.getElementById('statCommentsCount').textContent = data.stats.comments;
      }

      // Load active tab data
      this.loadUsers();
      this.loadStreams();
      this.loadAnnouncements();

    } catch (err) {
      console.error('Error loading admin dashboard:', err);
      showToast(err.message, 'error');
    }
  },

  async loadUsers() {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;
    const token = window.Auth.getToken();

    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.data) {
        tbody.innerHTML = data.data.map(u => {
          const isCurrent = u.id === window.Auth.currentUser.id;
          const dateStr = new Date(u.created_at).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric'
          });

          return `
            <tr>
              <td>#${u.id}</td>
              <td>
                <div class="table-user-cell">
                  <img src="${u.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + u.username}" alt="${u.username}" class="table-user-avatar">
                  <strong>${u.username}</strong>
                  ${isCurrent ? '<small class="text-accent">(Anda)</small>' : ''}
                </div>
              </td>
              <td>${u.email}</td>
              <td>
                <span class="role-tag ${u.role === 'admin' ? 'admin' : ''}">${u.role.toUpperCase()}</span>
              </td>
              <td>${dateStr}</td>
              <td>
                <div style="display:flex; gap:6px;">
                  ${u.role === 'admin' ? `
                    <button class="btn btn-xs btn-outline" onclick="Admin.changeRole(${u.id}, 'user')" ${isCurrent ? 'disabled' : ''}>
                      Ubah ke User
                    </button>
                  ` : `
                    <button class="btn btn-xs btn-gold" onclick="Admin.changeRole(${u.id}, 'admin')">
                      Jadikan Admin
                    </button>
                  `}
                  ${!isCurrent ? `
                    <button class="btn btn-xs btn-outline-danger" onclick="Admin.deleteUser(${u.id}, '${u.username}')">
                      Hapus
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-danger">${err.message}</td></tr>`;
    }
  },

  async changeRole(userId, newRole) {
    if (!confirm(`Ubah role pengguna ini menjadi "${newRole}"?`)) return;
    const token = window.Auth.getToken();

    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role: newRole })
      });
      const data = await res.json();

      if (data.success) {
        showToast(data.message, 'success');
        this.loadUsers();
      } else {
        throw new Error(data.message);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async deleteUser(userId, username) {
    if (!confirm(`PERINGATAN: Hapus akun pengguna "${username}" secara permanen? Seluruh riwayat dan favorit miliknya akan terhapus.`)) return;
    const token = window.Auth.getToken();

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success) {
        showToast(data.message, 'success');
        this.loadUsers();
      } else {
        throw new Error(data.message);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async handleAddStream() {
    const anime_id = document.getElementById('streamAnimeId').value;
    const episode_num = document.getElementById('streamEpisodeNum').value;
    const server_name = document.getElementById('streamServerName').value;
    const stream_type = document.getElementById('streamType').value;
    const video_url = document.getElementById('streamVideoUrl').value;
    const quality = document.getElementById('streamQuality').value;

    const token = window.Auth.getToken();
    try {
      const res = await fetch('/api/admin/streams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ anime_id, episode_num, server_name, stream_type, video_url, quality })
      });
      const data = await res.json();

      if (data.success) {
        showToast(data.message, 'success');
        document.getElementById('addStreamForm').reset();
        this.loadStreams();
      } else {
        throw new Error(data.message);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async loadStreams() {
    const tbody = document.getElementById('adminStreamsTableBody');
    if (!tbody) return;
    const token = window.Auth.getToken();

    try {
      const res = await fetch('/api/admin/streams', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.data) {
        if (data.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center">Belum ada server kustom yang ditambahkan.</td></tr>';
          return;
        }

        tbody.innerHTML = data.data.map(s => `
          <tr>
            <td><strong>#${s.anime_id}</strong></td>
            <td>Ep ${s.episode_num}</td>
            <td>${s.server_name} <small class="text-dim">(${s.quality})</small></td>
            <td><span class="badge badge-glass">${s.stream_type.toUpperCase()}</span></td>
            <td>
              <button class="btn btn-xs btn-outline-danger" onclick="Admin.deleteStream(${s.id})">
                Hapus
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${err.message}</td></tr>`;
    }
  },

  async deleteStream(streamId) {
    if (!confirm('Hapus server streaming ini?')) return;
    const token = window.Auth.getToken();

    try {
      const res = await fetch(`/api/admin/streams/${streamId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        this.loadStreams();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async handleAddAnnouncement() {
    const title = document.getElementById('announcementTitleInput').value;
    const content = document.getElementById('announcementContentInput').value;
    const type = document.getElementById('announcementTypeInput').value;
    const is_active = document.getElementById('announcementActiveInput').checked;

    const token = window.Auth.getToken();
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title, content, type, is_active })
      });
      const data = await res.json();

      if (data.success) {
        showToast(data.message, 'success');
        document.getElementById('addAnnouncementForm').reset();
        this.loadAnnouncements();
        // Update top banner immediately
        if (window.App) App.loadAnnouncement();
      } else {
        throw new Error(data.message);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async loadAnnouncements() {
    const tbody = document.getElementById('adminAnnouncementsTableBody');
    if (!tbody) return;
    const token = window.Auth.getToken();

    try {
      const res = await fetch('/api/admin/announcements', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.data) {
        if (data.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">Belum ada riwayat pengumuman.</td></tr>';
          return;
        }

        tbody.innerHTML = data.data.map(a => `
          <tr>
            <td><strong>${a.title}</strong><br><small class="text-dim">${a.content.substring(0, 60)}...</small></td>
            <td><span class="badge badge-accent">${a.type.toUpperCase()}</span></td>
            <td>${a.is_active ? '<span class="text-success font-bold">● Aktif</span>' : '<span class="text-dim">Nonaktif</span>'}</td>
            <td>
              <button class="btn btn-xs btn-outline-danger" onclick="Admin.deleteAnnouncement(${a.id})">
                Hapus
              </button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-danger">${err.message}</td></tr>`;
    }
  },

  async deleteAnnouncement(annId) {
    if (!confirm('Hapus pengumuman ini?')) return;
    const token = window.Auth.getToken();

    try {
      const res = await fetch(`/api/admin/announcements/${annId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        this.loadAnnouncements();
        if (window.App) App.loadAnnouncement();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async clearCache() {
    const token = window.Auth.getToken();
    try {
      const res = await fetch('/api/admin/clear-cache', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
};

window.Admin = Admin;
document.addEventListener('DOMContentLoaded', () => Admin.init());
