/**
 * ScrollStop — Cloudflare Pages Function
 * Bestand: functions/api/scrolltax.js
 *
 * Vereisten in wrangler.toml / Pages dashboard:
 *   - KV namespace gebonden als KV
 *   - Secret: OPENAI_API_KEY
 *   - (optioneel) Secret: LOGFLARE_API_KEY + LOGFLARE_SOURCE_ID
 *
 * FIX 1: Rate limiting via Cloudflare KV      → max 20 requests/minuut per IP
 * FIX 2: Correcte OpenAI Chat Completions API → messages[] array, niet input string
 * FIX 3: CORS headers                         → scrollstop.nl + localhost dev
 * FIX 4: Multi-currency support               → accepteert currency in body, formatteert correct
 * FIX 5: Logging                              → console.log + optioneel Logflare
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
const RATE_LIMIT        = 20;          // max requests per IP per venster
const RATE_WINDOW_SEC   = 60;          // venster in seconden
const MAX_TOKENS        = 60;          // OpenAI output tokens
const MODEL             = 'gpt-4o-mini';

const ALLOWED_ORIGINS = [
  'https://scrollstop.nl',
  'https://www.scrollstop.nl',
  'http://localhost:3000',
  'http://localhost:8788',             // wrangler pages dev default
];

// Muntformaten per currency-code
const CURRENCY_FORMAT = {
  EUR: { symbol: '€', locale: 'nl-NL' },
  USD: { symbol: '$', locale: 'en-US' },
  GBP: { symbol: '£', locale: 'en-GB' },
  CHF: { symbol: 'Fr', locale: 'de-CH' },
  SEK: { symbol: 'kr', locale: 'sv-SE' },
};

// ─── CORS HELPERS ──────────────────────────────────────────────────────────
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// ─── RATE LIMITER ──────────────────────────────────────────────────────────
/**
 * Geeft { allowed: bool, remaining: number } terug.
 * Slaat een teller op per IP in KV met TTL van RATE_WINDOW_SEC.
 * Als KV niet geconfigureerd is, wordt rate limiting overgeslagen (dev-mode).
 */
async function checkRateLimit(env, ip) {
  if (!env.KV) {
    console.warn('[rate-limit] KV niet geconfigureerd — limiet overgeslagen');
    return { allowed: true, remaining: RATE_LIMIT };
  }

  const key     = `rl:${ip}`;
  const current = await env.KV.get(key);
  const count   = current ? parseInt(current, 10) : 0;

  if (count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  // Increment — bij eerste request zet TTL, daarna preserveren we resterende TTL
  // via metadata. Simpele aanpak: altijd TTL resetten is iets conservatiever maar safe.
  await env.KV.put(key, String(count + 1), { expirationTtl: RATE_WINDOW_SEC });
  return { allowed: true, remaining: RATE_LIMIT - count - 1 };
}

// ─── LOGGING ───────────────────────────────────────────────────────────────
/**
 * Logt altijd naar console (zichtbaar in Cloudflare dashboard → Logs).
 * Stuurt optioneel naar Logflare als LOGFLARE_API_KEY aanwezig is.
 */
async function log(env, payload) {
  // FIX 5a: console.log — altijd beschikbaar in CF Workers
  console.log(JSON.stringify({
    t:       new Date().toISOString(),
    hours:   payload.hours,
    rate:    payload.rate,
    currency: payload.currency,
    schuld:  payload.schuld,
    roast:   payload.roast?.slice(0, 60),
    source:  payload.source,   // 'openai' | 'fallback'
    ip_hash: payload.ip_hash,  // gehashed voor privacy
  }));

  // FIX 5b: Logflare (optioneel — zet LOGFLARE_API_KEY + LOGFLARE_SOURCE_ID in secrets)
  if (env.LOGFLARE_API_KEY && env.LOGFLARE_SOURCE_ID) {
    try {
      await fetch('https://api.logflare.app/logs', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'X-API-KEY':     env.LOGFLARE_API_KEY,
        },
        body: JSON.stringify({
          source: env.LOGFLARE_SOURCE_ID,
          log_entry: payload.roast?.slice(0, 60) ?? '',
          metadata: payload,
        }),
      });
    } catch (err) {
      console.warn('[logflare] Versturen mislukt:', err.message);
    }
  }
}

