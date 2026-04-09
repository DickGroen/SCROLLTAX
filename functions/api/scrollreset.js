export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const hours = body.hours || 0;
    const rate = body.rate || 15;
    const currency = body.currency || 'EUR';

    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const symbol = currency === 'USD'? '$' : '€';
    const dailyCost = hours * rate;
    const yearlyCost = dailyCost * 365;

    const prompt = `User scrolled for: ${hours} hours per day at ${symbol}${rate}/hour. That's ${symbol}${dailyCost} per day and ${symbol}${yearlyCost} per year wasted.

Be brutally honest and emotionally impactful.

Structure your response EXACTLY like this:

1. Start with a shocking sentence about how much time and money was wasted.
2. Calculate money lost (${symbol}${rate}/hour) in a bold way.
3. Compare it to something painful (like rent, vacation, etc).
4. End with a short, harsh reality check.

Keep it short, punchy, and very direct. Max 4 zinnen. Nederlands.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        max_tokens: 200
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `OpenAI error: ${data.error?.message || 'Unknown'}` }), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const result = data.choices[0].message.content;

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `Function error: ${error.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
