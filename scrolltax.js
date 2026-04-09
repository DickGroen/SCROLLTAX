export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers - PAS DIT AAN NAAR JE ECHTE DOMEIN
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://scrollstop.nl',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // FIX 1: Rate limiting via Cloudflare KV + safeguard
    if (!env.KV) {
      console.error('KV namespace niet gebonden');
      return new Response(JSON.stringify({ error: 'Server config fout: KV mist' }), {
        status: 500,
        headers: corsHeaders
      });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const kvKey = `ratelimit:${ip}`;
    const current = parseInt(await env.KV.get(kvKey) || '0');

    if (current >= 20) {
      return new Response(JSON.stringify({ error: 'Rate limit: max 20 requests per minuut' }), {
        status: 429,
        headers: corsHeaders
      });
    }
    await env.KV.put(kvKey, String(current + 1), { expirationTtl: 60 });

    const body = await request.json();
    const hours = parseFloat(body.hours) || 0;

    // FIX 4: Currency + rate uit body, default €15
    const currency = body.currency || 'EUR';
    const rate = parseFloat(body.rate) || 15;
    const symbol = currency === 'USD'? '$' : currency === 'GBP'? '£' : '€';

    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Missing OPENAI_API_KEY' }), {
        status: 500,
        headers: corsHeaders
      });
    }

    if (hours <= 0 || hours > 24) {
      return new Response(JSON.stringify({ error: 'Hours moet tussen 0.5 en 24 zijn' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const prompt = `User scrolled for: ${hours} hours. Hourly value: ${symbol}${rate}

Be brutally honest and emotionally impactful.

Structure your response EXACTLY like this:

1. Start with a shocking sentence about how much time and money was wasted.
2. Calculate money lost (${symbol}${rate}/hour) in a bold way.
3. Compare it to something painful (like rent, vacation, groceries).
4. End with a short, harsh reality check.

Keep it short, punchy, and very direct. Use ${symbol} as currency symbol. Max 4 sentences total.`;

    // FIX 2: Gebruik Chat Completions API correct
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 200
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // FIX 5: Logging bij errors
      console.error('OpenAI error:', JSON.stringify(data));
      return new Response(JSON.stringify({ error: 'OpenAI API error', details: data.error?.message || 'Unknown' }), {
        status: response.status,
        headers: corsHeaders
      });
    }

    const text = data.choices?.[0]?.message?.content?.trim() || "Error: geen output van AI";

    // EXTRA: Basic content filter - voorkom lege/shady responses
    if (text.length < 20) {
      throw new Error('AI response te kort, waarschijnlijk gefaald');
    }

    // FIX 5: Logging voor analytics
    console.log(JSON.stringify({
      ip,
      hours,
      currency,
      rate,
      output_preview: text.slice(0, 80),
      timestamp: new Date().toISOString()
    }));

    return new Response(JSON.stringify({ result: text }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (error) {
    console.error('Function error:', error.message);
    return new Response(JSON.stringify({ error: `Function error: ${error.message}` }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
