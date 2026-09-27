/**
 * Kuramanime Scraper Engine (https://v20.kuramanime.ing)
 * Free Sub Indo Anime Streaming Source
 */

const cheerio = require('cheerio');

const BASE_URL = 'https://v20.kuramanime.ing';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id,en-US;q=0.7,en;q=0.3'
};

const Kuramanime = {
  // 1. Search Anime
  async search(query) {
    if (!query) return [];
    const url = `${BASE_URL}/anime?search=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      if (!res.ok) return [];
      const html = await res.text();
      const $ = cheerio.load(html);

      const seen = new Set();
      const results = [];

      $('.col-lg-4.col-md-6.col-sm-6, .product__item, .anime__item').each((i, el) => {
        const linkElem = $(el).find('a').first();
        const href = linkElem.attr('href') || '';
        const titleElem = $(el).find('.product__item__text h5 a, h5 a, h4 a').first();
        const title = titleElem.text().trim();
        const thumb = $(el).find('.product__item__pic, div[data-setbg]').attr('data-setbg') || $(el).find('img').attr('src') || '';
        const ep = $(el).find('.ep').text().trim();
        const score = $(el).find('.view, .comment').text().trim();

        if (title && href && href.includes('/anime/')) {
          const match = href.match(/\/anime\/(\d+)\/([^\/?]+)/);
          const kuramaId = match ? match[1] : '';
          const slug = match ? match[2] : '';
          if (kuramaId && !seen.has(kuramaId)) {
            seen.add(kuramaId);
            results.push({
              id: `kurama_${kuramaId}`,
              kuramaId,
              slug,
              title,
              url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
              thumb: thumb.startsWith('http') ? thumb : `${BASE_URL}${thumb}`,
              episode: ep,
              score: parseFloat(score) || 8.0,
              subIndo: true,
              source: 'kuramanime'
            });
          }
        }
      });
      return results;
    } catch (err) {
      console.error('[Kuramanime Search Error]:', err.message);
      return [];
    }
  },

  // 2. Get Anime Details & Episode List
  async getAnimeDetail(kuramaId, slug) {
    const url = `${BASE_URL}/anime/${kuramaId}/${slug}`;
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      if (!res.ok) return null;
      const html = await res.text();
      const $ = cheerio.load(html);

      const title = $('h1, .anime__details__title h3').first().text().trim();
      const synopsis = $('#synopsisField').text().trim();
      const poster = $('.anime__details__pic, div[data-setbg]').first().attr('data-setbg') || '';

      const episodes = [];
      const popoverContent = $('#episodeLists').attr('data-content') || '';
      if (popoverContent) {
        const $pop = cheerio.load(popoverContent);
        $pop('a').each((i, el) => {
          const epHref = $pop(el).attr('href') || '';
          const epMatch = epHref.match(/\/episode\/(\d+)/);
          const epNum = epMatch ? parseInt(epMatch[1]) : (i + 1);
          episodes.push({
            episode: epNum,
            title: `Episode ${epNum}`,
            url: epHref.startsWith('http') ? epHref : `${BASE_URL}${epHref}`
          });
        });
      }

      return {
        id: `kurama_${kuramaId}`,
        kuramaId,
        slug,
        title,
        synopsis,
        poster,
        totalEpisodes: episodes.length,
        episodes,
        subIndo: true,
        source: 'kuramanime'
      };
    } catch (err) {
      console.error('[Kuramanime Detail Error]:', err.message);
      return null;
    }
  },

  // 3. Find Kuramanime Stream Link for Anime Title and Episode
  async findStreamForAnime(title, episodeNum = 1) {
    try {
      const results = await this.search(title);
      if (!results || results.length === 0) return null;

      // Find best title match
      const matched = results.find(r => r.slug.includes('level-up') || r.title.toLowerCase().includes(title.toLowerCase())) || results[0];
      if (!matched) return null;

      const detail = await this.getAnimeDetail(matched.kuramaId, matched.slug);
      if (!detail || !detail.episodes || detail.episodes.length === 0) return null;

      const epObj = detail.episodes.find(e => e.episode === parseInt(episodeNum)) || detail.episodes[0];
      if (!epObj) return null;

      return {
        animeTitle: detail.title,
        episode: epObj.episode,
        url: epObj.url,
        embedUrl: epObj.url
      };
    } catch (err) {
      console.warn('[Kuramanime findStreamForAnime Error]:', err.message);
      return null;
    }
  }
};

module.exports = Kuramanime;
