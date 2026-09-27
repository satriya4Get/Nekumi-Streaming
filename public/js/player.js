/**
 * AniNonton - Video Player & Streaming Engine
 */

const Player = {
  currentAnime: null,
  currentEpisode: 1,
  availableServers: [],
  currentServerIndex: 0,
  hlsInstance: null,
  progressInterval: null,

  init() {
    this.setupEventListeners();
  },

  setupEventListeners() {
    const prevBtn = document.getElementById('prevEpisodeBtn');
    const nextBtn = document.getElementById('nextEpisodeBtn');
    const autoNextToggle = document.getElementById('autoNextToggle');
    const theaterToggle = document.getElementById('theaterLightToggle');
    const watchBackBtn = document.getElementById('watchBackBtn');
    const episodeSearch = document.getElementById('episodeSearchInput');
    const submitComment = document.getElementById('submitCommentBtn');
    const retryBtn = document.getElementById('retryServerBtn');
    const html5Video = document.getElementById('html5VideoPlayer');

    prevBtn?.addEventListener('click', () => this.changeEpisode(this.currentEpisode - 1));
    nextBtn?.addEventListener('click', () => this.changeEpisode(this.currentEpisode + 1));
    watchBackBtn?.addEventListener('click', () => {
      window.location.hash = '';
      this.cleanup();
    });

    theaterToggle?.addEventListener('change', (e) => {
      if (e.target.checked) {
        document.body.classList.add('theater-mode');
      } else {
        document.body.classList.remove('theater-mode');
      }
    });

    retryBtn?.addEventListener('click', () => {
      if (this.availableServers.length > 1) {
        const nextIdx = (this.currentServerIndex + 1) % this.availableServers.length;
        this.selectServer(nextIdx);
      }
    });

    // Episode search filter
    episodeSearch?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const btns = document.querySelectorAll('#episodesButtonsGrid .ep-btn');
      btns.forEach(b => {
        const epNum = b.getAttribute('data-ep');
        if (!q || epNum.includes(q)) {
          b.style.display = 'flex';
        } else {
          b.style.display = 'none';
        }
      });
    });

    // Submit comment
    submitComment?.addEventListener('click', () => this.postComment());

    // HTML5 video events
    if (html5Video) {
      html5Video.addEventListener('ended', () => {
        const autoNext = document.getElementById('autoNextToggle')?.checked;
        if (autoNext) {
          showToast('Episode selesai. Memutar episode berikutnya...', 'info');
          setTimeout(() => this.changeEpisode(this.currentEpisode + 1), 1500);
        }
      });

      html5Video.addEventListener('timeupdate', () => {
        // Save progress every 15 seconds
        if (html5Video.duration && html5Video.currentTime > 0) {
          const now = Date.now();
          if (!this.lastSyncTime || now - this.lastSyncTime > 12000) {
            this.lastSyncTime = now;
            this.saveWatchProgress(html5Video.currentTime, html5Video.duration);
          }
        }
      });
    }
  },

  async loadAnime(animeId, episode = 1) {
    this.currentEpisode = parseInt(episode) || 1;
    this.showLoader(true);

    try {
      const isOtakudesu = isNaN(parseInt(animeId)) || String(animeId).startsWith('otaku_');

      if (isOtakudesu) {
        // Otakudesu Direct Anime
        const slug = String(animeId).replace(/^otaku_/, '');
        const res = await fetch(`/api/otakudesu/anime/${slug}`);
        const data = await res.json();
        if (!data.success || !data.data) {
          throw new Error('Data anime Otakudesu tidak ditemukan.');
        }

        const d = data.data;
        this.currentAnime = {
          mal_id: `otaku_${slug}`,
          title: d.title,
          title_japanese: d.japanese,
          score: d.score,
          status: d.status,
          type: d.type,
          episodes: d.episodes?.length || 24,
          synopsis: d.synopsis,
          images: { webp: { large_image_url: d.poster, image_url: d.poster } },
          genres: d.genres?.map(g => ({ name: g })),
          otakudesuEpisodes: d.episodes || []
        };

        this.renderAnimeMeta();
        this.renderEpisodesGrid();
        this.loadComments();

        // Load stream for target episode
        const targetEpObj = d.episodes?.find(e => e.num === this.currentEpisode) || d.episodes?.[d.episodes.length - 1];
        if (targetEpObj && targetEpObj.slug) {
          await this.loadOtakudesuEpisodeStream(targetEpObj.slug);
        } else {
          await this.loadStreamServers(animeId, this.currentEpisode);
        }

      } else {
        // Standard Anime (MAL Catalog + Otakudesu Stream Resolution)
        const res = await fetch(`/api/anime/${animeId}`);
        const data = await res.json();
        if (!data.success || !data.data) {
          throw new Error('Data anime tidak ditemukan.');
        }

        this.currentAnime = data.data;
        this.renderAnimeMeta();
        this.renderEpisodesGrid();
        this.loadComments();

        // Fetch Stream Sources with title parameter for Otakudesu matching
        await this.loadStreamServers(animeId, this.currentEpisode);
      }

      // Mark History
      this.saveWatchProgress(10, 1440);

      // Update URL hash without reload
      window.location.hash = `#watch/${animeId}/${this.currentEpisode}`;
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
      console.error('Error loading anime stream:', err);
      showToast(err.message, 'error');
    } finally {
      this.showLoader(false);
    }
  },

  async loadOtakudesuEpisodeStream(epSlug) {
    const listContainer = document.getElementById('serverListContainer');
    if (!listContainer) return;
    listContainer.innerHTML = '<span class="text-dim">Mencari server Otakudesu terbaik...</span>';

    try {
      const res = await fetch(`/api/otakudesu/episode/${epSlug}`);
      const data = await res.json();

      if (data.success && data.data && data.data.servers && data.data.servers.length > 0) {
        this.availableServers = data.data.servers;

        // Add fallback backup embed
        this.availableServers.push({
          id: 'demo_mp4',
          name: '🎬 Server Direct MP4 Backup',
          type: 'mp4',
          url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
        });

        this.renderServerButtons();
        this.selectServer(0);
      } else {
        throw new Error('Tidak ada stream yang ditemukan pada episode ini.');
      }
    } catch (err) {
      listContainer.innerHTML = `<span class="text-danger">${err.message}</span>`;
    }
  },

  renderAnimeMeta() {
    const a = this.currentAnime;
    if (!a) return;

    // Breadcrumbs
    const bTitle = document.getElementById('watchBreadcrumbTitle');
    const bEp = document.getElementById('watchBreadcrumbEp');
    if (bTitle) bTitle.textContent = a.title || 'Anime';
    if (bEp) bEp.textContent = `Episode ${this.currentEpisode}`;

    // Meta below player
    const poster = document.getElementById('watchAnimePoster');
    const title = document.getElementById('watchAnimeTitle');
    const altTitle = document.getElementById('watchAnimeAltTitle');
    const status = document.getElementById('watchAnimeStatus');
    const score = document.getElementById('watchAnimeScore');
    const year = document.getElementById('watchAnimeYear');
    const totalEp = document.getElementById('watchAnimeEpisodesTotal');
    const synopsis = document.getElementById('watchAnimeSynopsis');
    const genres = document.getElementById('watchAnimeGenres');
    const curBadge = document.getElementById('currentEpBadge');

    if (poster) {
      const rawPoster = a.images?.webp?.large_image_url || a.images?.jpg?.large_image_url || a.images?.webp?.image_url || a.poster || '';
      poster.src = window.getProxiedImageUrl ? window.getProxiedImageUrl(rawPoster) : rawPoster;
      poster.onerror = () => { poster.onerror = null; poster.src = '/images/nekumi-logo.png'; };
    }
    if (title) title.textContent = a.title || '';
    if (altTitle) altTitle.textContent = a.title_japanese || a.title_english || '';
    if (status) status.textContent = a.status || 'Ongoing';
    if (score) score.textContent = `⭐ ${a.score || 'N/A'}`;
    if (year) year.textContent = a.year || (a.aired?.string ? a.aired.string.split(',')[1]?.trim() : '2026');
    if (totalEp) totalEp.textContent = `Total: ${a.episodes ? a.episodes + ' Ep' : '? Ep'}`;
    if (synopsis) synopsis.textContent = a.synopsis || 'Tidak ada ringkasan sinopsis.';
    if (curBadge) curBadge.textContent = `Episode ${this.currentEpisode}`;

    if (genres && a.genres) {
      genres.innerHTML = a.genres.map(g => `<span class="meta-genre-tag">${g.name}</span>`).join('');
    }

    // Prev / Next button states
    const prevBtn = document.getElementById('prevEpisodeBtn');
    if (prevBtn) prevBtn.disabled = this.currentEpisode <= 1;

    const nextBtn = document.getElementById('nextEpisodeBtn');
    if (nextBtn) {
      if (a.episodes && this.currentEpisode >= a.episodes) {
        nextBtn.disabled = true;
      } else {
        nextBtn.disabled = false;
      }
    }
  },

  renderEpisodesGrid() {
    const container = document.getElementById('episodesButtonsGrid');
    const pill = document.getElementById('episodesTotalPill');
    if (!container) return;

    container.innerHTML = '';

    if (this.currentAnime.otakudesuEpisodes && this.currentAnime.otakudesuEpisodes.length > 0) {
      // Otakudesu episodes list
      const eps = this.currentAnime.otakudesuEpisodes;
      if (pill) pill.textContent = `${eps.length} Ep`;

      eps.forEach(epObj => {
        const btn = document.createElement('button');
        btn.className = `ep-btn ${epObj.num === this.currentEpisode ? 'active' : ''}`;
        btn.setAttribute('data-ep', epObj.num);
        btn.textContent = `Ep ${epObj.num}`;
        btn.addEventListener('click', () => {
          this.currentEpisode = epObj.num;
          this.renderAnimeMeta();
          this.renderEpisodesGrid();
          this.loadOtakudesuEpisodeStream(epObj.slug);
          window.location.hash = `#watch/${this.currentAnime.mal_id}/${epObj.num}`;
        });
        container.appendChild(btn);
      });

    } else {
      // General episodes grid
      const total = this.currentAnime.episodes || 24;
      if (pill) pill.textContent = `${total} Ep`;

      for (let i = 1; i <= total; i++) {
        const btn = document.createElement('button');
        btn.className = `ep-btn ${i === this.currentEpisode ? 'active' : ''}`;
        btn.setAttribute('data-ep', i);
        btn.textContent = `Ep ${i}`;
        btn.addEventListener('click', () => this.changeEpisode(i));
        container.appendChild(btn);
      }
    }
  },

  async loadStreamServers(animeId, episode) {
    const listContainer = document.getElementById('serverListContainer');
    if (!listContainer) return;
    listContainer.innerHTML = '<span class="text-dim">Mencari server streaming Otakudesu & VIP...</span>';

    try {
      const titleParam = this.currentAnime?.title ? `?title=${encodeURIComponent(this.currentAnime.title)}` : '';
      const res = await fetch(`/api/anime/${animeId}/streams/${episode}${titleParam}`);
      const data = await res.json();

      if (data.success && data.servers && data.servers.length > 0) {
        this.availableServers = data.servers;
        this.renderServerButtons();
        // Play first server by default
        this.selectServer(0);
      } else {
        throw new Error('Tidak ada server yang tersedia untuk episode ini.');
      }
    } catch (err) {
      listContainer.innerHTML = `<span class="text-danger">${err.message}</span>`;
    }
  },

  renderServerButtons() {
    const container = document.getElementById('serverListContainer');
    if (!container) return;
    container.innerHTML = '';

    this.availableServers.forEach((srv, idx) => {
      const btn = document.createElement('button');
      btn.className = `server-btn ${idx === this.currentServerIndex ? 'active' : ''}`;
      btn.textContent = srv.name;
      btn.addEventListener('click', () => this.selectServer(idx));
      container.appendChild(btn);
    });
  },

  selectServer(index) {
    this.currentServerIndex = index;
    const server = this.availableServers[index];
    if (!server) return;

    // Update active button state
    const btns = document.querySelectorAll('#serverListContainer .server-btn');
    btns.forEach((b, i) => {
      if (i === index) b.classList.add('active');
      else b.classList.remove('active');
    });

    const iframe = document.getElementById('embedPlayerFrame');
    const html5Container = document.getElementById('html5PlayerContainer');
    const html5Video = document.getElementById('html5VideoPlayer');
    const errorOverlay = document.getElementById('playerErrorOverlay');

    if (errorOverlay) errorOverlay.classList.add('hidden');

    // Clean up existing HLS stream if any
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }

    if (server.type === 'embed' || server.type === 'iframe') {
      // IFRAME Embed Player
      if (html5Video) {
        html5Video.pause();
        html5Video.removeAttribute('src');
      }
      if (html5Container) html5Container.classList.add('hidden');

      if (iframe) {
        iframe.classList.remove('hidden');
        iframe.src = server.url;
      }
    } else if (server.type === 'hls') {
      // HLS (.m3u8) Stream
      if (iframe) {
        iframe.classList.add('hidden');
        iframe.src = '';
      }
      if (html5Container) html5Container.classList.remove('hidden');

      if (Hls.isSupported() && html5Video) {
        this.hlsInstance = new Hls({
          enableWorker: true,
          lowLatencyMode: true
        });
        this.hlsInstance.loadSource(server.url);
        this.hlsInstance.attachMedia(html5Video);
        this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          html5Video.play().catch(() => {});
        });
        this.hlsInstance.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.warn('HLS Fatal Error, fallback to next server:', data);
          }
        });
      } else if (html5Video && html5Video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Safari HLS
        html5Video.src = server.url;
        html5Video.play().catch(() => {});
      }
    } else {
      // MP4 Direct Stream
      if (iframe) {
        iframe.classList.add('hidden');
        iframe.src = '';
      }
      if (html5Container) html5Container.classList.remove('hidden');

      if (html5Video) {
        html5Video.src = server.url;
        html5Video.play().catch(() => {});
      }
    }
  },

  changeEpisode(newEp) {
    if (newEp < 1) return;
    if (this.currentAnime?.episodes && newEp > this.currentAnime.episodes) {
      showToast('Ini adalah episode terakhir yang tersedia.', 'info');
      return;
    }
    this.currentEpisode = newEp;
    this.renderAnimeMeta();
    this.renderEpisodesGrid();
    this.loadStreamServers(this.currentAnime.mal_id, newEp);
    this.saveWatchProgress(10, 1440);
    window.location.hash = `#watch/${this.currentAnime.mal_id}/${newEp}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async saveWatchProgress(currentTime, duration) {
    if (!this.currentAnime) return;
    const token = window.Auth?.getToken();
    const percentage = duration > 0 ? Math.min(100, Math.round((currentTime / duration) * 100)) : 5;

    // Save in LocalStorage for offline resilience
    const localHistory = JSON.parse(localStorage.getItem('aninonton_offline_history') || '[]');
    const existingIdx = localHistory.findIndex(h => h.anime_id === this.currentAnime.mal_id);
    const historyObj = {
      anime_id: this.currentAnime.mal_id,
      anime_title: this.currentAnime.title,
      anime_image: this.currentAnime.images?.webp?.image_url || this.currentAnime.images?.jpg?.image_url,
      episode_num: this.currentEpisode,
      episode_title: `Episode ${this.currentEpisode}`,
      progress_seconds: currentTime,
      duration_seconds: duration,
      percentage: percentage,
      updated_at: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      localHistory[existingIdx] = historyObj;
    } else {
      localHistory.unshift(historyObj);
    }
    localStorage.setItem('aninonton_offline_history', JSON.stringify(localHistory.slice(0, 30)));

    // If logged in, sync with SQLite backend
    if (token) {
      try {
        const res = await fetch('/api/history', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(historyObj)
        });
        const data = await res.json();
        if (data.success && data.stats && window.Auth && typeof window.Auth.updateStreamLevel === 'function') {
          window.Auth.updateStreamLevel(data.stats);
        }
      } catch (err) {
        console.warn('Could not sync history to server:', err.message);
      }
    }
  },

  async loadComments() {
    if (!this.currentAnime) return;
    const list = document.getElementById('commentsList');
    const badge = document.getElementById('commentsCountBadge');
    if (!list) return;

    try {
      const res = await fetch(`/api/comments/${this.currentAnime.mal_id}`);
      const data = await res.json();

      if (data.success && data.data) {
        if (badge) badge.textContent = `${data.data.length} Komentar`;

        if (data.data.length === 0) {
          list.innerHTML = '<p class="empty-comments">Belum ada komentar untuk anime ini. Berikan ulasan pertamamu!</p>';
          return;
        }

        list.innerHTML = data.data.map(c => {
          const isOwner = window.Auth?.currentUser?.id === c.user_id;
          const isAdmin = window.Auth?.isAdmin();
          const canDelete = isOwner || isAdmin;

          const avatar = c.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${c.username}`;
          const dateStr = new Date(c.created_at).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
          });

          return `
            <div class="comment-card" id="comment-${c.id}">
              <img src="${avatar}" alt="${c.username}" class="comment-avatar">
              <div class="comment-content">
                <div class="comment-author-bar">
                  <span class="comment-author-name">${c.username}</span>
                  ${c.role === 'admin' ? '<span class="role-tag admin">ADMIN</span>' : ''}
                  <span class="comment-time">&bull; Ep ${c.episode_num} &bull; ${dateStr}</span>
                  ${canDelete ? `<button class="delete-comment-btn" onclick="Player.deleteComment(${c.id})">Hapus</button>` : ''}
                </div>
                <p class="comment-text">${escapeHtml(c.comment_text)}</p>
              </div>
            </div>
          `;
        }).join('');
      }
    } catch (err) {
      console.warn('Error loading comments:', err.message);
    }
  },

  async postComment() {
    if (!window.Auth?.isLoggedIn()) {
      window.Auth.openModal('login');
      showToast('Silakan masuk akun terlebih dahulu untuk berkomentar.', 'info');
      return;
    }

    const input = document.getElementById('commentTextInput');
    const text = input?.value.trim();
    if (!text) {
      showToast('Tuliskan komentar terlebih dahulu.', 'error');
      return;
    }

    const token = window.Auth.getToken();
    try {
      const res = await fetch(`/api/comments/${this.currentAnime.mal_id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          comment_text: text,
          episode_num: this.currentEpisode
        })
      });
      const data = await res.json();

      if (data.success) {
        input.value = '';
        showToast('Komentar berhasil dikirim!', 'success');
        this.loadComments();
      } else {
        throw new Error(data.message || 'Gagal mengirim komentar.');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async deleteComment(commentId) {
    if (!confirm('Yakin ingin menghapus komentar ini?')) return;
    const token = window.Auth?.getToken();
    try {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Komentar telah dihapus.', 'info');
        this.loadComments();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  cleanup() {
    const iframe = document.getElementById('embedPlayerFrame');
    const html5Video = document.getElementById('html5VideoPlayer');
    if (iframe) iframe.src = '';
    if (html5Video) {
      html5Video.pause();
      html5Video.removeAttribute('src');
    }
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
  },

  showLoader(show) {
    const loader = document.getElementById('playerLoadingOverlay');
    if (loader) {
      if (show) loader.classList.remove('hidden');
      else loader.classList.add('hidden');
    }
  }
};

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

window.Player = Player;
document.addEventListener('DOMContentLoaded', () => Player.init());
