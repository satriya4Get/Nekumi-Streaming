/**
 * Otakudesu Scraper & Free Streaming Provider Engine
 * Domain: https://otakudesu.blog/
 */

require('dotenv').config();
const cheerio = require('cheerio');

const BASE_URL = process.env.OTAKUDESU_URL || 'https://otakudesu.blog';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id,en-US;q=0.7,en;q=0.3'
};

class OtakudesuEngine {
  constructor() {
    this.nonce = null;
    this.nonceExpires = 0;
  }

  // Get or refresh nonce for admin-ajax mirror resolution
  async getNonce() {
    const now = Date.now();
    if (this.nonce && now < this.nonceExpires) {
      return this.nonce;
    }

    try {
      const res = await fetch(`${BASE_URL}/wp-admin/admin-ajax.php`, {
        method: 'POST',
        headers: {
          ...DEFAULT_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'action=aa1208d27f29ca340c92c66d1926f13f'
      });
      const json = await res.json();
      if (json && json.data) {
        this.nonce = json.data;
        this.nonceExpires = now + 15 * 60 * 1000; // 15 mins cache
        return this.nonce;
      }
    } catch (e) {
      console.warn('[Otakudesu] Failed to get ajax nonce:', e.message);
    }
    return null;
  }

  // 1. Get Ongoing Anime (Anime Baru Rilis Sub Indo)
  async getOngoing(page = 1) {
    const url = page === 1 ? `${BASE_URL}/ongoing-anime/` : `${BASE_URL}/ongoing-anime/page/${page}/`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);

      const items = [];
      $('.venz ul li').each((i, el) => {
        const title = $(el).find('h2.jdlflm').text().trim();
        const link = $(el).find('a').attr('href');
        const thumb = $(el).find('img').attr('src');
        const ep = $(el).find('.epz').text().trim();
        const day = $(el).find('.epztipe').text().trim();

        if (title && link) {
          const slug = link.replace(BASE_URL, '').replace(/^\/anime\//, '').replace(/\/$/, '');
          items.push({
            title,
            slug,
            url: link,
            thumb,
            episode: ep,
            day,
            subIndo: true
          });
        }
      });
      return items;
    } catch (err) {
      console.error('[Otakudesu getOngoing Error]:', err.message);
      return [];
    }
  }

  // 2. Get Complete Anime (Anime Tamat)
  async getComplete(page = 1) {
    const url = page === 1 ? `${BASE_URL}/complete-anime/` : `${BASE_URL}/complete-anime/page/${page}/`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);