// Simpele IP-hash voor privacy in logs (geen PII opslaan)
async function hashIp(ip) {
  const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const arr    = Array.from(new Uint8Array(buf));
  return arr.slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── FALLBACK ROASTS ───────────────────────────────────────────────────────
function getFallback(dagen, schuld, symbol) {
  const options = [
    `Je werkt ${dagen} dagen per maand gratis voor TikTok.`,
    `${symbol}${schuld}/maand kwijt aan content die je toch vergeet.`,
    `Jouw aandacht betaalt de bonus van een Silicon Valley-ingenieur.`,
    `${symbol}${schuld} per maand. Voor scrollen. Dat is je keuze.`,
    `Je hebt meer schermtijd dan een Netflix-binge-watcher met vrij weekend.`,
  ];
  return options[Math.floor(Math.random() * options.length)];
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = getCorsHeaders(request);

  // FIX 1: Rate limiting
  const ip        = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const rateCheck = await checkRateLimit(env, ip);

  if (!rateCheck.allowed) {
    console.warn(`[rate-limit] Geblokkeerd: ${ip}`);
    return Response.json(
      { error: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' },
      { status: 429, headers: { ...cors, 'Retry-After': String(RATE_WINDOW_SEC) } }
    );
  }

  try {
    const body = await request.json();

    // FIX 4: Accepteer hours/rate (nieuwe frontend) én uren/uurloon (oude frontend)
    const rawHours = body.hours ?? body.uren;
    const rawRate  = body.rate  ?? body.uurloon;

    const hours    = parseFloat(String(rawHours).replace(',', '.'));
    const rate     = parseFloat(String(rawRate).replace(',', '.'));

    // FIX 4: currency uit body, default EUR
    const currency = (body.currency && CURRENCY_FORMAT[body.currency.toUpperCase()])
      ? body.currency.toUpperCase()
      : 'EUR';
    const { symbol, locale } = CURRENCY_FORMAT[currency];

    // Validatie
    if (!hours || !rate || hours <= 0 || rate <= 0 || hours > 24) {
      return Response.json(
        { error: 'Vul geldige getallen in (uren 0–24, tarief > 0).' },
        { status: 400, headers: cors }
      );
    }

    // Berekeningen
    const dagen  = (hours * 30 / 8).toFixed(1);
    const schuld = Math.round(hours * rate * 30);
    const jaar   = Math.round(hours * rate * 365);
    const schuldFormatted = schuld.toLocaleString(locale);

    // Geen OpenAI key → directe fallback
    if (!env.OPENAI_API_KEY) {
      const roast  = getFallback(dagen, schuldFormatted, symbol);
      const ip_hash = await hashIp(ip);
      await log(env, { hours, rate, currency, schuld, roast, source: 'fallback', ip_hash });

      return Response.json(
        { roast, schuld, jaar, dagen, currency, symbol, upsell: 9 },
        { headers: cors }
      );
    }

    // FIX 2: Correcte OpenAI Chat Completions API (messages[], niet input string)
    const prompt = `Je bent een sarcastische maar eerlijke coach. Iemand scrollt ${hours} uur per dag en verdient ${symbol}${rate}/uur. Ze verliezen ${symbol}${schuldFormatted}/maand — ${dagen} werkdagen. Roast ze in precies 1 Nederlandse zin. Max 20 woorden. Geen aanhalingstekens.`;

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000); // 8s timeout

    let roast;
    let source = 'openai';

    try {
      // FIX 2: correcte messages[] structuur
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        signal:  controller.signal,
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.85,
          messages: [
            {
              role:    'system',
              content: 'Je geeft altijd exact 1 zin terug. Geen uitleg, geen aanhalingstekens, geen preamble.',
            },
            {
              role:    'user',
              content: prompt,
            },
          ],
        }),
      });

      clearTimeout(timeout);

      if (!openaiRes.ok) {
        const errBody = await openaiRes.text();
        console.error(`[openai] HTTP ${openaiRes.status}: ${errBody.slice(0, 100)}`);
        throw new Error(`OpenAI ${openaiRes.status}`);
      }

      const data = await openaiRes.json();
      roast = data.choices?.[0]?.message?.content?.trim();

      if (!roast) throw new Error('Lege OpenAI response');

    } catch (aiErr) {
      clearTimeout(timeout);
      console.warn('[openai] Fallback gebruikt:', aiErr.message);
      roast  = getFallback(dagen, schuldFormatted, symbol);
      source = 'fallback';
    }

    // FIX 5: Log uitkomst
    const ip_hash = await hashIp(ip);
    await log(env, { hours, rate, currency, schuld, roast, source, ip_hash });

    return Response.json(
      { roast, schuld, jaar, dagen, currency, symbol, upsell: 9 },
      {
        headers: {
          ...cors,
          'X-RateLimit-Remaining': String(rateCheck.remaining),
        },
      }
    );

  } catch (err) {
    console.error('[handler] Onverwachte fout:', err.message);
    return Response.json(
      { roast: 'Je scrollt teveel. Dat kost je geld.', schuld: 2625, upsell: 9 },
      { status: 500, headers: cors }
    );
  }
}

// FIX 3: CORS preflight afhandelen
export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });
}
