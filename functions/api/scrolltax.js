export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const hours = body.hours || 0;

    if (!env.OPENAI_API_KEY) {
      return new Response("Missing OPENAI_API_KEY", {
        status: 500,
        headers: { "Content-Type": "text/plain" }
      });
    }

    const prompt = `
User scrolled for: ${hours} hours

Be brutally honest and emotionally impactful.

Structure your response EXACTLY like this:

1. Start with a shocking sentence about how much time and money was wasted.
2. Calculate money lost (€15/hour) in a bold way.
3. Compare it to something painful (like rent, vacation, etc).
4. End with a short, harsh reality check.

Keep it short, punchy, and very direct.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify(data, null, 2), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const text =
      data.output?.[0]?.content?.[0]?.text ||
      JSON.stringify(data, null, 2);

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  } catch (error) {
    return new Response(`Function error: ${error.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }
}