      const items = [];
      $('.venz ul li').each((i, el) => {
        const title = $(el).find('h2.jdlflm').text().trim();
        const link = $(el).find('a').attr('href');
        const thumb = $(el).find('img').attr('src');
        const ep = $(el).find('.epz').text().trim();
        const score = $(el).find('.epztipe').text().trim();

        if (title && link) {
          const slug = link.replace(BASE_URL, '').replace(/^\/anime\//, '').replace(/\/$/, '');
          items.push({
            title,
            slug,
            url: link,
            thumb,
            episode: ep,
            score,
            subIndo: true
          });
        }
      });
      return items;
    } catch (err) {
      console.error('[Otakudesu getComplete Error]:', err.message);
      return [];
    }
  }

  // 2b. Get Anime by Genre (Sub Indo)
  async getAnimeByGenre(genreSlug, page = 1) {
    const cleanSlug = (genreSlug || 'action').toLowerCase().trim().replace(/[^a-z0-9\-]/g, '');
    const url = page === 1 ? `${BASE_URL}/genres/${cleanSlug}/` : `${BASE_URL}/genres/${cleanSlug}/page/${page}/`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      if (!res.ok) return [];
      const html = await res.text();
      const $ = cheerio.load(html);

      const items = [];
      $('.col-anime').each((i, el) => {
        const title = $(el).find('.col-anime-title a').text().trim();
        const link = $(el).find('.col-anime-title a').attr('href');
        const thumb = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
        const ep = $(el).find('.col-anime-eps').text().trim();
        const rating = $(el).find('.col-anime-rating').text().trim();
        const studio = $(el).find('.col-anime-studio').text().trim();

        if (title && link) {
          const slug = link.replace(BASE_URL, '').replace(/^\/anime\//, '').replace(/\/$/, '');
          items.push({
            mal_id: `otaku_${slug}`,
            title,
            slug,
            otakudesuSlug: slug,
            url: link,
            images: {
              webp: { image_url: thumb, large_image_url: thumb },
              jpg: { image_url: thumb, large_image_url: thumb }
            },
            thumb,
            episodes: ep || 'Eps 12',
            episode: ep,
            score: parseFloat(rating) || 8.2,
            studio,
            genres: [{ name: cleanSlug.toUpperCase() }],
            status: 'Sub Indo',
            subIndo: true
          });
        }
      });
      return items;
    } catch (err) {
      console.error('[Otakudesu getAnimeByGenre Error]:', err.message);
      return [];
    }
  }

  // 3. Search Anime
  async search(query) {
    const url = `${BASE_URL}/?s=${encodeURIComponent(query)}&post_type=anime`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);

      const results = [];
      $('ul.chivsrc li').each((i, el) => {
        const title = $(el).find('h2 a').text().trim();
        const link = $(el).find('h2 a').attr('href');
        const thumb = $(el).find('img').attr('src');
        const genres = [];
        $(el).find('.set a').each((j, g) => genres.push($(g).text().trim()));
        const status = $(el).find('.set:contains("Status")').text().replace('Status :', '').trim();
        const rating = $(el).find('.set:contains("Rating")').text().replace('Rating :', '').trim();

        if (title && link) {
          const slug = link.replace(BASE_URL, '').replace(/^\/anime\//, '').replace(/\/$/, '');
          results.push({
            title,
            slug,
            url: link,
            thumb,
            genres,
            status,
            rating,
            subIndo: true
          });
        }
      });
      return results;
    } catch (err) {
      console.error('[Otakudesu Search Error]:', err.message);
      return [];
    }
  }

  // 4. Get Anime Details & Episode List
  async getAnimeDetail(slugOrUrl) {
    const url = slugOrUrl.startsWith('http') ? slugOrUrl : `${BASE_URL}/anime/${slugOrUrl}/`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);

      const title = $('h1, .jdlflm').first().text().trim();
      const poster = $('.fotoanime img').attr('src');
      const synopsis = $('.sinopc').text().trim();

      const infoText = $('.infozingle').text();
      const getVal = (prefix) => {
        const match = infoText.match(new RegExp(`${prefix}:?\\s*([^\\n\\r]+)`, 'i'));
        return match ? match[1].trim() : '';
      };

      const japanese = getVal('Japanese');
      const score = getVal('Skor') || getVal('Score');
      const type = getVal('Tipe') || 'TV';
      const status = getVal('Status') || 'Ongoing';
      const totalEp = getVal('Total Episode') || '?';
      const duration = getVal('Durasi') || '';
      const studio = getVal('Studio') || '';

      const genres = [];
      $('.infozingle a[href*="/genres/"]').each((i, g) => {
        genres.push($(g).text().trim());
      });

      // Extract episodes
      const episodes = [];
      $('a[href*="/episode/"]').each((i, el) => {
        const epTitle = $(el).text().trim();
        const epLink = $(el).attr('href');
        if (epTitle.toLowerCase().includes('pembatas')) return;

        const epMatch = epTitle.match(/episode\s*(\d+)/i) || epLink.match(/episode-(\d+)/i);
        const epNum = epMatch ? parseInt(epMatch[1]) : (episodes.length + 1);

        const slug = epLink.replace(BASE_URL, '').replace(/^\/episode\//, '').replace(/\/$/, '');
        episodes.push({
          num: epNum,
          title: epTitle,
          slug,
          url: epLink
        });
      });

      // Sort episodes ascending (Ep 1, Ep 2, ...)
      episodes.sort((a, b) => a.num - b.num);

      return {
        title,
        japanese,
        poster,
        score,
        type,
        status,
        totalEp,
        duration,
        studio,
        genres,
        synopsis,
        episodes
      };
    } catch (err) {
      console.error('[Otakudesu Detail Error]:', err.message);
      return null;
    }
  }

  // 5. Get Stream Servers for an Episode
  async getEpisodeStream(slugOrUrl) {
    const url = slugOrUrl.startsWith('http') ? slugOrUrl : `${BASE_URL}/episode/${slugOrUrl}/`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);

      const title = $('h1.posttl, .posttl, h1').first().text().trim();
      const servers = [];

      // (DesuStream HD removed as requested - mirrors used instead)

      // 2. Resolve mirrors from .mirrorstream via admin-ajax
      const mirrorLinks = [];
      $('.mirrorstream ul li a').each((i, el) => {
        const srvName = $(el).text().trim();
        const dataContent = $(el).attr('data-content');
        if (dataContent) {
          mirrorLinks.push({ srvName, dataContent });
        }
      });

      if (mirrorLinks.length > 0) {
        const nonce = await this.getNonce();
        // Resolve first 4 mirrors (e.g. FileDon, VidHide, Mega, Pdrain)
        for (const m of mirrorLinks.slice(0, 5)) {
          try {
            let parsed = null;
            try {
              parsed = JSON.parse(Buffer.from(m.dataContent, 'base64').toString('utf-8'));
            } catch (e) {}

            if (parsed && nonce) {
              const body = new URLSearchParams({
                ...parsed,
                nonce: nonce,
                action: '2a3505c93b0035d3f455df82bf976b84'
              }).toString();

              const mRes = await fetch(`${BASE_URL}/wp-admin/admin-ajax.php`, {
                method: 'POST',
                headers: {
                  ...DEFAULT_HEADERS,
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
              });
              const mJson = await mRes.json();
              if (mJson && mJson.data) {
                const decodedHtml = Buffer.from(mJson.data, 'base64').toString('utf-8');
                const iframeMatch = decodedHtml.match(/src="([^"]+)"/i);
                if (iframeMatch && iframeMatch[1]) {
                  const qLabel = parsed.q ? ` ${parsed.q}` : '';
                  servers.push({
                    id: `otakudesu_mirror_${servers.length + 1}`,
                    name: `Server ${servers.length + 1} (${m.srvName.toUpperCase()}${qLabel})`,
                    type: 'embed',
                    url: iframeMatch[1],
                    quality: parsed.q || '720p',
                    isOtakudesu: true
                  });
                }
              }
            }
          } catch (mErr) {
            console.warn('[Otakudesu] Mirror error for', m.srvName, mErr.message);
          }
        }
      }

      return {
        title,
        servers
      };
    } catch (err) {
      console.error('[Otakudesu Episode Stream Error]:', err.message);
      return { title: '', servers: [] };
    }
  }

  // 6. Find streams by Anime Title and Episode Number
  async findStreamsByTitleAndEpisode(title, episodeNum = 1) {
    try {
      // Clean title for search (e.g. remove "Season 2", "III", etc. to find main franchise)
      const cleanTitle = title
        .replace(/Season\s*\d+/gi, '')
        .replace(/(?:III|II|IV|V)$/gi, '')
        .replace(/[:\-–].*$/, '') // remove subtitle after colon
        .trim();

      let results = await this.search(cleanTitle);
      if (results.length === 0) {
        // Fallback to searching first 2 words
        const words = cleanTitle.split(' ').slice(0, 2).join(' ');
        results = await this.search(words);
      }

      if (results.length === 0) return [];

      // Pick best matching result
      const targetAnime = results[0];
      const detail = await this.getAnimeDetail(targetAnime.url);
      if (!detail || !detail.episodes || detail.episodes.length === 0) return [];

      // Find episode matching episodeNum
      const targetEp = detail.episodes.find(e => e.num === parseInt(episodeNum)) ||
                       detail.episodes[detail.episodes.length - 1];

      if (!targetEp) return [];

      const streamData = await this.getEpisodeStream(targetEp.url);
      return streamData.servers || [];
    } catch (err) {
      console.warn('[Otakudesu findStreams Error]:', err.message);
      return [];
    }
  }

  // 6. Get Anime by Genre (Otakudesu)
  async getAnimeByGenre(genreSlug, page = 1) {
    const slug = genreSlug.toLowerCase().trim().replace(/\s+/g, '-');
    const url = page === 1 ? `${BASE_URL}/genres/${slug}/` : `${BASE_URL}/genres/${slug}/page/${page}/`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);

      const items = [];
      $('.col-anime').each((i, el) => {
        const title = $(el).find('.col-anime-title a').text().trim();
        const link = $(el).find('.col-anime-title a').attr('href');
        const thumb = $(el).find('.col-anime-cover img').attr('src');
        const ep = $(el).find('.col-anime-eps').text().trim();
        const score = $(el).find('.col-anime-rating').text().trim();
        const studio = $(el).find('.col-anime-studio').text().trim();
        if (title && link) {
          const s = link.replace(`${BASE_URL}/anime/`, '').replace(/\/$/, '');
          items.push({
            mal_id: `otaku_${s}`,
            title,
            images: { webp: { image_url: thumb, large_image_url: thumb } },
            score: parseFloat(score) || 8.0,
            episodes: ep,
            status: 'Ongoing / Completed',
            genres: [{ name: slug.toUpperCase() }],
            studio: studio || 'Anime Studio',
            otakudesuSlug: s,
            subIndo: true
          });
        }
      });
      return items;
    } catch (err) {
      console.warn('[Otakudesu Genre Error]:', err.message);
      return [];
    }
  }
}

const otakudesu = new OtakudesuEngine();
module.exports = otakudesu;
