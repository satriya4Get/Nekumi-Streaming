/**
 * AniNonton - Main Application Controller & Router
 */

const App = {
  currentView: 'home',
  cachedAnime: {},
  latestPage: 1,
  popularPage: 1,
  currentGenre: null,
  genrePage: 1,
  featuredAnime: null,

  getImageUrl(url) {
    if (!url) return '/images/nekumi-logo.png';
    if (url.startsWith('/api/proxy-image') || url.startsWith('/images/')) return url;
    if (url.startsWith('data:')) return url;
    return `/api/proxy-image?url=${encodeURIComponent(url)}`;
  },

  init() {
    this.setupRouter();
    this.setupNavEvents();
    this.setupSearch();
    this.loadAnnouncement();
    this.loadHomeContent();

    // Check auth status & counters
    if (window.Auth?.isLoggedIn()) {
      this.loadUserHistory();
      this.loadUserBookmarks();
    } else {
      this.loadGuestHistory();
    }
  },

  // -----------------------------------------------------------
  // CLIENT ROUTER
  // -----------------------------------------------------------
  setupRouter() {
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute(); // Initial route
  },

  handleRoute() {
    const hash = window.location.hash.slice(1) || '';
    const parts = hash.split('/');
    const mainRoute = parts[0];

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (mainRoute.startsWith('watch')) {
      const animeId = parts[1];
      const ep = parts[2] || 1;
      this.switchView('watch');
      if (animeId) {
        window.Player?.loadAnime(animeId, ep);
      }
    } else if (mainRoute === 'latest') {
      this.switchView('latest');
      this.loadAllLatest();
    } else if (mainRoute === 'popular') {
      this.switchView('popular');
      this.loadAllPopular();
    } else if (mainRoute === 'genres') {
      this.switchView('genres');
      this.loadGenreBrowser();
    } else if (mainRoute === 'history') {
      if (!window.Auth?.isLoggedIn()) {
        showToast('Silakan masuk akun untuk melihat riwayat lengkap Anda.', 'info');
        window.Auth?.openModal('login');
      }
      this.switchView('history');
      this.renderFullHistoryPage();
    } else if (mainRoute === 'watchlist') {
      if (!window.Auth?.isLoggedIn()) {
        showToast('Silakan masuk akun untuk melihat daftar favorit Anda.', 'info');
        window.Auth?.openModal('login');
      }
      this.switchView('watchlist');
      this.renderFullWatchlistPage();
    } else if (mainRoute === 'admin') {
      if (!window.Auth?.isAdmin()) {
        showToast('Halaman ini khusus untuk Administrator.', 'error');
        window.location.hash = '';
        return;
      }
      this.switchView('admin');
      window.Admin?.loadDashboard();
    } else if (mainRoute === 'search') {
      const query = decodeURIComponent(parts[1] || '');
      this.switchView('search');
      this.performSearch(query);
    } else {
      this.switchView('home');
    }
  },

  switchView(viewName) {
    this.currentView = viewName;

    // Hide all views
    document.querySelectorAll('.view-section').forEach(section => {
      section.classList.remove('active');
    });

    // Show target view
    const target = document.getElementById(`view-${viewName}`);
    if (target) {
      target.classList.add('active');
    }

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
      const linkView = link.getAttribute('data-view');
      if (linkView === viewName) link.classList.add('active');
      else link.classList.remove('active');
    });

    // Close mobile drawer if open
    document.getElementById('mobileDrawer')?.classList.remove('show');
  },

  // -----------------------------------------------------------
  // NAVIGATION & UI EVENTS
  // -----------------------------------------------------------
  setupNavEvents() {
    // Logo Click -> Home
    document.getElementById('logoLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = '';
      if (this.currentView === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Mobile Drawer Toggle
    const mobileBtn = document.getElementById('mobileMenuBtn');
    const drawer = document.getElementById('mobileDrawer');
    mobileBtn?.addEventListener('click', () => {
      drawer?.classList.toggle('show');
    });

    // Close Announcement Banner
    document.getElementById('closeBannerBtn')?.addEventListener('click', () => {
      document.getElementById('announcementBanner')?.classList.add('hidden');
    });

    // Home Quick Genre Pills
    const homePills = document.querySelectorAll('#homeGenrePills .genre-pill');
    homePills.forEach(pill => {
      pill.addEventListener('click', () => {
        homePills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const genreId = pill.getAttribute('data-genre');
        if (genreId) {
          window.location.hash = `#genres`;
          setTimeout(() => this.selectGenre(genreId, pill.textContent), 100);
        }
      });
    });

    // Hero Carousel navigation
    document.getElementById('heroPrevBtn')?.addEventListener('click', () => this.prevHeroSlide());
    document.getElementById('heroNextBtn')?.addEventListener('click', () => this.nextHeroSlide());

    // Hero action buttons
    document.getElementById('heroWatchBtn')?.addEventListener('click', () => {
      if (this.featuredAnime) {
        window.location.hash = `#watch/${this.featuredAnime.mal_id}/1`;
      }
    });

    document.getElementById('heroDetailBtn')?.addEventListener('click', () => {
      if (this.featuredAnime) {
        window.location.hash = `#watch/${this.featuredAnime.mal_id}/1`;
      }
    });

    document.getElementById('heroBookmarkBtn')?.addEventListener('click', () => {
      if (this.featuredAnime) {
        this.toggleBookmark(this.featuredAnime);
      }
    });

    document.getElementById('watchBookmarkBtn')?.addEventListener('click', () => {
      if (window.Player?.currentAnime) {
        this.toggleBookmark(window.Player.currentAnime);
      }
    });

    // Clear History Button
    document.getElementById('clearAllHistoryBtn')?.addEventListener('click', async () => {
      if (!confirm('Yakin ingin menghapus seluruh riwayat nonton?')) return;
      await this.clearAllHistory();
    });

    // Pagination buttons for Latest
    document.getElementById('latestPrevPageBtn')?.addEventListener('click', () => {
      if (this.latestPage > 1) {
        this.latestPage--;
        this.loadAllLatest();
      }
    });
    document.getElementById('latestNextPageBtn')?.addEventListener('click', () => {
      this.latestPage++;
      this.loadAllLatest();
    });

    // Pagination buttons for Popular
    document.getElementById('popularPrevPageBtn')?.addEventListener('click', () => {
      if (this.popularPage > 1) {
        this.popularPage--;
        this.loadAllPopular();
      }
    });
    document.getElementById('popularNextPageBtn')?.addEventListener('click', () => {
      this.popularPage++;
      this.loadAllPopular();
    });

    // Pagination buttons for Genre
    document.getElementById('genrePrevBtn')?.addEventListener('click', () => {
      if (this.genrePage > 1) {
        this.genrePage--;
        this.fetchGenreAnime(this.currentGenre);
      }
    });
    document.getElementById('genreNextBtn')?.addEventListener('click', () => {
      this.genrePage++;
      this.fetchGenreAnime(this.currentGenre);
    });
  },

  // -----------------------------------------------------------
  // LIVE SEARCH & AUTOCOMPLETE
  // -----------------------------------------------------------
  setupSearch() {
    const input = document.getElementById('searchInput');
    const dropdown = document.getElementById('searchDropdown');
    const clearBtn = document.getElementById('clearSearchBtn');
    let searchTimeout = null;

    input?.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearBtn.style.display = q ? 'block' : 'none';

      clearTimeout(searchTimeout);
      if (q.length < 2) {
        dropdown.style.display = 'none';
        return;
      }

      searchTimeout = setTimeout(async () => {
        try {
          let items = [];

          // 1. Query Otakudesu Search (Fast & Sub Indo)
          try {
            const oRes = await fetch(`/api/otakudesu/search?q=${encodeURIComponent(q)}`);
            const oData = await oRes.json();
            if (oData.success && oData.data && oData.data.length > 0) {
              oData.data.slice(0, 4).forEach(o => {
                items.push({
                  id: `'otaku_${o.slug}'`,
                  title: o.title,
                  meta: `🇮🇩 Sub Indo Otakudesu &bull; ${o.status || 'Ongoing'} &bull; ⭐ ${o.rating || 'N/A'}`,
                  thumb: o.thumb
                });
              });
            }
          } catch (e) {}

          // 2. Query Standard Search
          try {
            const res = await fetch(`/api/anime/search?q=${encodeURIComponent(q)}&page=1`);
            const data = await res.json();
            if (data.success && data.data && data.data.length > 0) {
              data.data.slice(0, 3).forEach(a => {
                items.push({
                  id: a.mal_id,
                  title: a.title,
                  meta: `⭐ ${a.score || 'N/A'} &bull; ${a.type || 'TV'} &bull; ${a.episodes ? a.episodes + ' Ep' : '? Ep'}`,
                  thumb: a.images?.webp?.small_image_url || a.images?.jpg?.small_image_url
                });
              });
            }
          } catch (e) {}

          if (items.length > 0) {
            dropdown.innerHTML = items.slice(0, 6).map(it => `
              <div class="search-item" onclick="App.openWatchPage(${it.id})">
                <img src="${it.thumb}" alt="${it.title}" class="search-thumb">
                <div class="search-info">
                  <div class="search-title">${it.title}</div>
                  <div class="search-meta">${it.meta}</div>
                </div>
              </div>
            `).join('') + `
              <div class="search-item" style="justify-content:center; color:var(--accent-pink); font-weight:700;" onclick="App.goToSearchPage('${encodeURIComponent(q)}')">
                Lihat Semua Hasil untuk "${q}" &rarr;
              </div>
            `;
            dropdown.style.display = 'block';
          } else {
            dropdown.innerHTML = '<div class="search-item"><small class="text-dim">Tidak ada anime yang ditemukan.</small></div>';
            dropdown.style.display = 'block';
          }
        } catch (err) {
          console.warn('Search autocomplete error:', err);
        }
      }, 350);
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (q) {
          dropdown.style.display = 'none';
          this.goToSearchPage(q);
        }
      }
    });

    clearBtn?.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      dropdown.style.display = 'none';
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) {
        if (dropdown) dropdown.style.display = 'none';
      }
    });
  },

  goToSearchPage(query) {
    window.location.hash = `#search/${encodeURIComponent(query)}`;
  },

  async performSearch(query) {
    const qLabel = document.getElementById('searchQueryLabel');
    const desc = document.getElementById('searchCountDescription');
    const grid = document.getElementById('searchResultsGrid');
    if (qLabel) qLabel.textContent = query;
    if (grid) grid.innerHTML = '<div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div>';

    try {
      let combined = [];

      // 1. Search Otakudesu
      try {
        const oRes = await fetch(`/api/otakudesu/search?q=${encodeURIComponent(query)}`);
        const oData = await oRes.json();
        if (oData.success && oData.data) {
          combined = combined.concat(oData.data);
        }
      } catch (e) {}

      // 2. Search Catalog
      try {
        const res = await fetch(`/api/anime/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.success && data.data) {
          combined = combined.concat(data.data);
        }
      } catch (e) {}

      if (combined.length > 0) {
        if (desc) desc.textContent = `Ditemukan ${combined.length} judul anime yang cocok (Termasuk Sub Indo Otakudesu).`;
        grid.innerHTML = combined.map(a => this.renderAnimeCardHtml(a)).join('');
      } else {
        if (desc) desc.textContent = 'Tidak ditemukan hasil yang cocok.';
        grid.innerHTML = `
          <div class="empty-state-card">
            <div class="empty-state-icon">🔍</div>
            <h3>Anime Tidak Ditemukan</h3>
            <p>Coba gunakan kata kunci bahasa Indonesia atau judul lain.</p>
          </div>
        `;
      }
    } catch (err) {
      grid.innerHTML = `<div class="text-danger">${err.message}</div>`;
    }
  },

  // -----------------------------------------------------------
  // ANNOUNCEMENTS
  // -----------------------------------------------------------
  async loadAnnouncement() {
    try {
      const res = await fetch('/api/announcements/active');
      const data = await res.json();

      const banner = document.getElementById('announcementBanner');
      const text = document.getElementById('announcementText');
      const badge = document.getElementById('announcementBadge');

      if (data.success && data.data) {
        const ann = data.data;
        const typeLabels = { info: 'Pengumuman', alert: 'Penting', update: 'Pembaruan' };
        if (text) text.textContent = `${ann.title} — ${ann.content}`;
        if (badge) badge.textContent = typeLabels[ann.type.toLowerCase()] || ann.type;
        if (banner) banner.classList.remove('hidden');
      } else {
        if (banner) banner.classList.add('hidden');
      }
    } catch (err) {
      console.warn('Could not load announcement banner:', err);
    }
  },

  // -----------------------------------------------------------
  // HOME PAGE CONTENT
  // -----------------------------------------------------------
  async loadHomeContent() {
    this.loadHeroSpotlight();
    this.loadLatestAiring();
    this.loadPopularAnime();
    this.loadTopAiring();
  },

  heroSpotlightList: [],
  currentHeroIndex: 0,
  heroAutoTimer: null,

  async loadHeroSpotlight() {
    try {
      const res = await fetch('/api/anime/hero-spotlight');
      const data = await res.json();
      if (data.success && data.data && data.data.length > 0) {
        this.heroSpotlightList = data.data;
        this.currentHeroIndex = 0;
        this.renderHeroDots();
        this.showHeroSlide(0);

        if (this.heroAutoTimer) clearInterval(this.heroAutoTimer);
        this.heroAutoTimer = setInterval(() => this.nextHeroSlide(), 6000);
      }
    } catch (err) {
      console.warn('Error loading hero spotlight:', err);
    }
  },

  renderHeroDots() {
    const dotsContainer = document.getElementById('heroCarouselDots');
    if (!dotsContainer) return;
    dotsContainer.innerHTML = this.heroSpotlightList.map((_, i) => `
      <div class="hero-dot ${i === this.currentHeroIndex ? 'active' : ''}" onclick="App.showHeroSlide(${i})"></div>
    `).join('');
  },

  getImageUrl(url) {
    if (!url) return '/images/nekumi-logo.png';
    if (url.startsWith('/api/proxy-image') || url.startsWith('/images/')) return url;
    return `/api/proxy-image?url=${encodeURIComponent(url)}`;
  },

  showHeroSlide(index) {
    if (!this.heroSpotlightList || this.heroSpotlightList.length === 0) return;
    this.currentHeroIndex = (index + this.heroSpotlightList.length) % this.heroSpotlightList.length;
    const item = this.heroSpotlightList[this.currentHeroIndex];
    if (!item) return;

    const rawPoster = item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url || item.images?.webp?.image_url || item.images?.jpg?.image_url || item.poster || '';
    const posterUrl = this.getImageUrl(rawPoster);
    const rawBackdrop = item.banner_image || item.backdrop || rawPoster;
    const backdropUrl = this.getImageUrl(rawBackdrop);
    const genreNames = Array.isArray(item.genres)
      ? item.genres.map(g => (typeof g === 'object' && g !== null ? (g.name || '') : String(g))).filter(Boolean).join(' • ')
      : (item.genres || '');

    this.featuredAnime = {
      mal_id: item.mal_id || item.id,
      title: item.title,
      score: item.score,
      status: item.status || 'Tamat',
      type: item.type || 'TV Series',
      images: item.images || { webp: { image_url: posterUrl } }
    };

    const backdrop = document.getElementById('heroBackdrop');
    const poster = document.getElementById('heroPoster');
    const badge = document.getElementById('heroBadge');
    const score = document.getElementById('heroScore');
    const status = document.getElementById('heroStatus');
    const type = document.getElementById('heroType');
    const title = document.getElementById('heroTitle');
    const genres = document.getElementById('heroGenres');
    const synopsis = document.getElementById('heroSynopsis');

    if (backdrop) backdrop.style.backgroundImage = `url('${backdropUrl}')`;
    if (poster) {
      poster.src = posterUrl;
      poster.alt = item.title;
    }
    if (badge) badge.textContent = item.badge || 'POPULER';
    if (score) score.textContent = `⭐ ${item.score}`;
    if (status) status.textContent = item.status || 'Tamat';
    if (type) type.textContent = item.type || (item.episodes ? `${item.episodes} Episode` : 'TV Series');
    if (title) title.textContent = item.title;
    if (genres) genres.textContent = genreNames;
    if (synopsis) synopsis.textContent = item.synopsis;

    const posterScore = document.getElementById('heroPosterScore');
    const posterStatus = document.getElementById('heroPosterStatus');
    if (posterScore) posterScore.textContent = `${item.score} (MAL)`;
    if (posterStatus) posterStatus.textContent = item.status || 'HD Sub Indo';

    const dots = document.querySelectorAll('#heroCarouselDots .hero-dot');
    dots.forEach((d, i) => {
      if (i === this.currentHeroIndex) d.classList.add('active');
      else d.classList.remove('active');
    });
  },

  nextHeroSlide() {
    this.showHeroSlide(this.currentHeroIndex + 1);
  },

  prevHeroSlide() {
    this.showHeroSlide(this.currentHeroIndex - 1);
  },

  async loadLatestAiring() {
    const grid = document.getElementById('latestAnimeGrid');
    try {
      // 1. Try Otakudesu ongoing first (100% Indonesian sub & fast)
      const res = await fetch('/api/otakudesu/ongoing?page=1');
      const data = await res.json();

      if (data.success && data.data && data.data.length > 0) {
        grid.innerHTML = data.data.slice(0, 12).map(a => this.renderAnimeCardHtml(a)).join('');
        return;
      }

      // Fallback to Jikan latest
      const jRes = await fetch('/api/anime/latest?page=1');
      const jData = await jRes.json();
      if (jData.success && jData.data) {
        grid.innerHTML = jData.data.slice(0, 12).map(a => this.renderAnimeCardHtml(a)).join('');
      }
    } catch (err) {
      console.error('Error loading latest anime:', err);
    }
  },

  async loadPopularAnime() {
    const grid = document.getElementById('popularAnimeGrid');
    try {
      const res = await fetch('/api/anime/popular?page=1');
      const data = await res.json();

      if (data.success && data.data) {
        grid.innerHTML = data.data.slice(0, 12).map(a => this.renderAnimeCardHtml(a)).join('');
      } else {
        // Fallback to Otakudesu complete
        const oRes = await fetch('/api/otakudesu/complete?page=1');
        const oData = await oRes.json();
        if (oData.success && oData.data) {
          grid.innerHTML = oData.data.slice(0, 12).map(a => this.renderAnimeCardHtml(a)).join('');
        }
      }
    } catch (err) {
      console.error('Error loading popular anime:', err);
    }
  },

  async loadTopAiring() {
    const grid = document.getElementById('topAiringGrid');
    try {
      const res = await fetch('/api/anime/top-airing');
      const data = await res.json();

      if (data.success && data.data) {
        grid.innerHTML = data.data.slice(0, 8).map(a => this.renderAnimeCardHtml(a)).join('');
      } else {
        const oRes = await fetch('/api/otakudesu/ongoing?page=1');
        const oData = await oRes.json();
        if (oData.success && oData.data) {
          grid.innerHTML = oData.data.slice(12, 20).map(a => this.renderAnimeCardHtml(a)).join('');
        }
      }
    } catch (err) {
      console.error('Error loading top airing:', err);
    }
  },

  // -----------------------------------------------------------
  // ALL LATEST (PAGE VIEW)
  // -----------------------------------------------------------
  async loadAllLatest() {
    const grid = document.getElementById('allLatestGrid');
    const indicator = document.getElementById('latestPageIndicator');
    const prevBtn = document.getElementById('latestPrevPageBtn');
    const nextBtn = document.getElementById('latestNextPageBtn');

    grid.innerHTML = '<div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div>';
    if (indicator) indicator.textContent = `Halaman ${this.latestPage}`;
    if (prevBtn) prevBtn.disabled = this.latestPage <= 1;

    try {
      // Fetch Otakudesu ongoing
      const res = await fetch(`/api/otakudesu/ongoing?page=${this.latestPage}`);
      const data = await res.json();

      if (data.success && data.data && data.data.length > 0) {
        grid.innerHTML = data.data.map(a => this.renderAnimeCardHtml(a)).join('');
        if (nextBtn) nextBtn.disabled = data.data.length < 15;
      } else {
        // Fallback to Jikan latest
        const jRes = await fetch(`/api/anime/latest?page=${this.latestPage}`);
        const jData = await jRes.json();
        if (jData.success && jData.data) {
          grid.innerHTML = jData.data.map(a => this.renderAnimeCardHtml(a)).join('');
          if (nextBtn) nextBtn.disabled = !jData.pagination?.has_next_page;
        }
      }
    } catch (err) {
      grid.innerHTML = `<div class="text-danger">${err.message}</div>`;
    }
  },

  // -----------------------------------------------------------
  // ALL POPULAR (PAGE VIEW)
  // -----------------------------------------------------------
  async loadAllPopular() {
    const grid = document.getElementById('allPopularGrid');
    const indicator = document.getElementById('popularPageIndicator');
    const prevBtn = document.getElementById('popularPrevPageBtn');
    const nextBtn = document.getElementById('popularNextPageBtn');

    grid.innerHTML = '<div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div>';
    if (indicator) indicator.textContent = `Halaman ${this.popularPage}`;
    if (prevBtn) prevBtn.disabled = this.popularPage <= 1;

    try {
      const res = await fetch(`/api/anime/popular?page=${this.popularPage}`);
      const data = await res.json();

      if (data.success && data.data) {
        grid.innerHTML = data.data.map(a => this.renderAnimeCardHtml(a)).join('');
        if (nextBtn) nextBtn.disabled = !data.pagination?.has_next_page;
      }
    } catch (err) {
      grid.innerHTML = `<div class="text-danger">${err.message}</div>`;
    }
  },

  // -----------------------------------------------------------
  // GENRE BROWSER
  // -----------------------------------------------------------
  genreList: [
    { id: '1', slug: 'action', name: 'Action' },
    { id: '2', slug: 'adventure', name: 'Adventure' },
    { id: '4', slug: 'comedy', name: 'Comedy' },
    { id: '8', slug: 'drama', name: 'Drama' },
    { id: '10', slug: 'fantasy', name: 'Fantasy' },
    { id: '62', slug: 'isekai', name: 'Isekai' },
    { id: '22', slug: 'romance', name: 'Romance' },
    { id: '24', slug: 'sci-fi', name: 'Sci-Fi' },
    { id: '27', slug: 'shounen', name: 'Shounen' },
    { id: '36', slug: 'slice-of-life', name: 'Slice of Life' },
    { id: '37', slug: 'supernatural', name: 'Supernatural' },
    { id: '7', slug: 'mystery', name: 'Mystery' },
    { id: '30', slug: 'sports', name: 'Sports' },
    { id: '18', slug: 'mecha', name: 'Mecha' },
    { id: '14', slug: 'horror', name: 'Horror' },
    { id: '41', slug: 'suspense', name: 'Suspense' }
  ],

  loadGenreBrowser() {
    const container = document.getElementById('allGenresList');
    if (!container) return;

    container.innerHTML = this.genreList.map(g => `
      <button class="genre-badge-btn ${this.currentGenre === g.id ? 'active' : ''}" onclick="App.selectGenre('${g.id}', '${g.name}', '${g.slug}')">
        ${g.name}
      </button>
    `).join('');

    if (!this.currentGenre) {
      this.selectGenre('1', 'Action', 'action');
    }
  },

  selectGenre(genreId, genreName, genreSlug = '') {
    const item = this.genreList.find(g => g.id === String(genreId) || g.name.toLowerCase() === String(genreName).toLowerCase());
    this.currentGenre = item ? item.id : genreId;
    this.currentGenreSlug = genreSlug || (item ? item.slug : 'action');
    this.genrePage = 1;

    document.querySelectorAll('.genre-badge-btn').forEach(btn => {
      if (btn.textContent.trim() === genreName) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    const label = document.getElementById('currentGenreLabel');
    if (label) label.textContent = `Genre: ${genreName}`;

    this.fetchGenreAnime(this.currentGenre, this.currentGenreSlug);
  },

  async fetchGenreAnime(genreId, genreSlug = '') {
    const grid = document.getElementById('genreAnimeGrid');
    const pag = document.getElementById('genrePagination');
    const indicator = document.getElementById('genrePageIndicator');
    const prevBtn = document.getElementById('genrePrevBtn');
    const nextBtn = document.getElementById('genreNextBtn');

    grid.innerHTML = '<div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div><div class="anime-card-skeleton"></div>';
    if (indicator) indicator.textContent = `Halaman ${this.genrePage}`;
    if (prevBtn) prevBtn.disabled = this.genrePage <= 1;

    try {
      const slug = genreSlug || this.currentGenreSlug || '';
      const slugParam = slug ? `&genre_name=${encodeURIComponent(slug)}` : '';
      const res = await fetch(`/api/anime/search?genres=${genreId}${slugParam}&page=${this.genrePage}`);
      const data = await res.json();

      if (data.success && data.data && data.data.length > 0) {
        grid.innerHTML = data.data.map(a => this.renderAnimeCardHtml(a)).join('');
        if (pag) pag.style.display = 'flex';
        if (nextBtn) nextBtn.disabled = !data.pagination?.has_next_page;
      } else {
        grid.innerHTML = '<div class="empty-state-card"><div class="empty-state-icon">🏷️</div><h3>Tidak ada anime ditemukan untuk genre ini</h3></div>';
      }
    } catch (err) {
      grid.innerHTML = `<div class="text-danger">${err.message}</div>`;
    }
  },

  // -----------------------------------------------------------
  // ANIME CARD HTML GENERATOR
  // -----------------------------------------------------------
  renderAnimeCardHtml(anime) {
    const isOtaku = !!anime.slug || !!anime.otakudesuSlug || anime.subIndo;
    const cleanSlug = anime.slug || anime.otakudesuSlug || (anime.mal_id && String(anime.mal_id).replace(/^otaku_/, '')) || '';
    const targetId = isOtaku ? `'otaku_${cleanSlug}'` : anime.mal_id;
    const rawImg = isOtaku 
      ? (anime.thumb || anime.images?.webp?.image_url || anime.images?.jpg?.image_url || '') 
      : (anime.images?.webp?.large_image_url || anime.images?.webp?.image_url || anime.images?.jpg?.image_url || '');
    const imgUrl = this.getImageUrl(rawImg);
    const score = (anime.score || anime.rating) ? `⭐ ${anime.score || anime.rating}` : '⭐ Populer';
    const epCount = anime.episode || (anime.episodes ? `Ep ${anime.episodes}` : 'Ongoing');
    const genres = isOtaku ? (anime.day ? `Jadwal: ${anime.day}` : 'Sub Indo') : (anime.genres ? anime.genres.slice(0, 2).map(g => (typeof g === 'object' ? g.name : g)).join(', ') : 'Anime');
    const badgeText = 'SUB INDO';

    return `
      <div class="anime-card" onclick="App.openWatchPage(${targetId})">
        <div class="card-poster-wrap">
          <img src="${imgUrl}" alt="${anime.title}" class="card-poster" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/images/nekumi-logo.png'">
          <div class="card-overlay-gradient"></div>
          <span class="card-badge-score">${score}</span>
          <span class="card-badge-ep">${epCount}</span>
          <span class="card-badge-sub">${badgeText}</span>
          <div class="card-play-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </div>
        </div>
        <div class="card-details">
          <div class="card-title" title="${anime.title}">${anime.title}</div>
          <div class="card-genres">${genres}</div>
        </div>
      </div>
    `;
  },

  openWatchPage(animeId, ep = 1) {
    window.location.hash = `#watch/${animeId}/${ep}`;
  },

  // -----------------------------------------------------------
  // USER WATCH HISTORY & RESUME ROW
  // -----------------------------------------------------------
  async loadUserHistory() {
    const token = window.Auth?.getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/history', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.data) {
        this.renderContinueWatching(data.data);
        const counter = document.getElementById('historyCounter');
        if (counter) {
          counter.textContent = data.data.length;
          counter.style.display = data.data.length > 0 ? 'inline-block' : 'none';
        }
      }
    } catch (err) {
      console.warn('Could not load user history:', err);
    }
  },

  loadGuestHistory() {
    const offline = JSON.parse(localStorage.getItem('aninonton_offline_history') || '[]');
    if (offline.length > 0) {
      this.renderContinueWatching(offline);
    }
  },

  renderContinueWatching(historyItems) {
    const section = document.getElementById('continueWatchingSection');
    const grid = document.getElementById('continueWatchingGrid');
    if (!section || !grid) return;

    if (!historyItems || historyItems.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    grid.innerHTML = historyItems.map(h => `
      <div class="continue-card" onclick="App.openWatchPage(${h.anime_id}, ${h.episode_num})">
        <div class="continue-thumb-wrap">
          <img src="${h.anime_image}" alt="${h.anime_title}" class="continue-thumb">
          <div class="continue-progress-bar">
            <div class="continue-progress-fill" style="width: ${h.percentage || 10}%;"></div>
          </div>
        </div>
        <div class="continue-body">
          <div class="continue-title">${h.anime_title}</div>
          <div class="continue-ep">Episode ${h.episode_num} &bull; Lanjutkan &rarr;</div>
        </div>
      </div>
    `).join('');
  },

  async renderFullHistoryPage() {
    const list = document.getElementById('userHistoryList');
    if (!list) return;

    const token = window.Auth?.getToken();
    if (!token) {
      list.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-state-icon">🔒</div>
          <h3>Masuk Untuk Melihat Riwayat</h3>
          <p>Login akun Anda agar riwayat menonton tersinkron di semua perangkat.</p>
          <button class="btn btn-primary" onclick="Auth.openModal('login')">Masuk Sekarang</button>
        </div>
      `;
      return;
    }

    try {
      const res = await fetch('/api/history', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.data && data.data.length > 0) {
        list.innerHTML = data.data.map(h => {
          const dateStr = new Date(h.updated_at).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          });

          return `
            <div class="history-item-card" id="history-item-${h.anime_id}">
              <div class="history-thumb-box">
                <img src="${h.anime_image}" alt="${h.anime_title}" class="history-thumb-img">
              </div>
              <div class="history-info-box">
                <div>
                  <div class="history-anime-title">${h.anime_title}</div>
                  <div class="history-ep-label">Episode ${h.episode_num}</div>
                  <span class="history-time-ago">${dateStr}</span>
                </div>
                <div class="history-progress-wrap">
                  <div class="history-progress-fill" style="width: ${h.percentage || 10}%;"></div>
                </div>
                <div class="history-actions-row">
                  <button class="btn btn-primary btn-xs" onclick="App.openWatchPage(${h.anime_id}, ${h.episode_num})">
                    ▶ Lanjutkan
                  </button>
                  <button class="del-history-btn" title="Hapus Riwayat" onclick="App.deleteHistoryItem(${h.anime_id})">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        list.innerHTML = `
          <div class="empty-state-card">
            <div class="empty-state-icon">📺</div>
            <h3>Belum Ada Riwayat Nonton</h3>
            <p>Mulai streaming episode anime favorit Anda sekarang!</p>
            <a href="#" class="btn btn-primary" onclick="window.location.hash=''">Mulai Menonton</a>
          </div>
        `;
      }
    } catch (err) {
      list.innerHTML = `<div class="text-danger">${err.message}</div>`;
    }
  },

  async deleteHistoryItem(animeId) {
    const token = window.Auth?.getToken();
    try {
      const res = await fetch(`/api/history/${animeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Riwayat dihapus.', 'info');
        document.getElementById(`history-item-${animeId}`)?.remove();
        this.loadUserHistory();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async clearAllHistory() {
    const token = window.Auth?.getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/history', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Semua riwayat telah dibersihkan.', 'success');
        this.renderFullHistoryPage();
        this.loadUserHistory();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  // -----------------------------------------------------------
  // BOOKMARKS / FAVORIT WATCHLIST
  // -----------------------------------------------------------
  async loadUserBookmarks() {
    const token = window.Auth?.getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/bookmarks', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.data) {
        const counter = document.getElementById('bookmarkCounter');
        if (counter) {
          counter.textContent = data.data.length;
          counter.style.display = data.data.length > 0 ? 'inline-block' : 'none';
        }
      }
    } catch (err) {
      console.warn('Could not load bookmarks:', err);
    }
  },

  async toggleBookmark(anime) {
    if (!window.Auth?.isLoggedIn()) {
      showToast('Silakan masuk akun untuk menyimpan ke Favorit.', 'info');
      window.Auth?.openModal('login');
      return;
    }

    const token = window.Auth.getToken();
    const payload = {
      anime_id: anime.mal_id,
      anime_title: anime.title,
      anime_image: anime.images?.webp?.image_url || anime.images?.jpg?.image_url,
      anime_type: anime.type || 'TV',
      anime_score: anime.score || 0
    };

    try {
      const res = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        showToast(data.message, 'success');
        this.loadUserBookmarks();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async renderFullWatchlistPage() {
    const grid = document.getElementById('userWatchlistGrid');
    if (!grid) return;

    const token = window.Auth?.getToken();
    if (!token) {
      grid.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-state-icon">🔒</div>
          <h3>Masuk Untuk Melihat Favorit</h3>
          <button class="btn btn-primary" onclick="Auth.openModal('login')">Masuk Sekarang</button>
        </div>
      `;
      return;
    }

    try {
      const res = await fetch('/api/bookmarks', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();

      if (data.success && data.data && data.data.length > 0) {
        grid.innerHTML = data.data.map(b => `
          <div class="anime-card" id="bookmark-card-${b.anime_id}">
            <div class="card-poster-wrap" onclick="App.openWatchPage(${b.anime_id})">
              <img src="${b.anime_image}" alt="${b.anime_title}" class="card-poster">
              <div class="card-overlay-gradient"></div>
              <span class="card-badge-score">⭐ ${b.anime_score || 'N/A'}</span>
              <span class="card-badge-ep">${b.anime_type || 'TV'}</span>
            </div>
            <div class="card-details">
              <div class="card-title">${b.anime_title}</div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                <button class="btn btn-xs btn-primary" onclick="App.openWatchPage(${b.anime_id})">Tonton</button>
                <button class="btn btn-xs btn-outline-danger" onclick="App.removeBookmark(${b.anime_id})">Hapus</button>
              </div>
            </div>
          </div>
        `).join('');
      } else {
        grid.innerHTML = `
          <div class="empty-state-card">
            <div class="empty-state-icon">🔖</div>
            <h3>Daftar Favorit Masih Kosong</h3>
            <p>Jelajahi anime dan klik tombol bookmark untuk menyimpan anime favoritmu.</p>
            <a href="#" class="btn btn-primary" onclick="window.location.hash=''">Cari Anime</a>
          </div>
        `;
      }
    } catch (err) {
      grid.innerHTML = `<div class="text-danger">${err.message}</div>`;
    }
  },

  async removeBookmark(animeId) {
    const token = window.Auth?.getToken();
    try {
      const res = await fetch(`/api/bookmarks/${animeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Dihapus dari Favorit.', 'info');
        document.getElementById(`bookmark-card-${animeId}`)?.remove();
        this.loadUserBookmarks();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
};

window.App = App;
window.getProxiedImageUrl = (url) => App.getImageUrl(url);
document.addEventListener('DOMContentLoaded', () => App.init());
